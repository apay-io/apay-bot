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
  private lastJob = {};
  private limit = {};

  constructor(
    private readonly configService: ConfigService,
    @InjectQueue('events') private queue: Queue,
  ) {
    this.horizon = new Server(this.configService.get('stellar.horizonUrl'));
    this.networkPassphrase = this.configService.get('stellar.networkPassphrase');
  }

  async enqueue(market) {
    let delay = 0;
    // manually limiting number of new jobs
    if (this.lastJob[market.asset.asset_code] && (new Date().getTime() - this.lastJob[market.asset.asset_code] < 20000)) {
      // delaying second job in a batch by 20 sec
      delay = 20000;
      if (this.limit[market.asset.asset_code]) {
        // skipping jobs if limit is on (3rd and consequent jobs in a batch)
        return;
      } else {
        // switching the limit on if not already on
        this.limit[market.asset.asset_code] = true;
      }
    } else {
      // switching the limit off if there were no jobs for a while
      this.limit[market.asset.asset_code] = false;
    }
    this.lastJob[market.asset.asset_code] = new Date().getTime();
    await this.queue.add(market, {
      removeOnComplete: true,
      removeOnFail: true,
      backoff: 20000,
      attempts: 5,
      delay,
    });
    setTimeout(() => {
      this.enqueue(market);
    }, 60000 + Math.random() * 540000);
  }
}
