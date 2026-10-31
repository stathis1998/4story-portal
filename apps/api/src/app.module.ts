import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module.js';
import { CharactersModule } from './characters/characters.module.js';
import { ConfigModule } from './config/config.js';
import { DbModule } from './db/db.module.js';

@Module({
  imports: [
    ConfigModule,
    DbModule,
    // Applied only where ThrottlerGuard is used (register and login), which override these defaults.
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 100 }],
      errorMessage: 'Too many attempts. Please try again later.',
    }),
    AuthModule,
    CharactersModule,
  ],
})
export class AppModule {}
