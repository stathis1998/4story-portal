import { Body, Controller, Get, HttpCode, Post, Put, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  type AchievementRewardRequest,
  achievementRewardRequestSchema,
  type AchievementsLiveRequest,
  achievementsLiveSchema,
  type AchievementsOverview,
  type GmAchievements,
  type News,
  type SessionUser,
} from '@4story-portal/shared';
import { GmGuard } from '../auth/gm-access.js';
import { CurrentUser, SessionGuard } from '../auth/session.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AchievementsService } from './achievements.service.js';

@Controller()
@UseGuards(SessionGuard)
export class AchievementsController {
  constructor(private readonly achievements: AchievementsService) {}

  @Get('me/achievements')
  overview(@CurrentUser() user: SessionUser): Promise<AchievementsOverview> {
    return this.achievements.overview(user);
  }

  @Get('news')
  news(@CurrentUser() user: SessionUser): Promise<News> {
    return this.achievements.news(user);
  }

  @Get('gm/achievements')
  @UseGuards(GmGuard)
  gm(): Promise<GmAchievements> {
    return this.achievements.gm();
  }

  @Put('gm/achievements/rewards')
  @UseGuards(GmGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  setReward(
    @Body(new ZodValidationPipe(achievementRewardRequestSchema)) body: AchievementRewardRequest,
    @CurrentUser() user: SessionUser,
  ): Promise<GmAchievements> {
    return this.achievements.setReward(body, user.username);
  }

  @Put('gm/achievements/live')
  @UseGuards(GmGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  setLive(
    @Body(new ZodValidationPipe(achievementsLiveSchema)) body: AchievementsLiveRequest,
    @CurrentUser() user: SessionUser,
  ): Promise<GmAchievements> {
    return this.achievements.setLive(body.live, user.username);
  }

  @Post('gm/achievements/test-announcement')
  @HttpCode(204)
  @UseGuards(GmGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  testAnnouncement(@CurrentUser() user: SessionUser): void {
    this.achievements.testAnnouncement(user.username);
  }
}
