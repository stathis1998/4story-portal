import { beforeAll, describe, expect, it } from 'vitest';
import type { SlotCounts, SlotMachine, SlotStops } from './slots.js';
import { slotSpin } from './slot-rules.js';
import { countSlotMachine, quickSlotCounts } from './slot-count.js';
import {
  SLOT_COMBOS,
  slotFreeRate,
  slotJackpotAdd,
  slotJackpotShare,
  slotLargestWin,
  slotLostRate,
  slotReturn,
} from './slot-figures.js';

function build(reels: string[]): SlotMachine {
  return {
    key: 'shelf',
    name: 'Fixture',
    symbols: Array.from({ length: 10 }, (_, i) => ({ name: `S${i}`, sprite: i })),
    reels: reels as unknown as SlotMachine['reels'],
    pays: Array.from({ length: 8 }, (_, i) => [5 * (i + 1), 20 * (i + 1), 100 * (i + 1)] as const),
    twoLucky: 2,
    stakes: [20, 40, 60],
    counts: { linePaid: 0, blank: 0, scatters: [0, 0, 0], blankScatters: [0, 0, 0], best: 0 },
    rest: [0, 0, 0, 0, 0],
  };
}

// Every paying symbol on every reel, I (wild) only on reels 2 to 4, one or two J (scatter) per reel at least 3 apart.
const fixture = build([
  'ABCDEFGHABCJEFGHABCDEFGHABCDEFGA',
  'ABCDEFGHIBCDEFGHABCJEFGHABCDEFIH',
  'ABCDEFGHABCDEIGHABCDEFGHABCJEFGH',
  'ABCJEFGHABCDEFGHAICDEFGHABCDEFJH',
  'ABCDEFGHABCDEFGHABCDEFGHJBCDEFGH',
]);

describe('counting windows', () => {
  it('counts a small machine exactly as slotSpin reads it, window by window', () => {
    // Short strips with wilds and scatters, two scatters close together on one reel.
    const small = build(['AJBJIACH', 'BIAAJCDE', 'AAIBCDJA', 'ABIJACDE', 'JABCDIEF']);
    const expected: SlotCounts = { linePaid: 0, blank: 0, scatters: [0, 0, 0], blankScatters: [0, 0, 0], best: 0 };
    for (let n = 0; n < 8 ** 5; n++) {
      const stops = [0, 1, 2, 3, 4].map((r) => Math.floor(n / 8 ** r) % 8) as SlotStops;
      const out = slotSpin(small, stops);
      expected.linePaid += out.multiple;
      expected.best = Math.max(expected.best, out.multiple);
      const blank = out.lines.length === 0;
      if (blank) expected.blank++;
      if (out.scatters >= 3 && out.scatters <= 5) {
        expected.scatters[out.scatters - 3]++;
        if (blank) expected.blankScatters[out.scatters - 3]++;
      }
    }
    expect(expected.linePaid).toBeGreaterThan(0);
    expect(expected.scatters.some((n) => n > 0)).toBe(true);
    expect(expected.blankScatters.some((n) => n > 0)).toBe(true);
    expect(countSlotMachine(small)).toEqual(expected);
  });

  let counts: SlotCounts;
  beforeAll(() => {
    counts = countSlotMachine(fixture);
  }, 120_000);

  it('counts every window of the 32-letter fixture', () => {
    expect(counts.linePaid).toBeGreaterThan(0);
    expect(counts.blank).toBeGreaterThan(0);
    expect(counts.blank).toBeLessThan(SLOT_COMBOS);
    expect(counts.scatters.every((n) => n > 0)).toBe(true);
    expect(counts.blankScatters.every((n, k) => n <= counts.scatters[k])).toBe(true);
    expect(counts.best).toBeGreaterThan(0);
  });

  it('the quick count agrees with the full count', () =>
    expect(quickSlotCounts(fixture)).toEqual({ linePaid: counts.linePaid, scatters: counts.scatters }));
});

const machine: SlotMachine = {
  ...fixture,
  counts: { linePaid: 20 * 0.5 * SLOT_COMBOS, blank: SLOT_COMBOS * 0.75, scatters: [0, 0, 0], blankScatters: [0, 0, 0], best: 4000 },
};
const withFree: SlotMachine = {
  ...machine,
  counts: { ...machine.counts, scatters: [SLOT_COMBOS / 100, 0, 0], blankScatters: [SLOT_COMBOS / 200, 0, 0] },
};

describe('the published figures', () => {
  it('works out the figures from the counts', () => {
    expect(slotReturn(machine)).toBeCloseTo(0.5, 12);
    expect(slotLostRate(machine)).toBeCloseTo(0.75, 12);
    expect(slotFreeRate(machine)).toBe(0);
    expect(slotLargestWin(machine, [20, 40, 60])).toBe(12_000);
    expect(slotJackpotShare(machine)).toEqual({ num: 666_666_665, den: 1_000_000_000 });
    expect(slotJackpotAdd(machine, 60)).toBe(39_999);
    expect(slotJackpotAdd(machine, 100_000)).toBe(66_666_666);
  });

  it('counts free spins into the return and the lost rate', () => {
    expect(slotReturn(withFree)).toBeCloseTo(0.5 * (1 + (2 * 8) / 100), 12);
    expect(slotLostRate(withFree)).toBeCloseTo(0.75 - 0.005 + 0.005 * 0.75 ** 8, 12);
    expect(slotFreeRate(withFree)).toBeCloseTo(0.01, 12);
  });

  it('never gives a share that pays back more than is staked', () => {
    for (const m of [machine, withFree]) {
      const { num, den } = slotJackpotShare(m);
      const back = slotReturn(m) + (slotLostRate(m) * num) / den;
      expect(back).toBeLessThanOrEqual(1);
      expect(back).toBeGreaterThan(1 - 3e-9);
    }
  });
});
