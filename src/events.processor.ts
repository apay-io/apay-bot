import { Injectable, Logger } from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import { BigNumber } from 'bignumber.js';
import {find, isEqual } from 'lodash';
import { InjectQueue, Process, Processor } from '@nestjs/bull';
import { Job, Queue } from 'bull';
import { AssetInterface } from './asset.interface';
import { StellarService } from './stellar.service';
import { Operation } from 'stellar-sdk';
import { CompactLogger } from './compact-logger';

@Processor('events')
export class EventsProcessor {
  private readonly logger = new CompactLogger(EventsProcessor.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly stellarService: StellarService,
    @InjectQueue('events') private queue: Queue,
  ) {
  }

  @Process()
  async process(job: Job<{ account: string, base: AssetInterface, asset: AssetInterface}>) {
    this.logger.start(`${job.data.base.asset_code || 'XLM'}/${job.data.asset.asset_code || 'XLM'}`);
    const account = job.data.account;
    const offers = await this.stellarService.loadOffers(account);
    this.logger
      .start('existing-offers')
      .logList(offers, (o) => `${o.id} selling ${o.amount} ${o.selling.asset_code || 'XLM'} at ${o.price} ${o.buying.asset_code || 'XLM'}/${o.selling.asset_code || 'XLM'}`)
      .end();

    const acc = await this.stellarService.loadAccount(account);
    const baseBalance = find(acc.balances, job.data.base);
    const assetBalance = find(acc.balances, job.data.asset);
    this.logger.start('account')
      .log(`${baseBalance.balance} ${baseBalance.asset_code || 'XLM'}`)
      .log(`${assetBalance.balance} ${assetBalance.asset_code || 'XLM'}`).end();

    if (baseBalance && assetBalance) {
      const medianPrice = new BigNumber(baseBalance.balance).dividedBy(assetBalance.balance);
      this.logger.start('median-price').log(`${medianPrice.toNumber()} ${baseBalance.asset_code || 'XLM'}/${assetBalance.asset_code || 'XLM'}`).end();
      this.logger.start('total-value').log(
        new BigNumber(baseBalance.balance).plus(medianPrice.multipliedBy(assetBalance.balance)).toFixed(7) + ' ' + baseBalance.asset_code || 'XLM'
      ).end();

      const newOffers = this.generateOffers(medianPrice, baseBalance, assetBalance,
        [1.002, 1.004, 1.006, 1.008, 1.01, 1.015, 1.02, 1.2],
      );
      this.logger.start('target-offers').logList(newOffers, (o) => `selling ${o.amount.toFixed(7)} ${o.selling.asset_code || 'XLM'} at ${o.price.toFixed(7)} ${o.buying.asset_code || 'XLM'}/${o.selling.asset_code || 'XLM'}`).end();

      const { offersToSend, offersToDelete } = this.filterExistingOffers(newOffers, offers);
      this.logger.start('offers-to-send').logList(offersToSend, (o) => `${o.id} selling ${o.amount.toFixed(7)} ${o.selling.asset_code || 'XLM'} at ${o.price.toFixed(7)} ${o.buying.asset_code || 'XLM'}/${o.selling.asset_code || 'XLM'}`).end();
      this.logger.start('offers-to-delete').logList(offersToDelete, (o) => `${o.id} selling ${o.amount} ${o.selling.asset_code || 'XLM'} at ${o.price} ${o.buying.asset_code || 'XLM'}/${o.selling.asset_code || 'XLM'}`).end();

      if (offersToSend.length > 0 || offersToDelete.length > 0) {
        try {
          const result = await this.stellarService.buildAndSubmitTx([
            ...offersToDelete.map((offer) => {
              return Operation.manageSellOffer({
                selling: this.stellarService.assetFromObject(offer.selling),
                buying: this.stellarService.assetFromObject(offer.buying),
                offerId: offer.id,
                price: offer.price,
                amount: '0',
              });
            }),
            ...offersToSend.map((offer) => {
              return Operation.manageSellOffer({
                selling: this.stellarService.assetFromObject(offer.selling),
                buying: this.stellarService.assetFromObject(offer.buying),
                amount: offer.amount.toFixed(7),
                price: offer.price.toString(),
              });
            }),
          ], {
            source: account,
          });
        } catch (err) {
          // console.error(err);
          this.logger.error(err);
          this.logger.end();
          throw err;
        }
      } else {
        this.logger.log('no changes');
      }
    }
    this.logger.end();
  }

  private filterExistingOffers(newOffers: any[], offers: any[]) {
    const offersToSend = [];
    const offersToSave = [];
    const offersToDelete = [];
    for (const newOffer of newOffers) {
      const existing = find(offers, (item) => {
        return isEqual(this.stellarService.assetFromObject(newOffer.buying), this.stellarService.assetFromObject(item.buying))
          && isEqual(this.stellarService.assetFromObject(newOffer.selling), this.stellarService.assetFromObject(item.selling))
          && newOffer.price.minus(item.price).abs().dividedBy(newOffer.price).lt(0.001);
      });
      if (!existing) {
        offersToSend.push(newOffer);
      } else {
        if (new BigNumber(existing.amount).lt(newOffer.amount)) {
          offersToSend.push(newOffer);
        } else {
          offersToSave.push(existing.id);
        }
      }
    }
    for (const offer of offers) {
      if (offersToSave.indexOf(offer.id) === -1) {
        offersToDelete.push(offer);
      }
    }
    return {
      offersToSend, offersToDelete,
    };
  }

  private generateOffers(medianPrice: BigNumber, baseBalance: any, assetBalance: any, levels: number[]) {
    const result = [];
    for (const level of levels) {
      result.push({
        buying: baseBalance,
        selling: assetBalance,
        amount: new BigNumber(assetBalance.balance).multipliedBy((level - 1) / level / 3),
        price: medianPrice.multipliedBy(level),
      });
      result.push({
        buying: assetBalance,
        selling: baseBalance,
        amount: new BigNumber(baseBalance.balance).multipliedBy((level - 1) / level / 3),
        price: new BigNumber(1).dividedBy(medianPrice).multipliedBy(level),
      });
    }

    return result;
  }
}
