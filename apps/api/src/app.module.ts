import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module.js';
import { CharactersModule } from './characters/characters.module.js';
import { ConfigModule } from './config/config.js';
import { ControlModule } from './control/control.module.js';
import { DbModule } from './db/db.module.js';
import { GmModule } from './gm/gm.module.js';
import { StatsModule } from './stats/stats.module.js';
import { StoreModule } from './store/store.module.js';
import { WeaponsModule } from './weapons/weapons.module.js';

@Module({
  imports: [
    ConfigModule,
    DbModule,
    ControlModule,
    // Applied only where ThrottlerGuard is used (register and login), which override these defaults.
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 100 }],
      errorMessage: 'Too many attempts. Please try again later.',
    }),
    AuthModule,
    CharactersModule,
    GmModule,
    StatsModule,
    WeaponsModule,
    StoreModule,
  ],
})
export class AppModule {}
