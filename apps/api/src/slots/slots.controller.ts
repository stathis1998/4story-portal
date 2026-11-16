import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  type GmSlots,
  type SessionUser,
  slotDailySchema,
  slotFloorSchema,
  type SlotMachineKey,
  type SlotMachineSettingsInput,
  slotMachineSettingsSchema,
  type SlotPotsSettingsInput,
  slotPotsSettingsSchema,
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

/**
 * The spin's body, read by its schema. A page from before the cascades sends no rules (or older ones) and shows the
 * message of a refusal, not its fields, so that refusal carries the schema's words as its message.
 */
class SpinRequestPipe extends ZodValidationPipe<typeof slotSpinRequestSchema> {
  constructor() {
    super(slotSpinRequestSchema);
  }

  override transform(value: unknown): SlotSpinRequest {
    try {
      return super.transform(value);
    } catch (error) {
      const body = error instanceof BadRequestException ? (error.getResponse() as { fieldErrors?: Record<string, string[] | undefined> }) : null;
      const rules = body?.fieldErrors?.rules?.[0];
      if (rules) throw new BadRequestException({ ...body, message: rules });
      throw error;
    }
  }
}

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
  @Throttle({ default: { limit: 45, ttl: 60_000 } })
  spin(@Body(new SpinRequestPipe()) body: SlotSpinRequest, @CurrentUser() user: SessionUser): Promise<SlotSpinResult> {
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

  @Put('gm/slots/jackpots')
  @UseGuards(GmGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  savePots(
    @Body(new ZodValidationPipe(slotPotsSettingsSchema)) body: SlotPotsSettingsInput,
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
  ): Promise<GmSlots> {
    return this.slots.savePots(body, { username: user.username, ip: req.ip ?? '' });
  }

  @Put('gm/slots/daily')
  @UseGuards(GmGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  saveDaily(
    @Body(new ZodValidationPipe(slotDailySchema)) body: { rounds: number },
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
  ): Promise<GmSlots> {
    return this.slots.saveDaily(body.rounds, { username: user.username, ip: req.ip ?? '' });
  }
}
