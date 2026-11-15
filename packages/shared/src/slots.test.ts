import { describe, expect, it } from 'vitest';
import {
  parseSlotStakes,
  slotJackpotDrops,
  slotJackpotSettingsSchema,
  slotMachineSettingsSchema,
  slotSpinRequestSchema,
} from './slots.js';

it.each([
  ['20,40,60', [20, 40, 60]],
  ['40, 100, 100000', [40, 100, 100000]],
])('reads %s', (text, expected) => expect(parseSlotStakes(text)).toEqual(expected));

it.each(['10,25,50', '0,20,40', '20,40', '40,20,60', '20,20,40', '20,40,100020', '20,40,x', '20.0,40,60'])(
  'refuses %s',
  (text) => expect(parseSlotStakes(text)).toBeNull(),
);

it('refuses a spin for an unknown machine or a stake that is not a multiple of 20 in range', () => {
  expect(slotSpinRequestSchema.safeParse({ characterId: 5, machine: 'shelf', stake: 40 }).success).toBe(true);
  expect(slotSpinRequestSchema.safeParse({ characterId: 5, machine: 'bingo', stake: 40 }).success).toBe(false);
  for (const stake of [25, 0, 10, 100_020])
    expect(slotSpinRequestSchema.safeParse({ characterId: 5, machine: 'shelf', stake }).success, `${stake}`).toBe(false);
});

it('refuses machine settings whose stakes are not three different multiples of 20, rising', () => {
  expect(slotMachineSettingsSchema.safeParse({ live: true, stakes: [20, 40, 60] }).success).toBe(true);
  for (const stakes of [[20, 20, 40], [60, 40, 20], [0, 20, 40], [20, 40, 100_020], [20, 40]]) {
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

  it.each([0, 10_001, 1.5])('refuses a cap of %s', (cap) =>
    expect(slotJackpotSettingsSchema.safeParse({ live: true, cap }).success).toBe(false));
  it('accepts a cap from 1 to 10,000 Gold', () => {
    expect(slotJackpotSettingsSchema.parse({ live: false, cap: 1 })).toEqual({ live: false, cap: 1 });
    expect(slotJackpotSettingsSchema.safeParse({ live: true, cap: 10_000 }).success).toBe(true);
  });
});
