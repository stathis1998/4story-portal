import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  type GmEvent,
  gmEventIndexSchema,
  type GmEventInput,
  gmEventInputSchema,
  type GmEventList,
  type SessionUser,
} from '@4story-portal/shared';
import type { Request } from 'express';
import { GmGuard } from '../auth/gm-access.js';
import { CurrentUser, SessionGuard } from '../auth/session.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { EventsService } from './events.service.js';

const indexPipe = new ZodValidationPipe(gmEventIndexSchema);

@Controller('gm/events')
@UseGuards(SessionGuard, GmGuard)
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  list(): Promise<GmEventList> {
    return this.events.list();
  }

  @Post()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  create(
    @Body(new ZodValidationPipe(gmEventInputSchema)) body: GmEventInput,
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
  ): Promise<GmEvent> {
    return this.events.create(body, { username: user.username, ip: req.ip ?? '' });
  }

  @Put(':index')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  update(
    @Param('index', indexPipe) index: number,
    @Body(new ZodValidationPipe(gmEventInputSchema)) body: GmEventInput,
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
  ): Promise<GmEvent> {
    return this.events.update(index, body, { username: user.username, ip: req.ip ?? '' });
  }

  @Delete(':index')
  @HttpCode(204)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  remove(
    @Param('index', indexPipe) index: number,
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
  ): Promise<void> {
    return this.events.remove(index, { username: user.username, ip: req.ip ?? '' });
  }
}
