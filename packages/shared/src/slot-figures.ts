import {
  SLOT_CHAIN_MAX,
  SLOT_FREE_MAX,
  SLOT_FREE_MULTIPLIER_MAX,
  SLOT_FREE_SPINS,
  SLOT_FREE_START,
  SLOT_LINE_COUNT,
  SLOT_METER_FREE,
  SLOT_POTS,
  SLOT_POT_SHARE,
  SLOT_RETRIGGER,
  SLOT_STEP_MULTIPLIER_MAX,
  SLOT_TOTAL_RETURN,
  type SlotCounts,
  type SlotMachine,
  type SlotPot,
  type SlotStakes,
} from './slots.js';

/**
 * How a free round plays: the multiplier it starts at and its cap, the spins a retrigger adds, the most spins a
 * round plays, and the chain length the counts' buckets were made with. A test can pass tiny ones.
 */
export type FreeRules = { start: number; max: number; retrigger: number; limit: number; stepCap: number };
export const SLOT_FREE_RULES: FreeRules = {
  start: SLOT_FREE_START,
  max: SLOT_FREE_MULTIPLIER_MAX,
  retrigger: SLOT_RETRIGGER,
  limit: SLOT_FREE_MAX,
  stepCap: SLOT_CHAIN_MAX,
};

/** Scatter counts in a paid spin's last window that win free spins: `last[3]`, `last[4]`, `last[5]`. */
const WINNING = Object.keys(SLOT_FREE_SPINS).map(Number);
/** The fewest scatters that win free spins; fewer add that many meter points. */
const FEWEST = Math.min(...WINNING);
const NINE = 1_000_000_000;

/** The windows counted: every window has one last window. */
const windowsOf = (counts: SlotCounts) => counts.last.reduce((sum, n) => sum + n, 0);

/**
 * Expected line stakes a free round of n spins pays, retriggers included. Exact.
 * A spin that finds multiplier m and wins W steps pays step j (from 0) its stakes times min(m + j, max) and leaves
 * the multiplier at min(m + W, max), so the buckets give its value at any m. The programme runs over (spins left,
 * multiplier, spins in the round so far), because a retrigger near the limit adds only what fits.
 */
export function slotFreeRoundValue(counts: SlotCounts, n: number, rules: FreeRules = SLOT_FREE_RULES): number {
  const C = windowsOf(counts);
  const span = rules.stepCap;
  // One spin's expected pay at each multiplier.
  const payAt = new Float64Array(rules.max + 1);
  for (let m = rules.start; m <= rules.max; m++) {
    let sum = 0;
    for (let at = 0; at < (span + 1) * 2; at++) {
      for (let j = 0; j < span; j++) sum += counts.steps[at * span + j] * Math.min(m + j, rules.max);
    }
    payAt[m] = sum / C;
  }
  const most = Math.max(n, rules.limit) + 1;
  const memo = new Float64Array(most * (rules.max + 1) * most).fill(NaN);
  const value = (left: number, m: number, total: number): number => {
    if (left === 0) return 0;
    const key = (left * (rules.max + 1) + m) * most + total;
    if (!Number.isNaN(memo[key])) return memo[key];
    let v = payAt[m];
    for (let W = 0; W <= span; W++) {
      for (let r = 0; r < 2; r++) {
        const windows = counts.free[W * 2 + r];
        if (!windows) continue;
        const add = r ? Math.min(rules.retrigger, rules.limit - total) : 0;
        v += (windows / C) * value(left - 1 + add, Math.min(m + W, rules.max), total + add);
      }
    }
    memo[key] = v;
    return v;
  };
  return value(n, rules.start, n);
}

/** The chance a free round of n spins pays nothing at all. Exact: every spin must win no step. */
export function slotFreeRoundBlank(counts: SlotCounts, n: number, rules: FreeRules = SLOT_FREE_RULES): number {
  const C = windowsOf(counts);
  const most = Math.max(n, rules.limit) + 1;
  const memo = new Float64Array(most * most).fill(NaN);
  const blank = (left: number, total: number): number => {
    if (left === 0) return 1;
    const key = left * most + total;
    if (!Number.isNaN(memo[key])) return memo[key];
    let q = 0;
    for (let r = 0; r < 2; r++) {
      const windows = counts.free[r];
      if (!windows) continue;
      const add = r ? Math.min(rules.retrigger, rules.limit - total) : 0;
      q += (windows / C) * blank(left - 1 + add, total + add);
    }
    memo[key] = q;
    return q;
  };
  return blank(n, n);
}

