import { Body, Controller, Get, HttpCode, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  type AchievementRewardInput,
  characterIdSchema,
  type GmRebirth,
  type RebirthRequest,
  rebirthRequestSchema,
  rebirthRewardNumberSchema,
  rebirthRewardSchema,
  type RebirthSettingsInput,
  rebirthSettingsSchema,
  type RebirthState,
  type SessionUser,
} from '@4story-portal/shared';
import type { Request } from 'express';
import { GmGuard } from '../auth/gm-access.js';
import { CurrentUser, SessionGuard } from '../auth/session.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { RebirthService } from './rebirth.service.js';

@Controller()
@UseGuards(SessionGuard)
export class RebirthController {
  constructor(private readonly rebirth: RebirthService) {}

  @Get('characters/:id/rebirth')
  state(@Param('id', new ZodValidationPipe(characterIdSchema)) id: number, @CurrentUser() user: SessionUser): Promise<RebirthState> {
    return this.rebirth.state(user.userId, id);
  }

  @Post('characters/:id/rebirth')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  reborn(
    @Param('id', new ZodValidationPipe(characterIdSchema)) id: number,
    @Body(new ZodValidationPipe(rebirthRequestSchema)) body: RebirthRequest,
    @CurrentUser() user: SessionUser,
  ): Promise<RebirthState> {
    return this.rebirth.rebirth(user.userId, id, body.priceGold);
  }

  @Get('gm/rebirth')
  @UseGuards(GmGuard)
  gm(): Promise<GmRebirth> {
    return this.rebirth.gmState();
  }

  @Put('gm/rebirth/settings')
  @UseGuards(GmGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  saveSettings(
    @Body(new ZodValidationPipe(rebirthSettingsSchema)) body: RebirthSettingsInput,
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
  ): Promise<GmRebirth> {
    return this.rebirth.saveSettings(body, { username: user.username, ip: req.ip ?? '' });
  }

  @Put('gm/rebirth/rewards/:rebirth')
  @UseGuards(GmGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  setReward(
    @Param('rebirth', new ZodValidationPipe(rebirthRewardNumberSchema)) rebirth: number,
    @Body(new ZodValidationPipe(rebirthRewardSchema)) body: AchievementRewardInput,
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
  ): Promise<GmRebirth> {
    return this.rebirth.setReward(rebirth, body, { username: user.username, ip: req.ip ?? '' });
  }
}
