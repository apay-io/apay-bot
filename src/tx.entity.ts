import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Generated, ManyToOne, Unique, ManyToMany } from 'typeorm';
import { BigNumber } from 'bignumber.js';
import { BigNumberToStringTransformer } from './app.transformers';
import { Charge } from './charge.entity';

@Entity()
@Unique(['txIn'])
export class Tx {
  @PrimaryGeneratedColumn('increment')
  id?: number;

  @CreateDateColumn()
  createdAt?: Date;

  @Column({
    length: 255,
    nullable: false,
  })
  currencyIn: string;

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
  amountIn: BigNumber;

  @Column({length: 255, nullable: false})
  txIn: string;

  @Column({
    type: 'boolean',
    nullable: false,
    default: false,
  })
  processed: boolean;

  @ManyToOne(type => Charge, charge => charge.txs, {
    persistence: true,
  })
  charge: Charge;
}
