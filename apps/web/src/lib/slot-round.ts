import {
  SLOT_BIG_WIN,
  SLOT_FREE_MAX,
  SLOT_FREE_MULTIPLIER_MAX,
  SLOT_FREE_SPINS,
  SLOT_FREE_START,
  SLOT_METER_FREE,
  SLOT_POTS,
  SLOT_RETRIGGER,
  SLOT_STEP_MULTIPLIER_MAX,
  SLOT_LINE_COUNT,
  silverText,
  slotChain,
} from '@4story-portal/shared';
import type { SlotMachine, SlotSpinView, SlotStep, SlotStops } from '@4story-portal/shared';

const SCATTER_COUNTS = Object.keys(SLOT_FREE_SPINS).map(Number);
/** The fewest scatters that win (or retrigger) free spins, and the most that pay more. */
const FEWEST_SCATTERS = Math.min(...SCATTER_COUNTS);
const MOST_SCATTERS = Math.max(...SCATTER_COUNTS);

export type WinTier = 'none' | 'small' | 'win' | 'big' | 'huge';

/** none: nothing; small: less than the stake; win: up to 10 times it; big: 10 to 50 times; huge: 50 times or more. */
export function winTier(won: number, stake: number): WinTier {
  if (won <= 0) return 'none';
  if (won < stake) return 'small';
  if (won < stake * 10) return 'win';
  if (won < stake * SLOT_BIG_WIN) return 'big';
  return 'huge';
}

/**
 * Whether the pots a round won are cheered: only when they paid the stake back or more. Only a lost round wins a pot,
 * and a Mini can drop below the stake: that is a small win, told plainly.
 */
export const jackpotCheered = (spin: Pick<SlotSpinView, 'jackpot' | 'stake'>) => spin.jackpot > 0 && spin.jackpot >= spin.stake;

export type ShownStep = SlotStep & {
  /** The multiplier this step paid at: the paid spin's step multiplier, or the free round's climbing one. */
  times: number;
  /** Silver this step won (multiple x times x stake / 20). */
  won: number;
  /** The round's running total after this step. */
  total: number;
};
export type RoundSpin = {
  stops: SlotStops;
  /** 'paid', or the free spin's index, or the meter free spin's index. */
  kind: { paid: true } | { free: number } | { meter: number };
  steps: ShownStep[];
  scatters: number;
  /** Free spins this spin added: the paid spin's award, or a retrigger's (what fit under 50). */
  added: number;
  won: number;
  total: number;
};

/**
 * The paid spin, then its free spins, then its meter free spins, each as the steps to show. A free round starts at
 * times 2 and every winning step pays at it and raises it, up to 10. A line stake is the stake shared over the lines.
 */
export function roundSpins(machine: SlotMachine, spin: Pick<SlotSpinView, 'stops' | 'free' | 'meterFree' | 'stake'>): RoundSpin[] {
  const lineStake = spin.stake / SLOT_LINE_COUNT;
  let total = 0;
  const show = (stops: SlotStops, kind: RoundSpin['kind'], timesOf: (step: SlotStep, j: number) => number) => {
    const chain = slotChain(machine, stops);
    let won = 0;
    const steps = chain.steps.map((step, j): ShownStep => {
      const times = timesOf(step, j);
      const stepWon = step.multiple * times * lineStake;
      won += stepWon;
      total += stepWon;
      return { ...step, times, won: stepWon, total };
    });
    return { stops, kind, steps, scatters: chain.scatters, won, total };
  };

  const paid = show(spin.stops, { paid: true }, (_step, j) => Math.min(j + 1, SLOT_STEP_MULTIPLIER_MAX));
  const given = SLOT_FREE_SPINS[Math.min(paid.scatters, MOST_SCATTERS)] ?? 0;
  const spins: RoundSpin[] = [{ ...paid, added: given }];

  const freeRound = (list: SlotStops[], start: number, kind: (i: number) => RoundSpin['kind']) => {
    let times = SLOT_FREE_START;
    let planned = start;
    list.forEach((stops, i) => {
      const one = show(stops, kind(i), (step) => {
        const current = times;
        if (step.lines.length > 0) times = Math.min(times + 1, SLOT_FREE_MULTIPLIER_MAX);
        return current;
      });
      const added = one.scatters >= FEWEST_SCATTERS ? Math.min(SLOT_RETRIGGER, SLOT_FREE_MAX - planned) : 0;
      planned += added;
      spins.push({ ...one, added });
    });
  };
  freeRound(spin.free, given, (free) => ({ free }));
  freeRound(spin.meterFree, SLOT_METER_FREE, (meter) => ({ meter }));
  return spins;
}

/** The tiles a step's winning lines run through, as [reel, row], each once. */
export function wonTiles(step: SlotStep): [number, number][] {
  return step.burst;
}

/** The pots a round won, as "Mini and Giga". */
function potNames(spin: SlotSpinView): string[] {
  return SLOT_POTS.filter((pot) => spin.pots[pot] > 0).map((pot) => pot[0].toUpperCase() + pot.slice(1));
}

/** "Mini", "Mini and Giga", "Mini, Major and Giga". */
function potList(names: string[]): string {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** The round in words. */
export function roundLine(spin: SlotSpinView, spins: RoundSpin[]): string {
  const stake = silverText(spin.stake);
  const pots = potNames(spin);
  if (pots.length > 0)
    return `${potList(pots)} ${pots.length > 1 ? 'jackpots' : 'jackpot'}. You won ${silverText(spin.jackpot)} on a stake of ${stake}.`;
  if (spin.payout === 0) return `No win this time. You staked ${stake}.`;
  const payout = silverText(spin.payout);
  const n = spin.free.length + spin.meterFree.length;
  if (n > 0) {
    const free = spins.slice(1).reduce((sum, s) => sum + s.won, 0);
    return `${n} free spins won you ${free > 0 ? silverText(free) : 'nothing'}. You won ${payout} in all on a stake of ${stake}.`;
  }
  const winning = spins[0].steps.filter((step) => step.lines.length > 0);
  if (winning.length >= 2) return `A chain of ${winning.length}. You won ${payout} on a stake of ${stake}.`;
  const k = winning.reduce((sum, step) => sum + step.lines.length, 0);
  return `${k} ${k === 1 ? 'line' : 'lines'} won. You won ${payout} on a stake of ${stake}.`;
}

/** A list entry: "Tranus's Shelf: staked 40 Silver, won 1 Gold 200 Silver with 8 free spins". */
export function roundListLine(machine: SlotMachine, spin: SlotSpinView): string {
  const won = spin.jackpot > 0 ? `the jackpot, ${silverText(spin.jackpot)}` : spin.payout > 0 ? silverText(spin.payout) : 'nothing';
  const n = spin.free.length + spin.meterFree.length;
  const free = n > 0 ? ` with ${n} free spins` : '';
  return `${machine.name}: staked ${silverText(spin.stake)}, won ${won}${free}`;
}

/** A big wins entry: "Kael won 12 Gold 500 Silver on The Armoury on a stake of 40 Silver, with 8 free spins". */
export function bigWinLine(machine: SlotMachine, spin: SlotSpinView): string {
  const pots = potNames(spin);
  if (pots.length > 0)
    return `${spin.character} won the ${potList(pots)} ${pots.length > 1 ? 'jackpots' : 'jackpot'}, ${silverText(spin.jackpot)}`;
  const n = spin.free.length + spin.meterFree.length;
  const free = n > 0 ? `, with ${n} free spins` : '';
  return `${spin.character} won ${silverText(spin.payout)} on ${machine.name} on a stake of ${silverText(spin.stake)}${free}`;
}
