import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Producer } from './producer.service';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  await app.listen(3000);

  const configService = app.get<ConfigService>(ConfigService);
  const producer = app.get<Producer>(Producer);

  const markets = configService.get('markets');
  for (const market of markets) {
    await producer.streamEffects(market);
  }
}
bootstrap();
