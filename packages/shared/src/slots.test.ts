import { describe, expect, it } from 'vitest';
import {
  SLOT_MACHINES,
  SLOT_REEL_STOPS,
  parseSlotStakes,
  slotLargestWin,
  slotLine,
  slotMachine,
  slotMachineSettingsSchema,
  slotOdds,
  slotPrize,
  slotReturn,
  slotSpinRequestSchema,
  slotWindow,
} from './slots.js';

const shelf = slotMachine('shelf')!;

describe.each(SLOT_MACHINES)('$name', (machine) => {
  it('has six symbols with different names and icons', () => {
    expect(machine.symbols).toHaveLength(6);
    expect(new Set(machine.symbols.map((s) => s.name)).size).toBe(6);
    expect(new Set(machine.symbols.map((s) => s.plural)).size).toBe(6);
    expect(new Set(machine.symbols.map((s) => s.sprite)).size).toBe(6);
  });

  it('has three reels of 32 letters A to F, each symbol on every reel', () => {
    expect(machine.reels).toHaveLength(3);
    for (const reel of machine.reels) {
      expect(reel).toHaveLength(SLOT_REEL_STOPS);
      expect(reel).toMatch(/^[A-F]+$/);
      for (const letter of 'ABCDEF') expect(reel).toContain(letter);
    }
  });

  it('has six prizes that rise from the lucky symbol to the top prize, and a smaller prize for two lucky', () => {
    expect(machine.pays).toHaveLength(6);
    for (let i = 1; i < 6; i++) expect(machine.pays[i]).toBeGreaterThan(machine.pays[i - 1]);
    expect(machine.twoLucky).toBeGreaterThan(0);
    expect(machine.twoLucky).toBeLessThan(machine.pays[0]);
  });

  it('returns between 95% and 96.5%', () => {
    const back = slotReturn(machine);
    expect(back).toBeGreaterThanOrEqual(0.95);
    expect(back).toBeLessThanOrEqual(0.965);
  });

  it('shows the real neighbours of each stop', () => {
    const letter = (s: string, i: number) => 'ABCDEF'.indexOf(s[i]);
    const win = slotWindow(machine, [0, 0, 0]);
    // The loop wraps: above the first stop is the last letter.
    expect(win[0]).toEqual([letter(machine.reels[0], 31), letter(machine.reels[0], 0), letter(machine.reels[0], 1)]);
    expect(win[1]).toEqual([letter(machine.reels[1], 31), letter(machine.reels[1], 0), letter(machine.reels[1], 1)]);
    const last = slotWindow(machine, [31, 31, 31]);
    expect(last[2]).toEqual([letter(machine.reels[2], 30), letter(machine.reels[2], 31), letter(machine.reels[2], 0)]);
  });
});

it.each([
  ['shelf', 31400, 8204, 2],
  ['armoury', 31360, 5437, 4],
  ['hoard', 31489, 3275, 2],
])('%s pays %i over all 32768 results, on %i of them, the top prize on %i', (key, paid, hits, top) =>
  expect(slotOdds(slotMachine(key)!)).toEqual({ combos: 32768, paid, hits, top }),
);

it('finds the machines by key and nothing else', () => {
  expect(SLOT_MACHINES.map((m) => m.key)).toEqual(['shelf', 'armoury', 'hoard']);
  expect(slotMachine('roulette')).toBeUndefined();
});

it('no icon is used on two machines', () => {
  const sprites = SLOT_MACHINES.flatMap((m) => m.symbols.map((s) => s.sprite));
  expect(new Set(sprites).size).toBe(sprites.length);
});

it('pays three of a kind', () => {
  expect(slotPrize(shelf, [4, 4, 16])).toEqual({ multiple: 50, count: 3, symbol: 4 });
});

it('pays the top prize', () => {
  expect(slotPrize(shelf, [12, 8, 11])).toEqual({ multiple: 100, count: 3, symbol: 5 });
});

it('pays two lucky symbols from the left, and only then', () => {
  expect(slotPrize(shelf, [0, 0, 1])).toEqual({ multiple: 2, count: 2, symbol: 0 });
  expect(slotPrize(shelf, [1, 0, 0])).toEqual({ multiple: 0, count: 0, symbol: null });
});

it('pays three lucky symbols once, as three', () => {
  expect(slotPrize(shelf, [0, 0, 0])).toEqual({ multiple: 5, count: 3, symbol: 0 });
});

it('pays nothing for a near miss', () => {
  expect(slotPrize(shelf, [12, 8, 12])).toEqual({ multiple: 0, count: 0, symbol: null });
});

it('reads a result out', () => {
  expect(slotLine(shelf, slotPrize(shelf, [12, 8, 11]))).toBe('Three Experience Potions.');
  expect(slotLine(shelf, slotPrize(shelf, [0, 0, 1]))).toBe('Two Healing Potions.');
  expect(slotLine(shelf, slotPrize(shelf, [12, 8, 12]))).toBe('No win this time.');
});

it('gives the largest win at the stakes', () => expect(slotLargestWin(slotMachine('hoard')!, [50, 100, 200])).toBe(100_000));

it.each([
  ['10,25,50', [10, 25, 50]],
  [' 10, 25 ,50 ', [10, 25, 50]],
])('reads stakes %s', (text, expected) => expect(parseSlotStakes(text)).toEqual(expected));

it.each(['abc', '', '10,25', '10,25,50,75', '50,10,25', '10,10,25', '0,5,10', '10,25,100001', '1.5,2,3'])(
  'refuses stakes %s',
  (text) => expect(parseSlotStakes(text)).toBeNull(),
);

it('refuses a spin for an unknown machine or a stake of 0', () => {
  expect(slotSpinRequestSchema.safeParse({ characterId: 5, machine: 'shelf', stake: 10 }).success).toBe(true);
  expect(slotSpinRequestSchema.safeParse({ characterId: 5, machine: 'bingo', stake: 10 }).success).toBe(false);
  expect(slotSpinRequestSchema.safeParse({ characterId: 5, machine: 'shelf', stake: 0 }).success).toBe(false);
  expect(slotSpinRequestSchema.safeParse({ characterId: 5, machine: 'shelf', stake: 100_001 }).success).toBe(false);
});

it('refuses machine settings whose stakes are not three different, rising', () => {
  const ok = slotMachineSettingsSchema.safeParse({ live: true, stakes: [10, 25, 50] });
  expect(ok.success).toBe(true);
  for (const stakes of [[10, 10, 25], [50, 25, 10], [0, 5, 10], [10, 25, 100_001], [10, 25]]) {
    expect(slotMachineSettingsSchema.safeParse({ live: true, stakes }).success).toBe(false);
  }
  const bad = slotMachineSettingsSchema.safeParse({ live: true, stakes: [10, 10, 25] });
  expect(!bad.success && bad.error.issues[0].message).toBe('Enter three different stakes, lowest first');
  expect(!bad.success && bad.error.issues[0].path).toEqual(['stakes']);
});
