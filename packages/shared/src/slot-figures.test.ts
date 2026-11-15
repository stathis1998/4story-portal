import { describe, expect, it } from 'vitest';
import { SLOT_CHAIN_MAX, SLOT_FREE_SPINS, type SlotCounts, type SlotMachine, type SlotStops } from './slots.js';
import { slotChain, slotPaidChainPay, slotReplayRound } from './slot-rules.js';
import { countSlotMachine } from './slot-count.js';
import {
  SLOT_FREE_RULES,
  slotFreeRate,
  slotFreeRoundBlank,
  slotFreeRoundValue,
  slotJackpotAdds,
  slotJackpotShare,
  slotLargestWin,
  slotLostRate,
  slotMeterRate,
  slotPaidValue,
  slotPaysRate,
  slotReturn,
  type FreeRules,
} from './slot-figures.js';

const STEPS = SLOT_CHAIN_MAX;
const BUCKETS = (STEPS + 1) * 2;

function emptyCounts(): SlotCounts {
  return {
    last: [0, 0, 0, 0, 0, 0],
    blankLast: [0, 0, 0, 0, 0, 0],
    free: new Array<number>(BUCKETS).fill(0),
    steps: new Array<number>(BUCKETS * STEPS).fill(0),
    best: 0,
    longest: 0,
    capped: 0,
  };
}