/** What one paid spin's chain pays on average, in line stakes: step j (from 0) pays times min(j + 1, 5). */
export function slotPaidValue(machine: SlotMachine): number {
  const { steps } = machine.counts;
  let sum = 0;
  for (let i = 0; i < steps.length; i++) sum += steps[i] * Math.min((i % SLOT_CHAIN_MAX) + 1, SLOT_STEP_MULTIPLIER_MAX);
  return sum / windowsOf(machine.counts);
}

/**
 * How often a round fills the meter, in the long run. The meter's points, taken modulo its size S, move by the
 * same chances from every total, so in the long run every total from 0 to S - 1 is equally likely; a paid spin
 * that adds k points then reaches S with chance k / S, whatever came before it.
 */
export function slotMeterRate(machine: SlotMachine): number {
  const { last } = machine.counts;
  let points = 0;
  for (let k = 1; k < FEWEST; k++) points += last[k] * k;
  return points / (windowsOf(machine.counts) * machine.meterSize);
}

/** R: the share of all stakes the reels, free spins and meter pay back over time, without the jackpots. */
export function slotReturn(machine: SlotMachine): number {
  const { counts } = machine;
  const C = windowsOf(counts);
  let lineStakes = slotPaidValue(machine);
  for (const s of WINNING) lineStakes += (counts.last[s] / C) * slotFreeRoundValue(counts, SLOT_FREE_SPINS[s]);
  lineStakes += slotMeterRate(machine) * slotFreeRoundValue(counts, SLOT_METER_FREE);
  return lineStakes / SLOT_LINE_COUNT;
}

/** L: the chance a round pays nothing at all, in the long run, the meter's free spins counted. */
export function slotLostRate(machine: SlotMachine): number {
  const { counts, meterSize } = machine;
  const C = windowsOf(counts);
  const meterBlank = slotFreeRoundBlank(counts, SLOT_METER_FREE);
  let lost = counts.blankLast[0] / C;
  // A spin that adds k points fills the meter with chance k / S (see slotMeterRate); its 8 free spins must pay nothing too.
  for (let k = 1; k < FEWEST; k++) lost += (counts.blankLast[k] / C) * (1 - k / meterSize + (k / meterSize) * meterBlank);
  for (const s of WINNING) lost += (counts.blankLast[s] / C) * slotFreeRoundBlank(counts, SLOT_FREE_SPINS[s]);
  return lost;
}

/** The chance a paid spin wins free spins. */
export function slotFreeRate(machine: SlotMachine): number {
  return WINNING.reduce((sum, s) => sum + machine.counts.last[s], 0) / windowsOf(machine.counts);
}

/** The chance a round pays something. */
export function slotPaysRate(machine: SlotMachine): number {
  return 1 - slotLostRate(machine);
}

/** The most one paid spin can win at these stakes, in Silver: counts.best x the highest stake / SLOT_LINE_COUNT. */
export function slotLargestWin(machine: SlotMachine, stakes: SlotStakes): number {
  return (machine.counts.best * Math.max(...stakes)) / SLOT_LINE_COUNT;
}

// Machines are constants and the free round programme is not free, so each machine's share is worked out once.
const shares = new WeakMap<SlotMachine, { num: number; den: number }>();

/** The share of a lost stake that goes to the three pots, in billionths: { num, den: 1_000_000_000 }. */
export function slotJackpotShare(machine: SlotMachine): { num: number; den: number } {
  const known = shares.get(machine);
  if (known) return known;
  // Whatever the reels, free spins and meter pay back, the pots make up the rest of 105%. The -1 covers
  // floating-point error, so the share never rounds up past what is left to give.
  const num = Math.max(0, Math.floor(((SLOT_TOTAL_RETURN - slotReturn(machine)) / slotLostRate(machine)) * NINE) - 1);
  const share = { num, den: NINE };
  shares.set(machine, share);
  return share;
}

/** Bronze a lost round of `stake` Silver adds to each pot, each rounded down. */
export function slotJackpotAdds(machine: SlotMachine, stake: number): Record<SlotPot, number> {
  // BigInt: stake x 1000 x num passes 2^53.
  const { num, den } = slotJackpotShare(machine);
  const whole = BigInt(stake) * 1000n * BigInt(num);
  const adds = {} as Record<SlotPot, number>;
  for (const pot of SLOT_POTS) adds[pot] = Number((whole * BigInt(SLOT_POT_SHARE[pot])) / (BigInt(den) * 100n));
  return adds;
}
