import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueryFailedError, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Tx } from './tx.entity';
import { Account } from './account.entity';

@Injectable()
export class AppService {
  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(Account)
    protected readonly accountRepo: Repository<Account>,
    @InjectRepository(Tx)
    protected readonly txRepo: Repository<Tx>,
  ) {
  }
}