function build(reels: string[], meterSize = 30): SlotMachine {
  return {
    key: 'shelf',
    name: 'Fixture',
    symbols: Array.from({ length: 10 }, (_, i) => ({ name: `S${i}`, sprite: i })),
    reels: reels as unknown as SlotMachine['reels'],
    pays: Array.from({ length: 8 }, (_, i) => [5 * (i + 1), 20 * (i + 1), 100 * (i + 1)] as const),
    twoLucky: 2,
    stakes: [20, 40, 60],
    meterSize,
    counts: emptyCounts(),
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

/** Every window of the machine's strips, whatever their lengths, reel 1 slowest. */
function* windows(machine: Pick<SlotMachine, 'reels'>): Generator<SlotStops> {
  const lengths = machine.reels.map((r) => r.length);
  const total = lengths.reduce((a, b) => a * b, 1);
  for (let n = 0; n < total; n++) {
    let rest = n;
    const stops = [0, 0, 0, 0, 0];
    for (let r = 4; r >= 0; r--) {
      stops[r] = rest % lengths[r];
      rest = Math.floor(rest / lengths[r]);
    }
    yield stops as SlotStops;
  }
}

/** SlotCounts built the slow way: every window played through slotChain. */
function countByHand(machine: SlotMachine): SlotCounts {
  const counts = emptyCounts();
  for (const stops of windows(machine)) {
    const chain = slotChain(machine, stops);
    const won = chain.steps.filter((s) => s.lines.length > 0);
    const r = chain.scatters >= 3 ? 1 : 0;
    const s = Math.min(chain.scatters, 5);
    const pay = slotPaidChainPay(chain);
    counts.last[s]++;
    if (pay === 0) counts.blankLast[s]++;
    counts.free[won.length * 2 + r]++;
    won.forEach((step, j) => (counts.steps[(won.length * 2 + r) * STEPS + j] += step.multiple));
    counts.best = Math.max(counts.best, pay);
    counts.longest = Math.max(counts.longest, chain.steps.length);
    if (chain.capped) counts.capped++;
  }
  return counts;
}

/**
 * A free round of `spins` played the way the round rules play it, from `next()` stops in turn: each winning step
 * pays at the multiplier it finds and then raises it by 1 up to `max`; 3 or more scatters in a spin's last window
 * add `retrigger` spins, never past `limit`.
 */
function playFree(machine: SlotMachine, rules: FreeRules, spins: number, next: () => SlotStops) {
  const played: SlotStops[] = [];
  let left = spins;
  let total = spins;
  let times = rules.start;
  let pay = 0;
  let topped = false;
  let retriggers = 0;
  while (left > 0) {
    const stops = next();
    played.push(stops);
    const chain = slotChain(machine, stops);
    for (const step of chain.steps) {
      if (step.lines.length === 0) continue;
      pay += step.multiple * times;
      times = Math.min(times + 1, rules.max);
      if (times === rules.max) topped = true;
    }
    if (chain.scatters >= 3) {
      retriggers++;
      const add = Math.min(rules.retrigger, rules.limit - total);
      left += add;
      total += add;
    }
    left--;
  }
  return { played, pay, topped, retriggers };
}

/** A small seeded generator, so the same stops are drawn on every run. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return (below: number) => {
    s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0;
    return s % below;
  };
}

describe('counting windows', () => {
  // Short strips that mostly repeat every 3, so a burst often refills alike and chains, some to the cap. A wild on
  // reel 2; scatters on reels 4 and 5, two side by side on reel 4 so it can show two at once.
  const small = build(['ABCABE', 'ABCIBC', 'ABCAEC', 'JJCABC', 'JBCDBC']);

  it('counts a small machine exactly as slotChain plays it, window by window', () => {
    const expected = countByHand(small);
    // The strips make every case: chains of several steps up to the cap, blanks, retriggers, one or two scatters left.
    expect(expected.free.reduce((a, b) => a + b, 0)).toBe(6 ** 5);
    expect(expected.free.slice(4).some((n) => n > 0)).toBe(true);
    expect(expected.blankLast.some((n) => n > 0)).toBe(true);
    expect(expected.last[1] + expected.last[2]).toBeGreaterThan(0);
    expect(expected.last[3] + expected.last[4] + expected.last[5]).toBeGreaterThan(0);
    expect(expected.longest).toBe(SLOT_CHAIN_MAX);
    expect(expected.capped).toBeGreaterThan(0);
    expect(expected.capped).toBeLessThan(6 ** 5);
    expect(countSlotMachine(small)).toEqual(expected);
  });

  it('pays a free round exactly as the round rules play it, multiplier and retriggers included', () => {
    const machine = build(small.reels as unknown as string[], 1000);
    const paid = [...windows(machine)].find((stops) => slotChain(machine, stops).scatters >= 3)!;
    const chain = slotChain(machine, paid);
    const spins = SLOT_FREE_SPINS[Math.min(chain.scatters, 5)];
    const draw = seeded(7);
    let topped = 0;
    let retriggered = 0;
    for (let round = 0; round < 60; round++) {
      const free = playFree(machine, SLOT_FREE_RULES, spins, () => [0, 0, 0, 0, 0].map(() => draw(6)) as SlotStops);
      if (free.topped) topped++;
      if (free.retriggers > 0) retriggered++;
      const replay = slotReplayRound(machine, { stops: paid, free: free.played, meterFree: [], meterBefore: 0 });
      expect(replay.lineStakes).toBe(slotPaidChainPay(chain) + free.pay);
    }
    expect(topped).toBeGreaterThan(0);
    expect(retriggered).toBeGreaterThan(0);
  });

  it('values a free round exactly: the programme against enumerating every sequence', () => {
    const tiny = build(['ACDE', 'AIBJ', 'BACD', 'AJBC', 'CDEJ']);
    const rules: FreeRules = { start: 2, max: 4, retrigger: 1, limit: 3, stepCap: 12 };
    // Windows that play the same chain (the same line stakes step by step, the same retrigger) are the same to a
    // free round, so each kind stands for all its windows: enumerating sequences of kinds, each weighted by how
    // many windows it has, enumerates every sequence of windows. 1,024 cubed would be too slow to walk one by one.
    const kinds = new Map<string, { windows: number; pays: number[]; retrigger: boolean }>();
    for (const stops of windows(tiny)) {
      const chain = slotChain(tiny, stops);
      const pays = chain.steps.filter((s) => s.lines.length > 0).map((s) => s.multiple);
      const retrigger = chain.scatters >= 3;
      const key = `${pays.join(',')}|${retrigger}`;
      const kind = kinds.get(key) ?? { windows: 0, pays, retrigger };
      kind.windows++;
      kinds.set(key, kind);
    }
    const C = 4 ** 5;
    const list = [...kinds.values()];
    expect(list.some((k) => k.pays.length >= 2)).toBe(true);
    expect(list.some((k) => k.retrigger)).toBe(true);
    expect(list.some((k) => k.pays.length === 0 && !k.retrigger)).toBe(true);
    expect(list.some((k) => k.pays.length === 0 && k.retrigger)).toBe(true);

    const seen = { topped: false, full: false };
    function walk(left: number, total: number, times: number, chance: number, paid: number, out: { value: number; blank: number }) {
      if (left === 0) {
        out.value += chance * paid;
        if (paid === 0) out.blank += chance;
        return;
      }
      for (const kind of list) {
        let m = times;
        let pay = 0;
        for (const p of kind.pays) {
          pay += p * m;
          m = Math.min(m + 1, rules.max);
        }
        if (m === rules.max) seen.topped = true;
        const add = kind.retrigger ? Math.min(rules.retrigger, rules.limit - total) : 0;
        if (kind.retrigger && add === 0) seen.full = true;
        walk(left - 1 + add, total + add, m, (chance * kind.windows) / C, paid + pay, out);
      }
    }

    const counts = countSlotMachine(tiny);
    for (const n of [1, 2, 3]) {
      const out = { value: 0, blank: 0 };
      walk(n, n, rules.start, 1, 0, out);
      expect(out.value).toBeGreaterThan(0);
      expect(out.blank).toBeGreaterThan(0);
      expect(Math.abs(slotFreeRoundValue(counts, n, rules) - out.value)).toBeLessThanOrEqual(1e-12 * out.value);
      expect(Math.abs(slotFreeRoundBlank(counts, n, rules) - out.blank)).toBeLessThanOrEqual(1e-12);
    }
    expect(seen.topped).toBe(true);
    expect(seen.full).toBe(true);
    expect(slotFreeRoundValue(counts, 0, rules)).toBe(0);
    expect(slotFreeRoundBlank(counts, 0, rules)).toBe(1);
  });
});

/** Writes `values` into the step buckets of W winning steps and retrigger r. */
function bucket(counts: SlotCounts, W: number, r: 0 | 1, windowCount: number, values: number[]) {
  counts.free[W * 2 + r] = windowCount;
  values.forEach((v, j) => (counts.steps[(W * 2 + r) * STEPS + j] = v));
}

// 10,000 windows, written by hand: last and blankLast by scatters, and the windows by winning steps that add up.
const HAND_COUNTS: SlotCounts = (() => {
  const counts = emptyCounts();
  counts.last = [8732, 800, 440, 20, 6, 2];
  counts.blankLast = [4500, 400, 100, 10, 3, 1];
  bucket(counts, 0, 0, 5000, []);
  bucket(counts, 0, 1, 14, []);
  bucket(counts, 1, 0, 3500, [50_000]);
  bucket(counts, 2, 0, 1000, [30_000, 12_000]);
  bucket(counts, 3, 0, 462, [13_860, 6_930, 4_620]);
  bucket(counts, 12, 0, 10, new Array<number>(12).fill(300));
  bucket(counts, 1, 1, 10, [200]);
  bucket(counts, 2, 1, 4, [120, 40]);
  counts.best = 4000;
  counts.longest = 12;
  counts.capped = 10;
  return counts;
})();
const C = 10_000;
const machine: SlotMachine = { ...fixture, meterSize: 30, counts: HAND_COUNTS };

describe('the published figures', () => {
  it('has hand counts that add up', () => {
    expect(HAND_COUNTS.last.reduce((a, b) => a + b, 0)).toBe(C);
    expect(HAND_COUNTS.free.reduce((a, b) => a + b, 0)).toBe(C);
    expect(HAND_COUNTS.free[0] + HAND_COUNTS.free[1]).toBe(HAND_COUNTS.blankLast.reduce((a, b) => a + b, 0));
  });

  it('works out R, L, the rates and the share from the counts', () => {
    // Each step j (from 0) of a paid spin pays times min(j + 1, 5).
    const paid =
      (50_000 + 30_000 + 12_000 * 2 + 13_860 + 6_930 * 2 + 4_620 * 3 + 300 * (1 + 2 + 3 + 4 + 5 * 8) + 200 + 120 + 40 * 2) / C;
    expect(slotPaidValue(machine)).toBeCloseTo(paid, 12);

    const meter = (800 * 1 + 440 * 2) / (C * 30);
    expect(slotMeterRate(machine)).toBeCloseTo(meter, 15);

    const V = (n: number) => slotFreeRoundValue(HAND_COUNTS, n);
    const Q = (n: number) => slotFreeRoundBlank(HAND_COUNTS, n);
    const R = (paid + (20 / C) * V(8) + (6 / C) * V(12) + (2 / C) * V(20) + meter * V(8)) / 20;
    expect(slotReturn(machine)).toBeCloseTo(R, 12);
    expect(R).toBeGreaterThan(1);
    expect(R).toBeLessThan(1.05);

    const L =
      4500 / C +
      (400 / C) * (1 - 1 / 30 + (1 / 30) * Q(8)) +
      (100 / C) * (1 - 2 / 30 + (2 / 30) * Q(8)) +
      (10 / C) * Q(8) +
      (3 / C) * Q(12) +
      (1 / C) * Q(20);
    expect(slotLostRate(machine)).toBeCloseTo(L, 12);
    expect(slotPaysRate(machine)).toBeCloseTo(1 - L, 12);
    expect(slotFreeRate(machine)).toBeCloseTo(28 / C, 15);
    expect(slotLargestWin(machine, [20, 40, 60])).toBe(12_000);
    expect(slotJackpotShare(machine)).toEqual({ num: Math.floor(((1.05 - R) / L) * 1e9) - 1, den: 1e9 });
  });

  it('values one free spin from the buckets at the multiplier it finds', () => {
    // A round of one spin with no retrigger windows: each winning step j pays its stakes times min(2 + j, 10).
    const counts = emptyCounts();
    counts.last = [90, 10, 0, 0, 0, 0];
    bucket(counts, 0, 0, 50, []);
    bucket(counts, 1, 0, 40, [400]);
    bucket(counts, 12, 0, 10, new Array<number>(12).fill(100));
    const value = (400 * 2 + 100 * (2 + 3 + 4 + 5 + 6 + 7 + 8 + 9 + 10 * 4)) / 100;
    expect(slotFreeRoundValue(counts, 1)).toBeCloseTo(value, 12);
    expect(slotFreeRoundBlank(counts, 1)).toBeCloseTo(0.5, 15);
    expect(slotFreeRoundBlank(counts, 3)).toBeCloseTo(0.125, 15);
  });

  it('never lets reels and jackpots pay back more than 105%', () => {
    const { num, den } = slotJackpotShare(machine);
    expect(num).toBeGreaterThan(0);
    const back = slotReturn(machine) + (slotLostRate(machine) * num) / den;
    expect(back).toBeLessThanOrEqual(1.05);
    expect(back).toBeGreaterThan(1.05 - 3e-9);
  });

  it('splits the share 30, 30, 40, each rounded down, never more than the whole', () => {
    const { num, den } = slotJackpotShare(machine);
    for (const stake of [20, 60, 1000, 5000]) {
      const whole = BigInt(stake) * 1000n * BigInt(num);
      const adds = slotJackpotAdds(machine, stake);
      expect(adds).toEqual({
        mini: Number((whole * 30n) / (BigInt(den) * 100n)),
        major: Number((whole * 30n) / (BigInt(den) * 100n)),
        giga: Number((whole * 40n) / (BigInt(den) * 100n)),
      });
      expect(adds.mini + adds.major + adds.giga).toBeLessThanOrEqual(Number(whole / BigInt(den)));
      expect(adds.giga).toBeGreaterThan(adds.mini);
    }
  });

  it('gives no share when R is already 105% or more', () => {
    const rich: SlotMachine = { ...machine, counts: { ...HAND_COUNTS, steps: HAND_COUNTS.steps.map((n) => n * 2) } };
    expect(slotReturn(rich)).toBeGreaterThanOrEqual(1.05);
    expect(slotJackpotShare(rich)).toEqual({ num: 0, den: 1e9 });
    expect(slotJackpotAdds(rich, 5000)).toEqual({ mini: 0, major: 0, giga: 0 });
  });
});
