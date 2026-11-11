import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import {
  characterIdSchema,
  gearEffectRequestSchema,
  levelFreezeRequestSchema,
  type Character,
  type GearEffect,
  type GearEffectRequest,
  type LevelFreeze,
  type LevelFreezeRequest,
  type SessionUser,
} from '@4story-portal/shared';
import { CurrentUser, SessionGuard } from '../auth/session.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CharactersService } from './characters.service.js';

@Controller('characters')
@UseGuards(SessionGuard)
export class CharactersController {
  constructor(private readonly characters: CharactersService) {}

  @Get()
  list(@CurrentUser() user: SessionUser): Promise<Character[]> {
    return this.characters.list(user.userId);
  }

  @Get(':id/level-freeze')
  levelFreeze(
    @Param('id', new ZodValidationPipe(characterIdSchema)) id: number,
    @CurrentUser() user: SessionUser,
  ): Promise<LevelFreeze> {
    return this.characters.levelFreeze(user.userId, id);
  }

  @Put(':id/level-freeze')
  setLevelFreeze(
    @Param('id', new ZodValidationPipe(characterIdSchema)) id: number,
    @Body(new ZodValidationPipe(levelFreezeRequestSchema)) body: LevelFreezeRequest,
    @CurrentUser() user: SessionUser,
  ): Promise<LevelFreeze> {
    return this.characters.setLevelFreeze(user.userId, id, body.level);
  }

  @Get(':id/gear-effect')
  gearEffect(
    @Param('id', new ZodValidationPipe(characterIdSchema)) id: number,
    @CurrentUser() user: SessionUser,
  ): Promise<GearEffect> {
    return this.characters.gearEffect(user.userId, id);
  }

  @Put(':id/gear-effect')
  setGearEffect(
    @Param('id', new ZodValidationPipe(characterIdSchema)) id: number,
    @Body(new ZodValidationPipe(gearEffectRequestSchema)) body: GearEffectRequest,
    @CurrentUser() user: SessionUser,
  ): Promise<GearEffect> {
    return this.characters.setGearEffect(user.userId, id, body.effect);
  }
}
