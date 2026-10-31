import { Controller, Get, UseGuards } from '@nestjs/common';
import type { Character, SessionUser } from '@4story-portal/shared';
import { CurrentUser, SessionGuard } from '../auth/session.guard.js';
import { CharactersService } from './characters.service.js';

@Controller('characters')
@UseGuards(SessionGuard)
export class CharactersController {
  constructor(private readonly characters: CharactersService) {}

  @Get()
  list(@CurrentUser() user: SessionUser): Promise<Character[]> {
    return this.characters.list(user.userId);
  }
}
