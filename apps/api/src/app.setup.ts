import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import type { Express } from 'express';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';

// Shared by main.ts and the HTTP tests so both run the same request pipeline.
export function configureApp(app: INestApplication): void {
  // Browsers reach the API through Vite's proxy on this machine. Trusting X-Forwarded-For from
  // loopback only gives each player their own rate-limit bucket without letting anyone who
  // connects directly fake their address.
  (app.getHttpAdapter().getInstance() as Express).set('trust proxy', 'loopback');
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useGlobalFilters(new AllExceptionsFilter());
}
