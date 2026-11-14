import { describe, expect, it } from 'vitest';
import {
  ROULETTE_DEFAULT_LIMITS,
  ROULETTE_OUTSIDE,
  ROULETTE_POCKETS,
  ROULETTE_SPOTS,
  checkBets,
  isNumberSpot,
  rouletteChips,
  rouletteColour,
  rouletteSettingsSchema,
  rouletteSpinRequestSchema,
  settleBets,
  spotCovers,
  spotLabel,
  spotLimit,
  spotOdds,
  type RouletteBet,
  type RouletteSpot,
} from './roulette.js';

describe('roulette table', () => {
  it('has 37 different pockets starting 0, 32, 15 and ending 3, 26', () => {
    expect(ROULETTE_POCKETS).toHaveLength(37);
    expect(new Set(ROULETTE_POCKETS).size).toBe(37);
    expect(ROULETTE_POCKETS.slice(0, 3)).toEqual([0, 32, 15]);
    expect(ROULETTE_POCKETS.slice(-2)).toEqual([3, 26]);
  });

  it('has 18 red, 18 black and one green pocket', () => {
    const colours = Array.from({ length: 37 }, (_, n) => rouletteColour(n));
    expect(colours.filter((c) => c === 'red')).toHaveLength(18);
    expect(colours.filter((c) => c === 'black')).toHaveLength(18);
    expect(colours.filter((c) => c === 'green')).toHaveLength(1);
    expect(rouletteColour(0)).toBe('green');
    expect(rouletteColour(1)).toBe('red');
    expect(rouletteColour(2)).toBe('black');
  });

  it('has 49 spots', () => expect(ROULETTE_SPOTS).toHaveLength(49));

  it('tells number spots from outside spots', () => {
    expect(isNumberSpot('n0')).toBe(true);
    expect(isNumberSpot('n36')).toBe(true);
    expect(isNumberSpot('red')).toBe(false);
  });

  it('every outside spot covers 18 or 12 numbers and never zero', () => {
    for (const spot of ROULETTE_OUTSIDE) {
      const covered = ROULETTE_POCKETS.filter((p) => spotCovers(spot, p));
      expect(covered).toHaveLength(spotOdds(spot) === 1 ? 18 : 12);
      expect(spotCovers(spot, 0)).toBe(false);
    }
  });

  it('a number spot covers only its own number', () => {
    expect(ROULETTE_POCKETS.filter((p) => spotCovers('n17', p))).toEqual([17]);
    expect(spotCovers('n0', 0)).toBe(true);
  });

  it('columns follow the table rows', () => {
    expect(spotCovers('column1', 1)).toBe(true);
    expect(spotCovers('column1', 34)).toBe(true);
    expect(spotCovers('column3', 3)).toBe(true);
    expect(spotCovers('column3', 36)).toBe(true);
    expect(spotCovers('column2', 35)).toBe(true);
    expect(spotCovers('column2', 36)).toBe(false);
  });

  it('dozens, halves and parity cover the right numbers', () => {
    expect(spotCovers('low', 18)).toBe(true);
    expect(spotCovers('low', 19)).toBe(false);
    expect(spotCovers('high', 19)).toBe(true);
    expect(spotCovers('dozen2', 13)).toBe(true);
    expect(spotCovers('dozen2', 24)).toBe(true);
    expect(spotCovers('dozen2', 25)).toBe(false);
    expect(spotCovers('odd', 17)).toBe(true);
    expect(spotCovers('even', 17)).toBe(false);
    expect(spotCovers('red', 17)).toBe(false);
    expect(spotCovers('black', 17)).toBe(true);
  });

  it.each([
    ['n17', 35],
    ['red', 1],
    ['dozen2', 2],
    ['column3', 2],
    ['high', 1],
  ] as [RouletteSpot, number][])('%s pays %i to 1', (spot, odds) => expect(spotOdds(spot)).toBe(odds));

  it('labels spots for people', () => {
    expect(spotLabel('n17')).toBe('17');
    expect(spotLabel('red')).toBe('Red');
    expect(spotLabel('low')).toBe('1 to 18');
    expect(spotLabel('high')).toBe('19 to 36');
    expect(spotLabel('dozen1')).toBe('1 to 12');
    expect(spotLabel('dozen2')).toBe('13 to 24');
    expect(spotLabel('dozen3')).toBe('25 to 36');
    expect(spotLabel('column2')).toBe('Column 2');
  });
});

