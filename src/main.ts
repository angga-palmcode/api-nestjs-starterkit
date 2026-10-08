import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { AppLogger } from './common/logger/app.logger';
import { Env } from './config/env.schema';

async function bootstrap(): Promise<void> {
  // bufferLogs: hold early Nest logs until AppLogger takes over in configureApp.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  configureApp(app);

  const port = app.get<ConfigService<Env, true>>(ConfigService).get('PORT', {
    infer: true,
  });
  await app.listen(port);
  app.get(AppLogger).log(`Listening on port ${port}`, 'Bootstrap');
}

void bootstrap();
