import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Generated, ManyToOne, Unique, ManyToMany, OneToMany } from 'typeorm';
import { Account } from './account.entity';
import { BigNumber } from 'bignumber.js';
import { BigNumberToStringTransformer } from './app.transformers';
import { Tx } from './tx.entity';

@Entity()
@Unique(['channel', 'sequence'])
export class Charge {
  @PrimaryGeneratedColumn('increment')
  id?: number;

  @CreateDateColumn()
  createdAt?: Date;

  @Column({
    length: 255,
    nullable: false,
  })
  asset: string;

  @Column({
    length: 255,
    nullable: false,
  })
  manager: string;

  @Column({
    type: 'decimal',
    precision: 30,
    scale: 18,
    transformer: new BigNumberToStringTransformer(),
    nullable: false,
  })
  baseAmount: BigNumber;

  @Column({
    type: 'decimal',
    precision: 30,
    scale: 18,
    transformer: new BigNumberToStringTransformer(),
    nullable: false,
  })
  assetAmount: BigNumber;

  @Column({
    length: 255,
    nullable: true,
  })
  channel?: string;

  @Column({
    length: 255,
    nullable: true,
  })
  sequence?: string;

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 12,
    transformer: new BigNumberToStringTransformer(),
    nullable: false,
    default: 0,
  })
  tokens: BigNumber;

  @Column({length: 255, nullable: true})
  txOut?: string;

  @ManyToOne(type => Account, account => account.charges, {
    eager: true, persistence: true,
  })
  account: Account;

  @OneToMany(type => Tx, tx => tx.charge, {
    eager: true, persistence: true,
  })
  txs: Tx[];
}
