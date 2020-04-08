import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Generated, OneToMany } from 'typeorm';
import { Charge } from './charge.entity';

@Entity()
export class Account {
  @PrimaryGeneratedColumn('increment')
  id: number;

  @Column()
  @Generated('uuid')
  uuid: string;

  @CreateDateColumn()
  createdAt: Date;

  @Column({
    length: 255,
    nullable: false,
  })
  account: string;

  @OneToMany(type => Charge, charge => charge.account, {
    lazy: true,
  })
  charges: Charge[];
}
