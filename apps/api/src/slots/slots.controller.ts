import { Body, Controller, Get, HttpCode, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  type GmSlots,
  type SessionUser,
  slotFloorSchema,
  type SlotJackpotSettingsInput,
  slotJackpotSettingsSchema,
  type SlotMachineKey,
  type SlotMachineSettingsInput,
  slotMachineSettingsSchema,
  type SlotSpinRequest,
  slotSpinRequestSchema,
  type SlotSpinResult,
  type SlotsState,
} from '@4story-portal/shared';
import type { Request } from 'express';
import { AccountThrottlerGuard } from '../auth/account-throttler.guard.js';
import { GmGuard } from '../auth/gm-access.js';
import { CurrentUser, SessionGuard } from '../auth/session.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { SlotsService } from './slots.service.js';

@Controller()
@UseGuards(SessionGuard)
export class SlotsController {
  constructor(private readonly slots: SlotsService) {}

  @Get('slots')
  state(@CurrentUser() user: SessionUser): Promise<SlotsState> {
    return this.slots.state(user);
  }

  @Post('slots/spin')
  @HttpCode(200)
  @UseGuards(AccountThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  spin(@Body(new ZodValidationPipe(slotSpinRequestSchema)) body: SlotSpinRequest, @CurrentUser() user: SessionUser): Promise<SlotSpinResult> {
    return this.slots.spin(user, body);
  }

  @Get('gm/slots')
  @UseGuards(GmGuard)
  gm(): Promise<GmSlots> {
    return this.slots.gmState();
  }

  @Put('gm/slots/floor')
  @UseGuards(GmGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  saveFloor(
    @Body(new ZodValidationPipe(slotFloorSchema)) body: { live: boolean },
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
  ): Promise<GmSlots> {
    return this.slots.saveFloor(body.live, { username: user.username, ip: req.ip ?? '' });
  }

  @Put('gm/slots/machines/:key')
  @UseGuards(GmGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  saveMachine(
    @Param('key') key: string,
    @Body(new ZodValidationPipe(slotMachineSettingsSchema)) body: SlotMachineSettingsInput,
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
  ): Promise<GmSlots> {
    // The service answers 404 for a key the code does not have.
    return this.slots.saveMachine(key as SlotMachineKey, body, { username: user.username, ip: req.ip ?? '' });
  }

  @Put('gm/slots/jackpot')
  @UseGuards(GmGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  saveJackpot(
    @Body(new ZodValidationPipe(slotJackpotSettingsSchema)) body: SlotJackpotSettingsInput,
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
  ): Promise<GmSlots> {
    return this.slots.saveJackpot(body, { username: user.username, ip: req.ip ?? '' });
  }
}
