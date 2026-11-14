import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  type GmWheel,
  gmIdSchema,
  type SessionUser,
  type WheelLiveRequest,
  wheelLiveSchema,
  type WheelPrizeInput,
  wheelPrizeSchema,
  type WheelSpinRequest,
  wheelSpinRequestSchema,
  type WheelSpinResult,
  type WheelState,
} from '@4story-portal/shared';
import type { Request } from 'express';
import { GmGuard } from '../auth/gm-access.js';
import { CurrentUser, SessionGuard } from '../auth/session.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { WheelService } from './wheel.service.js';

const idPipe = new ZodValidationPipe(gmIdSchema);
const prizePipe = new ZodValidationPipe(wheelPrizeSchema);
const actor = (user: SessionUser, req: Request) => ({ username: user.username, ip: req.ip ?? '' });

@Controller()
@UseGuards(SessionGuard)
export class WheelController {
  constructor(private readonly wheel: WheelService) {}

  @Get('wheel')
  state(@CurrentUser() user: SessionUser): Promise<WheelState> {
    return this.wheel.state(user);
  }

  @Post('wheel/spin')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  spin(
    @Body(new ZodValidationPipe(wheelSpinRequestSchema)) body: WheelSpinRequest,
    @CurrentUser() user: SessionUser,
  ): Promise<WheelSpinResult> {
    return this.wheel.spin(user, body.characterId);
  }

  @Get('gm/wheel')
  @UseGuards(GmGuard)
  gm(): Promise<GmWheel> {
    return this.wheel.gmState();
  }

  @Post('gm/wheel/prizes')
  @HttpCode(200)
  @UseGuards(GmGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  createPrize(@Body(prizePipe) body: WheelPrizeInput, @CurrentUser() user: SessionUser, @Req() req: Request): Promise<GmWheel> {
    return this.wheel.createPrize(body, actor(user, req));
  }

  @Put('gm/wheel/prizes/:id')
  @UseGuards(GmGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  updatePrize(
    @Param('id', idPipe) id: number,
    @Body(prizePipe) body: WheelPrizeInput,
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
  ): Promise<GmWheel> {
    return this.wheel.updatePrize(id, body, actor(user, req));
  }

  @Delete('gm/wheel/prizes/:id')
  @UseGuards(GmGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  deletePrize(@Param('id', idPipe) id: number, @CurrentUser() user: SessionUser, @Req() req: Request): Promise<GmWheel> {
    return this.wheel.deletePrize(id, actor(user, req));
  }

  @Put('gm/wheel/live')
  @UseGuards(GmGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  setLive(
    @Body(new ZodValidationPipe(wheelLiveSchema)) body: WheelLiveRequest,
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
  ): Promise<GmWheel> {
    return this.wheel.setLive(body.live, actor(user, req));
  }
}
