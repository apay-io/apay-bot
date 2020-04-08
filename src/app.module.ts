import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import configuration from './config/configuration';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Producer } from './producer.service';
import { BullModule } from '@nestjs/bull';
import { EventsProcessor } from './events.processor';
import { StellarService } from './stellar.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tx } from './tx.entity';
import { Account } from './account.entity';
import { Charge } from './charge.entity';

@Module({
  imports: [
    BullModule.registerQueueAsync({
      name: 'events',
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        return {
          redis: config.get('redis'),
        };
      },
      imports: [ConfigService],
    }),
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    TypeOrmModule.forRootAsync({
      useFactory: (config: ConfigService) => config.get('database'),
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([Account, Charge, Tx]),
  ],
  controllers: [AppController],
  providers: [AppService, Producer, EventsProcessor, StellarService],
})
export class AppModule {}
