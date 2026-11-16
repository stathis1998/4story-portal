import { describe, expect, it } from 'vitest';
import {
  parseSlotStakes,
  slotDailySchema,
  slotJackpotDrops,
  slotMachineSettingsSchema,
  slotPotsSettingsSchema,
  SLOT_RULES_CHANGED,
  slotSpinRequestSchema,
} from './slots.js';

it.each([
  ['20,40,60', [20, 40, 60]],
  ['40, 100, 5000', [40, 100, 5000]],
])('reads %s', (text, expected) => expect(parseSlotStakes(text)).toEqual(expected));

it.each(['10,25,50', '0,20,40', '20,40', '40,20,60', '20,20,40', '20,40,5020', '20,40,x', '20.0,40,60'])(
  'refuses %s',
  (text) => expect(parseSlotStakes(text)).toBeNull(),
);

it('refuses a spin for an unknown machine or a stake that is not a multiple of 20 in range', () => {
  expect(slotSpinRequestSchema.safeParse({ characterId: 5, machine: 'shelf', stake: 40, rules: 3 }).success).toBe(true);
  expect(slotSpinRequestSchema.safeParse({ characterId: 5, machine: 'shelf', stake: 5000, rules: 3 }).success).toBe(true);
  expect(slotSpinRequestSchema.safeParse({ characterId: 5, machine: 'bingo', stake: 40, rules: 3 }).success).toBe(false);
  for (const stake of [25, 0, 10, 5020])
    expect(slotSpinRequestSchema.safeParse({ characterId: 5, machine: 'shelf', stake, rules: 3 }).success, `${stake}`).toBe(false);
});

it('refuses a spin from a page that plays older rules, telling it to reload', () => {
  for (const rules of [undefined, 2, 1, 4, '3']) {
    const out = slotSpinRequestSchema.safeParse({ characterId: 5, machine: 'shelf', stake: 40, rules });
    expect(out.success, `${rules}`).toBe(false);
    expect(!out.success && out.error.issues.map((issue) => [issue.path, issue.message])).toEqual([
      [['rules'], 'The slots have changed. Reload the page to keep playing.'],
    ]);
  }
  expect(SLOT_RULES_CHANGED).toBe('The slots have changed. Reload the page to keep playing.');
});

it('refuses machine settings whose stakes are not three different multiples of 20, rising', () => {
  expect(slotMachineSettingsSchema.safeParse({ live: true, stakes: [20, 40, 60] }).success).toBe(true);
  expect(slotMachineSettingsSchema.safeParse({ live: true, stakes: [20, 40, 5000] }).success).toBe(true);
  for (const stakes of [[20, 20, 40], [60, 40, 20], [0, 20, 40], [20, 40, 5020], [20, 40]]) {
    expect(slotMachineSettingsSchema.safeParse({ live: true, stakes }).success, `${stakes}`).toBe(false);
  }
  const bad = slotMachineSettingsSchema.safeParse({ live: true, stakes: [10, 25, 50] });
  expect(!bad.success && bad.error.issues[0].message).toBe(
    'Enter three different stakes in multiples of 20 Silver, lowest first',
  );
  const order = slotMachineSettingsSchema.safeParse({ live: true, stakes: [20, 20, 40] });
  expect(!order.success && order.error.issues[0].path).toEqual(['stakes']);
});

describe('the jackpot', () => {
  const CAP = 50_000_000; // 50 Gold: the floor is 5_000_000
  it.each([
    ['below the floor it cannot drop', 1_000_000, 2784, CAP, 0, false],
    ['across the floor only the part past it counts', 4_999_000, 2784, CAP, 39_644, true],
    ['across the floor, one roll higher', 4_999_000, 2784, CAP, 39_645, false],
    ['between floor and cap', 27_500_000, 2784, CAP, 123_733, true],
    ['between floor and cap, one roll higher', 27_500_000, 2784, CAP, 123_734, false],
    ['a round that passes the cap always wins', 49_998_000, 2784, CAP, 999_999_999, true],
    ['a round that lands exactly on the cap always wins', 49_997_216, 2784, CAP, 999_999_999, true],
    ['a pot already past its cap always drops', 60_000_000, 2784, CAP, 999_999_999, true],
    ['a 10,000 Gold cap does not overflow', 5_000_000_000, 8673, 10_000_000_000, 999_999_999, false],
    ['a 10,000 Gold cap, the lowest roll', 5_000_000_000, 8673, 10_000_000_000, 0, true],
  ])('%s', (_name, pot, add, cap, roll, drops) => expect(slotJackpotDrops(pot, add, cap, roll)).toBe(drops));
});

describe('the three pots', () => {
  const pots = (mini: number, major: number, giga: number) => ({
    mini: { live: true, cap: mini },
    major: { live: false, cap: major },
    giga: { live: true, cap: giga },
  });

  it('accepts caps that rise from Mini to Giga', () =>
    expect(slotPotsSettingsSchema.parse(pots(1, 10, 50))).toEqual(pots(1, 10, 50)));

  it('refuses caps that do not rise, with one message', () => {
    for (const [mini, major, giga] of [[10, 10, 50], [1, 50, 50], [1, 60, 50]]) {
      const out = slotPotsSettingsSchema.safeParse(pots(mini, major, giga));
      expect(!out.success && out.error.issues.map((i) => i.message), `${[mini, major, giga]}`).toEqual([
        'The caps must rise: Mini below Major below Giga',
      ]);
    }
  });

  // Each one still rises, so only its range refuses it.
  it.each([
    ['mini', 0],
    ['mini', 1.5],
    ['giga', 10_001],
  ] as const)('refuses a %s cap of %s', (pot, cap) =>
    expect(slotPotsSettingsSchema.safeParse({ ...pots(1, 2, 3), [pot]: { live: true, cap } }).success).toBe(false));

  it('accepts caps from 1 to 10,000 Gold', () =>
    expect(slotPotsSettingsSchema.safeParse(pots(1, 9_999, 10_000)).success).toBe(true));
});

describe('the daily limit', () => {
  it.each([100, 10_000])('accepts %s rounds', (rounds) =>
    expect(slotDailySchema.parse({ rounds })).toEqual({ rounds }));
  it.each([99, 10_001, 150.5])('refuses %s rounds', (rounds) =>
    expect(slotDailySchema.safeParse({ rounds }).success).toBe(false));
});
