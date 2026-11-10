import { Body, Controller, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  type ActiveEvents,
  type CharacterInspect,
  type CharacterProfile,
  type CharacterSearchResult,
  characterIdSchema,
  characterSearchSchema,
  type HallOfFame,
  type HallOfFameSettings,
  hallOfFameSettingsSchema,
  type Leaderboard,
  type PlayerOverview,
  type SessionUser,
  type UpgradeStats,
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

  @Get('characters/:id/inspect')
  inspect(
    @Param('id', new ZodValidationPipe(characterIdSchema)) id: number,
    @CurrentUser() user: SessionUser,
  ): Promise<CharacterInspect> {
    return this.stats.inspect(user, id);
  }

  @Get('characters/search')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  search(@Query('q', new ZodValidationPipe(characterSearchSchema)) query: string): Promise<CharacterSearchResult[]> {
    return this.stats.searchCharacters(query);
  }

  @Get('hall-of-fame')
  hallOfFame(@CurrentUser() user: SessionUser): Promise<HallOfFame> {
    return this.stats.hallOfFame(user);
  }

  @Get('leaderboard')
  leaderboard(@CurrentUser() user: SessionUser): Promise<Leaderboard> {
    return this.stats.leaderboard(user);
  }

  @Get('upgrade-stats')
  upgradeStats(
    @Query('character', new ZodValidationPipe(characterIdSchema.optional())) characterId: number | undefined,
    @CurrentUser() user: SessionUser,
  ): Promise<UpgradeStats> {
    return this.stats.upgradeStats(user, characterId);
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
