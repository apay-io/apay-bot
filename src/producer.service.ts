import { Injectable, Logger } from '@nestjs/common';
import { Asset, Server, Keypair, Operation, TransactionBuilder, Account, Memo, xdr } from 'stellar-sdk';
import {ConfigService} from '@nestjs/config';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { AssetInterface } from './asset.interface';

@Injectable()
export class Producer {
  private readonly logger = new Logger(Producer.name);
  private horizon;
  private networkPassphrase: string;

  constructor(
    private readonly configService: ConfigService,
    @InjectQueue('events') private queue: Queue,
  ) {
    this.horizon = new Server(this.configService.get('stellar.horizonUrl'));
    this.networkPassphrase = this.configService.get('stellar.networkPassphrase');
  }

  async streamEffects(market: {account: string, base: AssetInterface, asset: AssetInterface}) {
    await this.enqueue(market);

    const builder = this.horizon
      .effects()
      .cursor('now') // not interested in old events
      .forAccount(market.account);

    builder.stream({
      onmessage: async (effect) => {
        this.enqueue(market);
      },
    });
  }

  async enqueue(market) {
    const jobsCount = await this.queue.getJobCounts();
    if (jobsCount.waiting > 0 || jobsCount.delayed > 0) {
      // we don't want too many updates, one is enough
      return;
    }
    return this.queue.add(market, {
      removeOnComplete: true,
      removeOnFail: true,
      backoff: 20000,
      attempts: 5,
    });
  }
}
