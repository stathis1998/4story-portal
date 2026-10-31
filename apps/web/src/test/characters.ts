import type { Character } from '@4story-portal/shared'

export function character(overrides: Partial<Character> = {}): Character {
  return {
    id: 1,
    slot: 0,
    name: 'Moosey',
    level: 45,
    className: 'Wizard',
    race: 'Human',
    country: 'Defugel',
    money: { gold: 1234, silver: 56, copper: 78 },
    mapId: 12,
    createdAt: '2025-01-02T03:04:00.000Z',
    lastLogoutAt: '2026-10-30T20:00:00.000Z',
    ...overrides,
  }
}
