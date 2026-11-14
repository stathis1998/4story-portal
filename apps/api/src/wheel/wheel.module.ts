import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { GmModule } from '../gm/gm.module.js';
import { ANNOUNCER_TIMING, DEFAULT_ANNOUNCER_TIMING, WheelAnnouncer } from './wheel-announcer.js';
import { WheelController } from './wheel.controller.js';
import { SqlWheelRepository, WHEEL_REPOSITORY } from './wheel.repository.js';
import { WheelService } from './wheel.service.js';

@Module({
  // GmModule for the audit log the GM routes write to.
  imports: [AuthModule, GmModule],
  controllers: [WheelController],
  providers: [
    WheelService,
    WheelAnnouncer,
    { provide: WHEEL_REPOSITORY, useClass: SqlWheelRepository },
    { provide: ANNOUNCER_TIMING, useValue: DEFAULT_ANNOUNCER_TIMING },
  ],
})
export class WheelModule {}
