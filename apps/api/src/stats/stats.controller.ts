import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  type ActiveEvents,
  type CharacterProfile,
  characterIdSchema,
  type HallOfFame,
  type HallOfFameSettings,
  hallOfFameSettingsSchema,
  type Leaderboard,
  type PlayerOverview,
  type SessionUser,
} from '@4story-portal/shared';
import { GmGuard } from '../auth/gm-access.js';
import { CurrentUser, SessionGuard } from '../auth/session.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ActiveEventsService } from './active-events.service.js';
import { StatsService } from './stats.service.js';

@Controller()
@UseGuards(SessionGuard)
export class StatsController {
  constructor(
    private readonly stats: StatsService,
    private readonly activeEvents: ActiveEventsService,
  ) {}

  @Get('me/overview')
  overview(@CurrentUser() user: SessionUser): Promise<PlayerOverview> {
    return this.stats.overview(user);
  }

  @Get('characters/:id/profile')
  profile(
    @Param('id', new ZodValidationPipe(characterIdSchema)) id: number,
    @CurrentUser() user: SessionUser,
  ): Promise<CharacterProfile> {
    return this.stats.profile(user, id);
  }

  @Get('hall-of-fame')
  hallOfFame(@CurrentUser() user: SessionUser): Promise<HallOfFame> {
    return this.stats.hallOfFame(user);
  }

  @Get('leaderboard')
  leaderboard(@CurrentUser() user: SessionUser): Promise<Leaderboard> {
    return this.stats.leaderboard(user);
  }

  @Get('events/active')
  events(): Promise<ActiveEvents> {
    return this.activeEvents.list();
  }

  @Put('gm/hall-of-fame/settings')
  @UseGuards(GmGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  settings(
    @Body(new ZodValidationPipe(hallOfFameSettingsSchema)) body: HallOfFameSettings,
    @CurrentUser() user: SessionUser,
  ): HallOfFameSettings {
    return this.stats.setHideGms(body.hideGms, user.username);
  }
}
