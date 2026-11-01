import { describe, expect, it } from 'vitest';
import { characterIdSchema, hallOfFameSettingsSchema } from './player-stats.js';

describe('characterIdSchema', () => {
  it.each(['abc', '0', '-1', '2147483648', '1.5'])('refuses %s', (value) => {
    expect(characterIdSchema.safeParse(value).success).toBe(false);
  });

  it('coerces a route parameter', () => {
    expect(characterIdSchema.parse('2147483647')).toBe(2147483647);
  });
});

describe('hallOfFameSettingsSchema', () => {
  it('accepts a boolean', () => {
    expect(hallOfFameSettingsSchema.parse({ hideGms: true })).toEqual({ hideGms: true });
  });

  it.each([{}, { hideGms: 'yes' }, { hideGms: 1 }])('refuses %j', (body) => {
    expect(hallOfFameSettingsSchema.safeParse(body).success).toBe(false);
  });
});
