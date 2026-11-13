import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { StatsModule } from '../stats/stats.module.js';
import { AchievementAwarder, AWARDER_TIMING, DEFAULT_AWARDER_TIMING } from './achievement-awarder.js';
import { AchievementsController } from './achievements.controller.js';
import { ACHIEVEMENTS_REPOSITORY, SqlAchievementsRepository } from './achievements.repository.js';
import { AchievementsService } from './achievements.service.js';

@Module({
  imports: [AuthModule, StatsModule],
  controllers: [AchievementsController],
  providers: [
    AchievementsService,
    AchievementAwarder,
    { provide: ACHIEVEMENTS_REPOSITORY, useClass: SqlAchievementsRepository },
    { provide: AWARDER_TIMING, useValue: DEFAULT_AWARDER_TIMING },
  ],
})
export class AchievementsModule {}
