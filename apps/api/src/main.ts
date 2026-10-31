import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { AppModule } from './app.module.js';
import { CONFIG, type AppConfig } from './config/config.js';

// The API runs from apps/api, and the single .env lives at the repo root.
dotenv.config({ path: path.resolve(process.cwd(), '../../.env'), quiet: true });

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { abortOnError: false });
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  await app.listen(app.get<AppConfig>(CONFIG).apiPort);
}

try {
  await bootstrap();
} catch (error) {
  console.error(`API failed to start: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