describe('settleBets', () => {
  it('pays a number 36 times its stake back', () =>
    expect(settleBets([{ spot: 'n17', amount: 100 }], 17)).toEqual({
      stake: 100,
      payout: 3600,
      winning: ['n17'],
      numberHit: true,
    }));

  it('pays every winning spot and keeps the losers', () =>
    expect(
      settleBets(
        [
          { spot: 'n17', amount: 100 },
          { spot: 'black', amount: 500 },
          { spot: 'dozen2', amount: 200 },
          { spot: 'even', amount: 50 },
        ],
        17,
      ),
    ).toEqual({ stake: 850, payout: 3600 + 1000 + 600, winning: ['n17', 'black', 'dozen2'], numberHit: true }));

  it('does not call an outside win a number hit', () =>
    expect(settleBets([{ spot: 'red', amount: 10 }], 1)).toEqual({
      stake: 10,
      payout: 20,
      winning: ['red'],
      numberHit: false,
    }));

  it('zero beats every outside spot', () =>
    expect(settleBets(ROULETTE_OUTSIDE.map((spot) => ({ spot, amount: 10 })), 0)).toMatchObject({
      stake: 120,
      payout: 0,
      winning: [],
      numberHit: false,
    }));

  it('the house keeps 1 in 37 of a chip on every number', () => {
    for (const spot of ['red', 'n5', 'dozen1'] as RouletteSpot[]) {
      let paid = 0;
      for (let pocket = 0; pocket <= 36; pocket++) paid += settleBets([{ spot, amount: 10 }], pocket).payout;
      expect(paid).toBe(360);
    }
  });
});

describe('limits and chips', () => {
  it('has the default limits', () =>
    expect(ROULETTE_DEFAULT_LIMITS).toEqual({ minBet: 10, maxNumber: 1000, maxOutside: 10_000 }));

  it('picks the limit by kind of spot', () => {
    expect(spotLimit('n5', ROULETTE_DEFAULT_LIMITS)).toBe(1000);
    expect(spotLimit('red', ROULETTE_DEFAULT_LIMITS)).toBe(10_000);
  });

  it.each([
    [ROULETTE_DEFAULT_LIMITS, [10, 50, 100, 500, 1000, 5000]],
    [{ minBet: 100, maxNumber: 500, maxOutside: 500 }, [100, 500]],
    [{ minBet: 7000, maxNumber: 9000, maxOutside: 9000 }, [7000]],
  ])('offers the chips that fit', (limits, chips) => expect(rouletteChips(limits)).toEqual(chips));
});

describe('checkBets', () => {
  const limits = ROULETTE_DEFAULT_LIMITS;
  const bet = (spot: RouletteSpot, amount: number): RouletteBet => ({ spot, amount });

  it('wants a chip on the table', () => expect(checkBets([], limits)).toBe('Put a chip on the table first'));

  it('refuses a spot that is not on the table', () =>
    expect(checkBets([bet('n37' as RouletteSpot, 10)], limits)).toBe('That is not a spot on the table'));

  it('refuses a spot twice', () =>
    expect(checkBets([bet('red', 10), bet('red', 20)], limits)).toBe('Each spot can only be bet on once'));

  it('refuses a bet under the smallest', () =>
    expect(checkBets([bet('red', 5)], limits)).toBe('The smallest bet is 10 Silver'));

  it('refuses a bet that is not a whole number', () =>
    expect(checkBets([bet('red', 10.5)], limits)).toBe('The smallest bet is 10 Silver'));

  it('refuses a number over its largest', () =>
    expect(checkBets([bet('n5', 1001)], limits)).toBe('The largest bet on a number is 1 Gold'));

  it('refuses another spot over its largest', () =>
    expect(checkBets([bet('dozen1', 10_001)], limits)).toBe('The largest bet on 1 to 12 is 10 Gold'));

  it('allows a layout within the limits', () =>
    expect(checkBets([bet('n17', 1000), bet('red', 10_000), bet('column2', 10)], limits)).toBeNull());
});

describe('schemas', () => {
  it('refuses settings whose smallest bet is above a largest', () => {
    const result = rouletteSettingsSchema.safeParse({ live: true, minBet: 2000, maxNumber: 1000, maxOutside: 10_000 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('The smallest bet cannot be larger than a largest bet');
      expect(result.error.issues[0]?.path).toEqual(['minBet']);
    }
  });

  it('accepts sound settings and refuses limits above the cap', () => {
    expect(rouletteSettingsSchema.safeParse({ live: false, minBet: 10, maxNumber: 1000, maxOutside: 10_000 }).success).toBe(true);
    expect(rouletteSettingsSchema.safeParse({ live: false, minBet: 10, maxNumber: 1_000_001, maxOutside: 10_000 }).success).toBe(false);
  });

  it('refuses a spin with an unknown spot, no bets, or 50 bets', () => {
    const ok = { characterId: 1, bets: [{ spot: 'red', amount: 10 }] };
    expect(rouletteSpinRequestSchema.safeParse(ok).success).toBe(true);
    expect(rouletteSpinRequestSchema.safeParse({ ...ok, bets: [{ spot: 'n37', amount: 10 }] }).success).toBe(false);
    expect(rouletteSpinRequestSchema.safeParse({ ...ok, bets: [] }).success).toBe(false);
    const fifty = Array.from({ length: 50 }, () => ({ spot: 'red', amount: 10 }));
    expect(rouletteSpinRequestSchema.safeParse({ ...ok, bets: fifty }).success).toBe(false);
  });
});
