import { Injectable, Logger } from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import { BigNumber } from 'bignumber.js';
import {find, isEqual } from 'lodash';
import { InjectQueue, Process, Processor } from '@nestjs/bull';
import { Job, Queue } from 'bull';
import { AssetInterface } from './asset.interface';
import { StellarService } from './stellar.service';
import { Operation } from 'stellar-sdk';

@Processor('events')
export class EventsProcessor {
  private readonly logger = new Logger(EventsProcessor.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly stellarService: StellarService,
    @InjectQueue('events') private queue: Queue,
  ) {
  }

  @Process()
  async process(job: Job<{ account: string, base: AssetInterface, asset: AssetInterface}>) {
    this.logger.debug(job.data, 'job');
    const account = job.data.account;
    const offers = await this.stellarService.loadOffers(account);
    this.logger.debug(offers, 'existing offers');

    const acc = await this.stellarService.loadAccount(account);
    this.logger.debug(acc);
    const baseBalance = find(acc.balances, job.data.base);
    const assetBalance = find(acc.balances, job.data.asset);
    this.logger.log(baseBalance.balance, baseBalance.asset_code || 'XLM');
    this.logger.log(assetBalance.balance, assetBalance.asset_code);

    if (baseBalance && assetBalance) {
      const medianPrice = new BigNumber(baseBalance.balance).dividedBy(assetBalance.balance);
      this.logger.log(medianPrice.toNumber(), 'median price');
      this.logger.log(new BigNumber(baseBalance.balance).plus(medianPrice.multipliedBy(assetBalance.balance)).toFixed(7), 'total value');

      const newOffers = this.generateOffers(medianPrice, baseBalance, assetBalance,
        [1.002, 1.004, 1.006, 1.008, 1.01, 1.015, 1.02, 1.2],
      );
      this.logger.debug(newOffers, 'target offers');

      const { offersToSend, offersToDelete } = this.filterExistingOffers(newOffers, offers);
      this.logger.debug(offersToSend, 'offers to send');
      this.logger.debug(offersToDelete, 'offers to delete');

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
          this.logger.error(err);
          this.logger.log(err.response.data);
          throw err;
        }
      } else {
        this.logger.log('no changes');
      }
    }
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
        offersToSave.push(existing.id);
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
