import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import type { OnlineCharacter } from '@4story-portal/shared';
import { SessionGuard } from '../auth/session.guard.js';
import { className } from '../characters/character-codes.js';
import { GM_REPOSITORY, type GmRepository } from '../gm/gm.repository.js';

@Controller('online')
@UseGuards(SessionGuard)
export class OnlineController {
  constructor(@Inject(GM_REPOSITORY) private readonly repo: GmRepository) {}

  // Every signed-in player can see this, so the map and world stay out of it.
  @Get()
  async list(): Promise<OnlineCharacter[]> {
    const rows = await this.repo.listOnlinePlayers();
    return rows.map(({ charId, name, level, classCode, channel }) => ({
      id: charId,
      name,
      level,
      className: className(classCode),
      channel,
    }));
  }
}
