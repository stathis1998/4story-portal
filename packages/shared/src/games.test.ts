import { describe, expect, it } from 'vitest';
import { silverText, walletSilver } from './games.js';

describe('games', () => {
  it.each([
    [0, '0 Silver'],
    [50, '50 Silver'],
    [1000, '1 Gold'],
    [1200, '1 Gold 200 Silver'],
    [1_000_000, '1,000 Gold'],
  ])('silverText(%i)', (silver, text) => expect(silverText(silver)).toBe(text));

  it('counts Gold and Silver, not loose Bronze', () =>
    expect(walletSilver({ gold: 2, silver: 5, copper: 999 })).toBe(2005));
});
