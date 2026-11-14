import { Body, Controller, Get, HttpCode, Post, Put, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  type GmRoulette,
  type RouletteSettingsInput,
  rouletteSettingsSchema,
  type RouletteSpinRequest,
  rouletteSpinRequestSchema,
  type RouletteSpinResult,
  type RouletteState,
  type SessionUser,
} from '@4story-portal/shared';
import type { Request } from 'express';
import { GmGuard } from '../auth/gm-access.js';
import { CurrentUser, SessionGuard } from '../auth/session.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { RouletteService } from './roulette.service.js';

@Controller()
@UseGuards(SessionGuard)
export class RouletteController {
  constructor(private readonly roulette: RouletteService) {}

  @Get('roulette')
  state(@CurrentUser() user: SessionUser): Promise<RouletteState> {
    return this.roulette.state(user);
  }

  @Post('roulette/spin')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  spin(
    @Body(new ZodValidationPipe(rouletteSpinRequestSchema)) body: RouletteSpinRequest,
    @CurrentUser() user: SessionUser,
  ): Promise<RouletteSpinResult> {
    return this.roulette.spin(user, body.characterId, body.bets);
  }

  @Get('gm/roulette')
  @UseGuards(GmGuard)
  gm(): Promise<GmRoulette> {
    return this.roulette.gmState();
  }

  @Put('gm/roulette/settings')
  @UseGuards(GmGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  saveSettings(
    @Body(new ZodValidationPipe(rouletteSettingsSchema)) body: RouletteSettingsInput,
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
  ): Promise<GmRoulette> {
    return this.roulette.saveSettings(body, { username: user.username, ip: req.ip ?? '' });
  }
}
