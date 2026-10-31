import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { type AppConfig, CONFIG } from '../config/config.js';
import { ACCOUNTS_REPOSITORY, SqlAccountsRepository } from './accounts.repository.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { GmAccess, GmGuard } from './gm-access.js';
import { SessionGuard } from './session.guard.js';
import { SessionService } from './session.service.js';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [CONFIG],
      useFactory: (config: AppConfig) => ({ secret: config.jwtSecret }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionService,
    SessionGuard,
    GmAccess,
    GmGuard,
    { provide: ACCOUNTS_REPOSITORY, useClass: SqlAccountsRepository },
  ],
  exports: [SessionService, SessionGuard, GmAccess, GmGuard],
})
export class AuthModule {}
