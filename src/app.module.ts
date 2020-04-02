import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import configuration from './config/configuration';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Producer } from './producer.service';
import { BullModule } from '@nestjs/bull';
import { EventsProcessor } from './events.processor';
import { StellarService } from './stellar.service';

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

  ],
  controllers: [AppController],
  providers: [AppService, Producer, EventsProcessor, StellarService],
})
export class AppModule {}
