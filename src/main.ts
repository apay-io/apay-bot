import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Producer } from './producer.service';
import { ConfigService } from '@nestjs/config';
import { AppService } from './app.service';
import { StellarService } from './stellar.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  await app.listen(process.env.PORT || 3000);

  const configService = app.get<ConfigService>(ConfigService);
  const stellarService = app.get<StellarService>(StellarService);
  const producer = app.get<Producer>(Producer);

  const markets = configService.get('markets');
  for (const market of markets) {
    await producer.enqueue(market);
    // stellarService.streamEffects(market.account, async (effect) => {
    //   await producer.enqueue(market);
    // });
  }
}
bootstrap();
