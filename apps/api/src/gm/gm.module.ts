import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { type AppConfig, CONFIG } from '../config/config.js';
import { EventsController } from './events.controller.js';
import { EventsService } from './events.service.js';
import { GM_LOCATIONS_STORE, GmLocationsStore } from './gm-locations.store.js';
import { GmController } from './gm.controller.js';
import { GM_REPOSITORY, SqlGmRepository } from './gm.repository.js';
import { LOGIN_CLEAR_TIMING, LoginsService } from './logins.service.js';
import { TeleportService } from './teleport.service.js';
import { VendorsController } from './vendors.controller.js';
import { SqlVendorsRepository, VENDORS_REPOSITORY } from './vendors.repository.js';
import { VendorsService } from './vendors.service.js';

@Module({
  imports: [AuthModule],
  controllers: [GmController, VendorsController, EventsController],
  providers: [
    EventsService,
    TeleportService,
    LoginsService,
    VendorsService,
    { provide: VENDORS_REPOSITORY, useClass: SqlVendorsRepository },
    { provide: LOGIN_CLEAR_TIMING, useValue: { pollMs: 500, waitMs: 5000 } },
    { provide: GM_REPOSITORY, useClass: SqlGmRepository },
    {
      provide: GM_LOCATIONS_STORE,
      useFactory: (config: AppConfig) => new GmLocationsStore(config.gm.locationsFile),
      inject: [CONFIG],
    },
  ],
})
export class GmModule {}
