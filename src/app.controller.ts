import { BadRequestException, Body, Controller, Get, InternalServerErrorException, Logger, NotFoundException, Param, Post } from '@nestjs/common';
import { AppService } from './app.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Account } from './account.entity';
import { Repository } from 'typeorm';
import { StellarService } from './stellar.service';
import { ConfigService } from '@nestjs/config';
import {find, isEqual, map } from 'lodash';
import { BigNumber } from 'bignumber.js';
import { Operation, Asset } from 'stellar-sdk';
import { Tx } from './tx.entity';
import { Charge } from './charge.entity';

@Controller()
export class AppController {
  private readonly logger = new Logger(AppController.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(Account)
    protected readonly accountRepo: Repository<Account>,
    @InjectRepository(Tx)
    protected readonly txRepo: Repository<Tx>,
    @InjectRepository(Charge)
    protected readonly chargeRepo: Repository<Charge>,
    private readonly appService: AppService,
    private readonly stellarService: StellarService,
  ) {}

  @Post('/account')
  async account(@Body() params: { account: string, memo?: string }): Promise<Account> {
    return await this.accountRepo.findOne({
      account: params.account,
    }) || await this.accountRepo.save({
      account: params.account,
    });
  }

  @Post('/deposit')
  async deposit(@Body() params: { txs: string[], memo: string }): Promise<any> {
    // todo: protection from someone else triggering deposit?
    this.logger.debug(params, 'params');
    let baseSum = new BigNumber(0);
    let assetSum = new BigNumber(0);
    let market;
    const ops = {};
    const account = await this.accountRepo.findOne(params.memo);
    if (!account) {
      throw new NotFoundException('Invalid tx');
    }

    for (const txId of params.txs) {
      ops[txId] = await this.stellarService.getTx(txId);
      this.logger.debug(ops[txId]);
      if (market) {
        if (market.manager !== ops[txId].to) {
          throw new NotFoundException('Invalid tx');
        }
      } else {
        market = find(this.configService.get('markets'), { manager: ops[txId].to });
      }
      const tx = await ops[txId].transaction();
      if (!market || tx.memo !== params.memo) {
        throw new NotFoundException('Invalid tx');
      }
      if (isEqual(this.stellarService.assetFromObject(ops[txId]), this.stellarService.assetFromObject(market.base))) {
        baseSum = baseSum.plus(ops[txId].amount);
      } else if (isEqual(this.stellarService.assetFromObject(ops[txId]), this.stellarService.assetFromObject(market.asset))) {
        assetSum = assetSum.plus(ops[txId].amount);
      } else {
        throw new NotFoundException('Invalid tx');
      }
    }
    const loadedAccount = await this.stellarService.loadAccount(account.account);
    if (!find(loadedAccount.balances, market.asset)) {
      throw new BadRequestException('No trustline');
    }

    if (baseSum.isZero() || assetSum.isZero()) {
      throw new BadRequestException('Insufficient txs');
    }
    const {unitPriceBase, unitPriceAsset} = await this.calculateUnitPrices(market);

    const unitsOfBase = baseSum.dividedBy(unitPriceBase).toFixed(7);
    const unitsOfAsset = assetSum.dividedBy(unitPriceAsset).toFixed(7);
    this.logger.log(unitsOfBase, 'units of base');
    this.logger.log(unitsOfAsset, 'units of asset');
    const minUnits = new BigNumber(unitsOfBase).lt(unitsOfAsset) ? unitsOfBase : unitsOfAsset;

    const depositBase = unitPriceBase.multipliedBy(minUnits).toFixed(7);
    const depositAsset = unitPriceAsset.multipliedBy(minUnits).toFixed(7);
    this.logger.log(depositBase, 'deposit base');
    this.logger.log(depositAsset, 'deposit asset');

    const { channel, sequence } = await this.stellarService.assignChannelAndSequence(market.manager);
    try {
      const saved = await this.txRepo.save(map(ops, (op) => {
        return {
          manager: market.manager,
          currencyIn: op.asset_code || 'XLM',
          amountIn: new BigNumber(op.amount),
          txIn: op.id,
        };
      }));
      await this.chargeRepo.save({
        account,
        asset: market.asset.asset_code,
        tokens: new BigNumber(minUnits),
        baseAmount: new BigNumber(depositBase),
        assetAmount: new BigNumber(depositAsset),
        manager: market.manager,
        channel,
        sequence,
        txs: saved,
      } as Charge);
    } catch (err) {
      if (err.toString().indexOf('duplicate') !== -1) {
        throw new BadRequestException('Tx already processed');
      }
      this.logger.error(err);
      throw new InternalServerErrorException();
    }

    // todo: retries + sequence
    await this.stellarService.buildAndSubmitTx([
      Operation.payment({
        destination: market.account,
        asset: this.stellarService.assetFromObject(market.base),
        amount: depositBase,
      }),
      Operation.payment({
        destination: market.account,
        asset: this.stellarService.assetFromObject(market.asset),
        amount: depositAsset,
      }),
      ...(baseSum.minus(depositBase).gt(0) ? [Operation.payment({
        destination: account.account,
        asset: this.stellarService.assetFromObject(market.base),
        amount: baseSum.minus(depositBase).toFixed(7),
      })] : []),
      ...(assetSum.minus(depositAsset).gt(0) ? [Operation.payment({
        destination: account.account,
        asset: this.stellarService.assetFromObject(market.asset),
        amount: assetSum.minus(depositAsset).toFixed(7),
      })] : []),
      Operation.payment({
        destination: account.account,
        asset: new Asset(`APAY${market.asset.asset_code}`, market.manager),
        amount: minUnits,
      }),
    ], {
      source: channel,
      sequence,
    });

    return '';
  }

