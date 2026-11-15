import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { GmModule } from '../gm/gm.module.js';
import { StatsModule } from '../stats/stats.module.js';
import { DEFAULT_REBIRTH_ANNOUNCER_TIMING, REBIRTH_ANNOUNCER_TIMING, RebirthAnnouncer } from './rebirth-announcer.js';
import { RebirthController } from './rebirth.controller.js';
import { REBIRTH_REPOSITORY, SqlRebirthRepository } from './rebirth.repository.js';
import { RebirthService } from './rebirth.service.js';

@Module({
  // GmModule for the audit log the GM routes write to; StatsModule for the baseline and its cache.
  imports: [AuthModule, GmModule, StatsModule],
  controllers: [RebirthController],
  providers: [
    RebirthService,
    RebirthAnnouncer,
    { provide: REBIRTH_REPOSITORY, useClass: SqlRebirthRepository },
    { provide: REBIRTH_ANNOUNCER_TIMING, useValue: DEFAULT_REBIRTH_ANNOUNCER_TIMING },
  ],
})
export class RebirthModule {}
