import { describe, expect, it } from 'vitest';
import { className, countryName, raceName } from '../src/characters/character-codes.js';
import { toCharacter } from '../src/characters/characters.mapper.js';
import { characterRow } from './fakes.js';

describe('character codes', () => {
  it('maps class codes', () =>
    expect([0, 1, 2, 3, 4, 5].map(className)).toEqual(['Warrior', 'Ranger', 'Archer', 'Wizard', 'Priest', 'Sorcerer']));

  it('maps race codes', () => expect([0, 1, 2].map(raceName)).toEqual(['Human', 'Beast', 'Nymph']));

  it('maps country codes', () =>
    expect([0, 1, 2, 3, 4].map(countryName)).toEqual(['Defugel', 'Craxion', 'Country B', 'Neutral', 'Peace']));
});

describe('toCharacter', () => {
  it('maps a full row', () =>
    expect(
      toCharacter(
        characterRow({
          dwCharID: 11,
          bSlot: 2,
          szNAME: 'Moosey',
          bLevel: 45,
          dwGold: 1234,
          dwSilver: 56,
          dwCooper: 78,
          wMapID: 12,
          dCreateDate: new Date('2025-01-02T03:04:00Z'),
          dLogoutDate: new Date('2026-10-30T20:00:00Z'),
        }),
      ),
    ).toEqual({
      id: 11,
      slot: 2,
      name: 'Moosey',
      level: 45,
      className: 'Wizard',
      race: 'Human',
      country: 'Defugel',
      money: { gold: 1234, silver: 56, copper: 78 },
      mapId: 12,
      createdAt: '2025-01-02T03:04:00.000Z',
      lastLogoutAt: '2026-10-30T20:00:00.000Z',
    }));

  it('handles unknown codes and missing dates', () =>
    expect(
      toCharacter(characterRow({ bClass: 9, bRace: 7, bCountry: 12, dCreateDate: null, dLogoutDate: null })),
    ).toMatchObject({
      className: 'Unknown (9)',
      race: 'Unknown (7)',
      country: 'Unknown (12)',
      createdAt: null,
      lastLogoutAt: null,
    }));
});
