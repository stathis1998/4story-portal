import { SLOT_FREE_MULTIPLIER, SLOT_FREE_SPINS, SLOT_STAKE_STEP, type SlotMachine, type SlotStakes } from './slots.js';

export const SLOT_COMBOS = 32 ** 5;

/** Scatters showing for each of the three counts, in the order SlotCounts keeps them. */
const SCATTER_COUNTS = [3, 4, 5] as const;
const NINE = 1_000_000_000;

/** The share of all stakes paid back, free spins counted. */
export function slotReturn(machine: SlotMachine): number {
  const { linePaid, scatters } = machine.counts;
  const spins = scatters.reduce((sum, n, k) => sum + n * SLOT_FREE_SPINS[SCATTER_COUNTS[k]], 0);
  return (linePaid / (20 * SLOT_COMBOS)) * (1 + (SLOT_FREE_MULTIPLIER * spins) / SLOT_COMBOS);
}

/** The chance a round is lost. */
export function slotLostRate(machine: SlotMachine): number {
  const { blank, blankScatters } = machine.counts;
  const lostFree = blankScatters.reduce((sum, n, k) => sum + (n / SLOT_COMBOS) * (blank / SLOT_COMBOS) ** SLOT_FREE_SPINS[SCATTER_COUNTS[k]], 0);
  return (blank - blankScatters[0] - blankScatters[1] - blankScatters[2]) / SLOT_COMBOS + lostFree;
}

/** The chance a paid spin wins free spins. */
export function slotFreeRate(machine: SlotMachine): number {
  return (machine.counts.scatters[0] + machine.counts.scatters[1] + machine.counts.scatters[2]) / SLOT_COMBOS;
}

/** The most one paid spin can win at these stakes, in Silver: counts.best x the highest stake / 20. */
export function slotLargestWin(machine: SlotMachine, stakes: SlotStakes): number {
  return (machine.counts.best * stakes[2]) / SLOT_STAKE_STEP;
}

/** The share of a lost stake that goes to the pot, in billionths: { num, den: 1_000_000_000 }. */
export function slotJackpotShare(machine: SlotMachine): { num: number; den: number } {
  // The -1 covers floating-point error, so the share never rounds up past what is left to give.
  const num = Math.max(0, Math.floor(((1 - slotReturn(machine)) / slotLostRate(machine)) * NINE) - 1);
  return { num, den: NINE };
}

/** What a lost round of `stake` Silver adds to the pot, in whole Bronze, rounded down. */
export function slotJackpotAdd(machine: SlotMachine, stake: number): number {
  // BigInt: stake x 1000 x num passes 2^53.
  const { num, den } = slotJackpotShare(machine);
  return Number((BigInt(stake) * 1000n * BigInt(num)) / BigInt(den));
}
