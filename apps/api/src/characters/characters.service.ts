import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Character, LevelFreeze } from '@4story-portal/shared';
import { toCharacter } from './characters.mapper.js';
import { CHARACTERS_REPOSITORY, type CharactersRepository, type LevelFreezeRow } from './characters.repository.js';

@Injectable()
export class CharactersService {
  constructor(@Inject(CHARACTERS_REPOSITORY) private readonly characters: CharactersRepository) {}

  async list(userId: number): Promise<Character[]> {
    return (await this.characters.listByUser(userId)).map(toCharacter);
  }

  levelFreeze(userId: number, id: number): Promise<LevelFreeze> {
    return this.ownedFreeze(userId, id);
  }

  async setLevelFreeze(userId: number, id: number, level: number | null): Promise<LevelFreeze> {
    const current = await this.ownedFreeze(userId, id);
    // The map server reads the freeze only when it loads a character, so a change now would be
    // ignored and the character could level past a freeze that looks saved.
    if (current.online) throw new ConflictException('Log out of the game with this character first');
    if (level !== null && level < current.level) {
      throw new UnprocessableEntityException(`This character is already level ${current.level}`);
    }

    await this.characters.saveLevelFreeze(id, level);
    return { ...current, freezeLevel: level };
  }

  // The same answer whether it's someone else's or doesn't exist, so IDs can't be probed.
  private async ownedFreeze(userId: number, id: number): Promise<LevelFreezeRow> {
    const row = await this.characters.findLevelFreeze(userId, id);
    if (!row) throw new NotFoundException('Character not found');
    return row;
  }
}
