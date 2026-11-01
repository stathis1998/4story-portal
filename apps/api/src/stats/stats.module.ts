import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ActiveEventsService } from './active-events.service.js';
import { StatsController } from './stats.controller.js';
import { SqlStatsRepository, STATS_REPOSITORY } from './stats.repository.js';
import { StatsService } from './stats.service.js';

@Module({
  imports: [AuthModule],
  controllers: [StatsController],
  providers: [StatsService, ActiveEventsService, { provide: STATS_REPOSITORY, useClass: SqlStatsRepository }],
})
export class StatsModule {}
