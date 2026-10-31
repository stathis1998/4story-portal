import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  type GmLocation,
  type GmLocationInput,
  gmLocationInputSchema,
  type GmStatus,
  type OnlinePlayer,
  type SessionUser,
  type TeleportRequest,
  type TeleportResult,
  teleportRequestSchema,
} from '@4story-portal/shared';
import type { Request } from 'express';
import { GmGuard } from '../auth/gm-access.js';
import { CurrentUser, SessionGuard } from '../auth/session.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ControlClient } from '../control/control-client.js';
import { GM_LOCATIONS_STORE, GmLocationsStore, InvalidPresetFileError } from './gm-locations.store.js';
import { GM_REPOSITORY, type GmRepository } from './gm.repository.js';
import { TeleportService } from './teleport.service.js';

@Controller('gm')
@UseGuards(SessionGuard, GmGuard)
export class GmController {
  constructor(
    private readonly control: ControlClient,
    @Inject(GM_REPOSITORY) private readonly repo: GmRepository,
    @Inject(GM_LOCATIONS_STORE) private readonly locations: GmLocationsStore,
    private readonly teleports: TeleportService,
  ) {}

  @Get('status')
  async status(): Promise<GmStatus> {
    return { ...this.control.status(), channels: await this.repo.listChannels() };
  }

  @Get('players')
  players(): Promise<OnlinePlayer[]> {
    return this.teleports.onlinePlayers();
  }

  @Post('teleport')
  @HttpCode(202)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  teleport(
    @Body(new ZodValidationPipe(teleportRequestSchema)) body: TeleportRequest,
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
  ): Promise<TeleportResult> {
    return this.teleports.teleport(body, { username: user.username, ip: req.ip ?? '' });
  }

  @Get('locations')
  listLocations(): Promise<GmLocation[]> {
    return this.presets(() => this.locations.list());
  }

  @Post('locations')
  addLocation(@Body(new ZodValidationPipe(gmLocationInputSchema)) body: GmLocationInput): Promise<GmLocation> {
    return this.presets(() => this.locations.add(body));
  }

  @Delete('locations/:id')
  @HttpCode(204)
  async removeLocation(@Param('id') id: string): Promise<void> {
    if (!(await this.presets(() => this.locations.remove(id)))) throw new NotFoundException('Preset not found');
  }

  private async presets<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof InvalidPresetFileError) throw new InternalServerErrorException('Preset file is invalid');
      throw error;
    }
  }
}
