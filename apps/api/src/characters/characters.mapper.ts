import type { Character } from '@4story-portal/shared';
import { className, countryName, raceName } from './character-codes.js';
import type { CharacterRow } from './characters.repository.js';

export function toCharacter(row: CharacterRow): Character {
  return {
    id: row.dwCharID,
    slot: row.bSlot,
    name: row.szNAME,
    level: row.bLevel,
    className: className(row.bClass),
    race: raceName(row.bRace),
    country: countryName(row.bCountry),
    money: { gold: row.dwGold, silver: row.dwSilver, copper: row.dwCooper },
    mapId: row.wMapID,
    createdAt: row.dCreateDate?.toISOString() ?? null,
    lastLogoutAt: row.dLogoutDate?.toISOString() ?? null,
  };
}
