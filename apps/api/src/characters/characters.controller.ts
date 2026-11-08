import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import {
  characterIdSchema,
  levelFreezeRequestSchema,
  type Character,
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
}