  @Post('/withdraw')
  async withdraw(@Body() params: { txId: string }): Promise<any> {
    const op = await this.stellarService.getTx(params.txId);
    const market = find(this.configService.get('markets'), { manager: op.to });
    if (op.asset_code !== `APAY${market.asset.asset_code}`) {
      throw new BadRequestException('Invalid asset');
    }
    const tx = await op.transaction();
    const account = await this.accountRepo.findOne(tx.memo);
    if (!tx.memo || !account) {
      throw new NotFoundException('Invalid tx');
    }

    const {unitPriceBase, unitPriceAsset} = await this.calculateUnitPrices(market);
    const { channel, sequence } = await this.stellarService.assignChannelAndSequence(market.manager);

    const charge = await this.chargeRepo.save({
      account,
      asset: market.asset.asset_code,
      tokens: new BigNumber(op.amount).negated(),
      baseAmount: new BigNumber(unitPriceBase.multipliedBy(op.amount).toFixed(7)).negated(),
      assetAmount: new BigNumber(unitPriceAsset.multipliedBy(op.amount).toFixed(7)).negated(),
      manager: market.manager,
      channel,
      sequence,
    } as Charge);

    await this.stellarService.buildAndSubmitTx([
      Operation.payment({
        destination: account.account,
        asset: this.stellarService.assetFromObject(market.base),
        amount: charge.baseAmount.negated().toFixed(7),
        source: market.account,
      }),
      Operation.payment({
        destination: market.account,
        asset: this.stellarService.assetFromObject(market.asset),
        amount:  charge.assetAmount.negated().toFixed(7),
        source: market.account,
      }),
    ], {
      source: channel,
      sequence,
      signers: [market.account],
    });
  }

  private async calculateUnitPrices(market) {
    const bot = await this.stellarService.loadAccount(market.account);
    const baseBalance = find(bot.balances, market.base);
    const assetBalance = find(bot.balances, market.asset);
    this.logger.log(baseBalance, 'base balance');
    this.logger.log(assetBalance, 'asset balance');

    const totalIssued = await this.chargeRepo.createQueryBuilder()
      .where('Charge.asset = :asset', {asset: market.asset.asset_code})
      .select('SUM(tokens)')
      .getRawOne();
    this.logger.log(totalIssued, 'total issued');
    const issued = !totalIssued.sum || new BigNumber(totalIssued.sum).isZero() ? 1 : totalIssued.sum;
    const unitPriceBase = new BigNumber(baseBalance.balance).dividedBy(issued);
    const unitPriceAsset = new BigNumber(assetBalance.balance).dividedBy(issued);
    return {unitPriceBase, unitPriceAsset};
  }


}
