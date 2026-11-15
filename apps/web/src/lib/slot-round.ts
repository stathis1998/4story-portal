import { SLOT_BIG_WIN, SLOT_FREE_MULTIPLIER, SLOT_LINE_COUNT, SLOT_LINES, silverText, slotSpin } from '@4story-portal/shared';
import type { SlotMachine, SlotSpinOutcome, SlotSpinView, SlotStops } from '@4story-portal/shared';

export type WinTier = 'none' | 'small' | 'win' | 'big' | 'huge';

/** none: nothing; small: less than the stake; win: up to 10 times it; big: 10 to 50 times; huge: 50 times or more. */
export function winTier(won: number, stake: number): WinTier {
  if (won <= 0) return 'none';
  if (won < stake) return 'small';
  if (won < stake * 10) return 'win';
  if (won < stake * SLOT_BIG_WIN) return 'big';
  return 'huge';
}

export type RoundSpin = {
  stops: SlotStops;
  /** Null for the paid spin; 0, 1, 2... for a free spin. */
  free: number | null;
  outcome: SlotSpinOutcome;
  /** Silver this spin won, already doubled for a free spin. */
  won: number;
  /** The round's running total after this spin. */
  total: number;
};

/** The paid spin first, then the free spins in order. A line stake is the stake shared over the lines. */
export function roundSpins(machine: SlotMachine, spin: Pick<SlotSpinView, 'stops' | 'free' | 'stake'>): RoundSpin[] {
  const lineStake = spin.stake / SLOT_LINE_COUNT;
  let total = 0;
  const one = (stops: SlotStops, free: number | null): RoundSpin => {
    const outcome = slotSpin(machine, stops);
    const won = outcome.multiple * lineStake * (free === null ? 1 : SLOT_FREE_MULTIPLIER);
    total += won;
    return { stops, free, outcome, won, total };
  };
  return [one(spin.stops, null), ...spin.free.map((stops, i) => one(stops, i))];
}

/** The tiles a spin's winning lines run through, as [reel, row], each once. */
export function wonTiles(outcome: SlotSpinOutcome): [number, number][] {
  const seen = new Set<number>();
  for (const win of outcome.lines)
    for (let reel = 0; reel < win.count; reel++) seen.add(reel * 3 + SLOT_LINES[win.line][reel]);
  return [...seen].sort((a, b) => a - b).map((key) => [Math.floor(key / 3), key % 3]);
}

/** The round in words. */
export function roundLine(spin: SlotSpinView, spins: RoundSpin[]): string {
  const stake = silverText(spin.stake);
  if (spin.jackpot > 0)
    return `Jackpot. This round made it drop. You won ${silverText(spin.jackpot)} on a stake of ${stake}.`;
  const n = spins.length - 1;
  if (spin.payout === 0)
    return n > 0 ? `${n} free spins won you nothing. You staked ${stake}.` : `No win this time. You staked ${stake}.`;
  const payout = silverText(spin.payout);
  if (n > 0) {
    const free = spins.slice(1).reduce((sum, s) => sum + s.won, 0);
    return `${n} free spins won you ${free > 0 ? silverText(free) : 'nothing'}. You won ${payout} in all on a stake of ${stake}.`;
  }
  const k = spins[0].outcome.lines.length;
  return `${k} ${k === 1 ? 'line' : 'lines'} won. You won ${payout} on a stake of ${stake}.`;
}

/** A list entry: "Tranus's Shelf: staked 40 Silver, won 1 Gold 200 Silver with 8 free spins". */
export function roundListLine(machine: SlotMachine, spin: SlotSpinView): string {
  const won = spin.jackpot > 0 ? `the jackpot, ${silverText(spin.jackpot)}` : spin.payout > 0 ? silverText(spin.payout) : 'nothing';
  const free = spin.free.length > 0 ? ` with ${spin.free.length} free spins` : '';
  return `${machine.name}: staked ${silverText(spin.stake)}, won ${won}${free}`;
}

/** A big wins entry: "Kael won 12 Gold 500 Silver on The Armoury on a stake of 40 Silver, with 8 free spins". */
export function bigWinLine(machine: SlotMachine, spin: SlotSpinView): string {
  if (spin.jackpot > 0) return `${spin.character} won the jackpot, ${silverText(spin.jackpot)}`;
  const free = spin.free.length > 0 ? `, with ${spin.free.length} free spins` : '';
  return `${spin.character} won ${silverText(spin.payout)} on ${machine.name} on a stake of ${silverText(spin.stake)}${free}`;
}
