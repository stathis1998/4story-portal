import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { type AppConfig, CONFIG } from '../config/config.js';
import { GM_LOCATIONS_STORE, GmLocationsStore } from './gm-locations.store.js';
import { GmController } from './gm.controller.js';
import { GM_REPOSITORY, SqlGmRepository } from './gm.repository.js';
import { TeleportService } from './teleport.service.js';

@Module({
  imports: [AuthModule],
  controllers: [GmController],
  providers: [
    TeleportService,
    { provide: GM_REPOSITORY, useClass: SqlGmRepository },
    {
      provide: GM_LOCATIONS_STORE,
      useFactory: (config: AppConfig) => new GmLocationsStore(config.gm.locationsFile),
      inject: [CONFIG],
    },
  ],
})
export class GmModule {}
