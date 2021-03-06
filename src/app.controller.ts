import { BadRequestException, Body, Controller, Get, InternalServerErrorException, Logger, NotFoundException, Post, Query } from '@nestjs/common';
import { AppService } from './app.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Account } from './account.entity';
import { Repository } from 'typeorm';
import { StellarService } from './stellar.service';
import { ConfigService } from '@nestjs/config';
import { find, isEqual, map } from 'lodash';
import { BigNumber } from 'bignumber.js';
import { Asset, Operation } from 'stellar-sdk';
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

  @Get('/')
  hello() {
    return 'Hello world';
  }

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
    // todo: check for APAY___ trustline

    if (baseSum.isZero() || assetSum.isZero()) {
      throw new BadRequestException('Insufficient txs');
    }
    const {unitPriceBase, unitPriceAsset} = await this.calculateUnitPrices(market, true);

    const unitsOfBase = baseSum.dividedBy(unitPriceBase).toFixed(7);
    const unitsOfAsset = assetSum.dividedBy(unitPriceAsset).toFixed(7);
    this.logger.log(unitsOfBase, 'units of base');
    this.logger.log(unitsOfAsset, 'units of asset');
    const minUnits = new BigNumber(unitsOfBase).lt(unitsOfAsset) ? unitsOfBase : unitsOfAsset;

    const depositBase = minUnits === unitsOfBase ? baseSum.toFixed(7) : unitPriceBase.multipliedBy(minUnits).toFixed(7);
    const depositAsset = minUnits === unitsOfAsset ? assetSum.toFixed(7) : unitPriceAsset.multipliedBy(minUnits).toFixed(7);
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
        asset: market.asset.asset_code || 'XLM',
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
        asset: new Asset(`APAY${market.asset.asset_code || 'XLM'}`, market.manager),
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
    if (op.asset_code !== `APAY${market.asset.asset_code || 'XLM'}`) {
      throw new BadRequestException('Invalid asset');
    }
    const tx = await op.transaction();
    const account = await this.accountRepo.findOne(tx.memo);
    if (!tx.memo || !account) {
      throw new NotFoundException('Invalid tx');
    }

    const loadedAccount = await this.stellarService.loadAccount(account.account);
    if (!find(loadedAccount.balances, market.asset) || !find(loadedAccount.balances, market.base)) {
      throw new BadRequestException('No trustline');
    }

    const {unitPriceBase, unitPriceAsset} = await this.calculateUnitPrices(market, true);
    const { channel, sequence } = await this.stellarService.assignChannelAndSequence(market.manager);

    const saved = await this.txRepo.save({
      manager: market.manager,
      currencyIn: op.asset_code || 'XLM',
      amountIn: new BigNumber(op.amount),
      txIn: op.id,
    });
    const charge = await this.chargeRepo.save({
      account,
      asset: market.asset.asset_code || 'XLM',
      tokens: new BigNumber(op.amount).negated(),
      baseAmount: new BigNumber(unitPriceBase.multipliedBy(op.amount).toFixed(7)).negated(),
      assetAmount: new BigNumber(unitPriceAsset.multipliedBy(op.amount).toFixed(7)).negated(),
      manager: market.manager,
      channel,
      sequence,
      txs: [saved],
    } as Charge);

    await this.stellarService.buildAndSubmitTx([
      Operation.payment({
        destination: account.account,
        asset: this.stellarService.assetFromObject(market.base),
        amount: charge.baseAmount.negated().toFixed(7),
        source: market.account,
      }),
      Operation.payment({
        destination: account.account,
        asset: this.stellarService.assetFromObject(market.asset),
        amount: charge.assetAmount.negated().toFixed(7),
        source: market.account,
      }),
    ], {
      source: channel,
      sequence,
      signers: [market.account],
    });
  }

  private async calculateUnitPrices(market, nocache = false) {
    const bot = nocache
      ? await this.stellarService.loadAccount(market.account)
      : await this.stellarService.loadAccountCached(market.account);
    const baseBalance = find(bot.balances, market.base);
    const assetBalance = find(bot.balances, market.asset);
    this.logger.log(baseBalance, 'base balance');
    this.logger.log(assetBalance, 'asset balance');

    const totalIssued = await this.chargeRepo.createQueryBuilder()
      .where('Charge.asset = :asset', {asset: market.asset.asset_code || 'XLM'})
      .select('SUM(tokens)')
      .getRawOne();
    this.logger.log(totalIssued, 'total issued');
    const issued = !totalIssued.sum || new BigNumber(totalIssued.sum).isZero() ? 1 : totalIssued.sum;
    const unitPriceBase = new BigNumber(baseBalance.balance).dividedBy(issued);
    const unitPriceAsset = new BigNumber(assetBalance.balance).dividedBy(issued);
    return {unitPriceBase, unitPriceAsset, issued};
  }

  @Get('/stats')
  async stats(@Query('account') account: string) {
    const contributions = await this.chargeRepo.createQueryBuilder()
      .where('1=1 OR "accountId" = :account', {account})
      .select('asset, SUM("baseAmount") as "baseTotal", SUM("assetAmount") as "assetTotal", SUM(tokens) as "tokensTotal"')
      .addSelect('sum(case when "accountId" = :account then "assetAmount" else 0 end)', 'accountAsset')
      .addSelect('sum(case when "accountId" = :account then "baseAmount" else 0 end)', 'accountBase')
      .addSelect('sum(case when "accountId" = :account then "tokens" else 0 end)', 'accountTokens')
      .groupBy('asset')
      .getRawMany();

    const result = [];
    for (const item of contributions) {
      const market = find(this.configService.get('markets'), v => v.asset.asset_code === item.asset
        || item.asset === 'XLM' && v.asset.asset_type === 'native');
      if (market) {
        const {unitPriceBase, unitPriceAsset, issued} = await this.calculateUnitPrices(market);
        result.push({
          ...item,
          unitPriceBase,
          unitPriceAsset,
          issued,
        });
      }
    }
    return result;
  }
}
