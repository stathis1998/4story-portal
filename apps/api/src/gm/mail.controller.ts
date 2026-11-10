import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { type GmMailRequest, type GmMailResponse, gmMailRequestSchema, type SessionUser } from '@4story-portal/shared';
import type { Request } from 'express';
import { GmGuard } from '../auth/gm-access.js';
import { CurrentUser, SessionGuard } from '../auth/session.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { MailService } from './mail.service.js';

@Controller('gm')
@UseGuards(SessionGuard, GmGuard)
export class MailController {
  constructor(private readonly mail: MailService) {}

  @Post('mail')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  send(
    @Body(new ZodValidationPipe(gmMailRequestSchema)) body: GmMailRequest,
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
  ): Promise<GmMailResponse> {
    return this.mail.send(body, { username: user.username, ip: req.ip ?? '' });
  }
}
