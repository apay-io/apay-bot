import { Injectable, Logger } from '@nestjs/common';
import { Asset, Server, Keypair, Operation, TransactionBuilder, Account, Memo, xdr } from 'stellar-sdk';
import {ConfigService} from '@nestjs/config';
import { AssetInterface } from './asset.interface';

@Injectable()
export class StellarService {
  private readonly logger = new Logger(StellarService.name);
  private server;
  private networkPassphrase: string;
  private accounts = {};

  constructor(
    private readonly configService: ConfigService,
  ) {
    this.server = new Server(this.configService.get('stellar.horizonUrl'));
    this.networkPassphrase = this.configService.get('stellar.networkPassphrase');
  }

  async buildAndSubmitTx(
    operations: xdr.Operation[] = [],
    { source, memo = null, timeout = 30, sequence = null, signers = []},
  ) {
    // const fee = await this.server.feeStats();

    const builder = new TransactionBuilder(
      sequence
        ? new Account(source, sequence)
        : await this.server.loadAccount(source), {
      fee: 100, // fee.fee_charged.mode,
      networkPassphrase: this.networkPassphrase,
    });
    if (timeout) {
      builder.setTimeout(timeout);
    }
    if (memo) {
      builder.addMemo(memo);
    }
    operations.forEach(o => builder.addOperation(o));

    const tx = builder.build();
    tx.sign(Keypair.fromSecret(process.env[`STELLAR_SECRET_${source}`]));
    signers.forEach((signer) => {
      tx.sign(Keypair.fromSecret(process.env[`STELLAR_SECRET_${signer}`]));
    });
    this.logger.log(tx.toEnvelope().toXDR().toString('base64'));
    return await this.server.submitTransaction(tx);
  }

  assetFromObject(assetObj: AssetInterface): Asset {
    return assetObj.asset_type === 'native' ? Asset.native() : new Asset(assetObj.asset_code, assetObj.asset_issuer);
  }

  async loadAccount(account: string) {
    const accountRecord = await this.server.loadAccount(account);
    this.accounts[account] = accountRecord;
    return accountRecord;
  }

  async loadAccountCached(account: string) {
    if (!this.accounts[account]) {
      this.accounts[account] = await this.loadAccount(account);
    }
    return this.accounts[account];
  }

  async loadOffers(account: string) {
    return (await this.server.offers()
      .forAccount(account)
      .limit(50)
      .call()).records.map((offer) => {
        delete offer._links;
        return offer;
      });
  }

  streamEffects(account, action) {
    const builder = this.server
      .effects()
      .cursor('now') // not interested in old events
      .forAccount(account);

    builder.stream({
      onmessage: action,
      onerror: err => this.logger.error(err),
    });
  }

  streamPayments(account, action) {
    const builder = this.server
      .payments()
      .join('transactions')
      // .cursor('now') // not interested in old events
      .forAccount(account);

    builder.stream({
      onmessage: action,
      onerror: err => this.logger.error(err),
    });
  }

  async getTx(txId: string) {
    return this.server
      .operations()
      .join('transactions')
      .operation(txId)
      .call();
  }

  async assignChannelAndSequence(manager) {
    return {
      channel: manager,
      sequence: await this.server.loadAccount(manager).sequence,
    };
  }

  async init(market) {
    if (!market.manager) {
      return;
    }
    try {
      const loadedAccount = await this.server.loadAccount(market.account);
      return;
    } catch (err) {
      await this.buildAndSubmitTx([
        Operation.createAccount({
          destination: market.account,
          startingBalance: '150',
        }),
        Operation.changeTrust({
          asset: this.assetFromObject(market.base),
          source: market.account,
        }),
        Operation.changeTrust({
          asset: this.assetFromObject(market.asset),
          source: market.account,
        }),
        Operation.changeTrust({
          asset: this.assetFromObject(market.base),
        }),
        Operation.changeTrust({
          asset: this.assetFromObject(market.asset),
        }),
      ], {
        source: market.manager,
        signers: [
          market.account,
        ],
      });
    }
  }
}
