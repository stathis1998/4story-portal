import { Inject, Injectable } from '@nestjs/common';
import type { Character } from '@4story-portal/shared';
import { toCharacter } from './characters.mapper.js';
import { CHARACTERS_REPOSITORY, type CharactersRepository } from './characters.repository.js';

@Injectable()
export class CharactersService {
  constructor(@Inject(CHARACTERS_REPOSITORY) private readonly characters: CharactersRepository) {}

  async list(userId: number): Promise<Character[]> {
    return (await this.characters.listByUser(userId)).map(toCharacter);
  }
}
