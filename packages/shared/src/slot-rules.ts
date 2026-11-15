import {
  SLOT_FREE_MULTIPLIER,
  SLOT_FREE_SPINS,
  SLOT_LETTERS,
  SLOT_REELS,
  SLOT_REEL_STOPS,
  SLOT_SCATTER,
  SLOT_STAKE_STEP,
  SLOT_WILD,
  type SlotMachine,
  type SlotStops,
} from './slots.js';

/** The row (0 top, 1 middle, 2 bottom) each line takes on reels 1 to 5. */
export const SLOT_LINES: readonly (readonly [number, number, number, number, number])[] = [
  [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
  [1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [0, 0, 1, 2, 2], [2, 2, 1, 0, 0], [1, 2, 1, 0, 1],
  [1, 0, 1, 2, 1], [0, 1, 1, 1, 0], [2, 1, 1, 1, 2], [0, 1, 0, 1, 0], [2, 1, 2, 1, 2],
  [1, 1, 0, 1, 1], [1, 1, 2, 1, 1], [0, 0, 2, 0, 0], [2, 2, 0, 2, 2], [0, 2, 2, 2, 0],
];

/** A round holds at most as many free spins as the best scatter count gives. */
const MAX_FREE_SPINS = Math.max(...Object.values(SLOT_FREE_SPINS));

/**
 * [reel][row] symbol indexes. Row 1 is the stop; row 0 is the strip's letter before it, row 2 the one after.
 * It wraps by each strip's own length, so a test can use short strips; the real machines are all 32.
 */
export function slotWindow(machine: SlotMachine, stops: SlotStops): number[][] {
  return machine.reels.map((reel, i) => {
    const at = (offset: number) => SLOT_LETTERS.indexOf(reel[(((stops[i] + offset) % reel.length) + reel.length) % reel.length]);
    return [at(-1), at(0), at(1)];
  });
}

/** `line` indexes SLOT_LINES. `multiple` is in line stakes and never doubled here. */
export type SlotLineWin = { line: number; symbol: number; count: 2 | 3 | 4 | 5; multiple: number };
export type SlotSpinOutcome = {
  /** Lowest line first. */
  lines: SlotLineWin[];
  /** The lines added together, in line stakes. */
  multiple: number;
  scatters: number;
  /** 0, 8, 12 or 20. What a PAID spin showing this window wins. */
  freeSpins: number;
};

export function slotSpin(machine: SlotMachine, stops: SlotStops): SlotSpinOutcome {
  const window = slotWindow(machine, stops);
  const lines: SlotLineWin[] = [];
  SLOT_LINES.forEach((rows, line) => {
    const symbols = rows.map((row, reel) => window[reel][row]);
    const symbol = symbols[0];
    // A scatter or a wild on reel 1 starts nothing.
    if (symbol >= SLOT_WILD) return;
    let count = 1;
    while (count < SLOT_REELS && (symbols[count] === symbol || symbols[count] === SLOT_WILD)) count++;
    if (count >= 3) {
      lines.push({ line, symbol, count: count as 3 | 4 | 5, multiple: machine.pays[symbol][count - 3] });
    } else if (count === 2 && symbol === 0) {
      lines.push({ line, symbol, count: 2, multiple: machine.twoLucky });
    }
  });
  const scatters = window.flat().filter((s) => s === SLOT_SCATTER).length;
  return {
    lines,
    multiple: lines.reduce((sum, l) => sum + l.multiple, 0),
    scatters,
    freeSpins: SLOT_FREE_SPINS[scatters] ?? 0,
  };
}

export type SlotRound = { stops: SlotStops; free: SlotStops[] };

/** What the round pays in whole Silver at `stake`: (paid spin + 2 x each free spin) x stake / 20. */
export function slotRoundPayout(machine: SlotMachine, round: SlotRound, stake: number): number {
  const free = round.free.reduce((sum, stops) => sum + slotSpin(machine, stops).multiple, 0);
  return (slotSpin(machine, round.stops).multiple + SLOT_FREE_MULTIPLIER * free) * (stake / SLOT_STAKE_STEP);
}

/** '3,17,0,22,9;1,2,3,4,5', '' for none. */
export function slotFreeText(free: SlotStops[]): string {
  return free.map((stops) => stops.join(',')).join(';');
}

/** Null when the text is not that: a wrong count of stops, a stop outside 0..31, more than 20 spins, anything else. */
export function parseSlotFree(text: string): SlotStops[] | null {
  if (text === '') return [];
  const spins = text.split(';');
  if (spins.length > MAX_FREE_SPINS) return null;
  const free: SlotStops[] = [];
  for (const spin of spins) {
    if (!/^\d+(,\d+){4}$/.test(spin)) return null;
    const stops = spin.split(',').map(Number);
    if (stops.some((n) => n >= SLOT_REEL_STOPS)) return null;
    free.push(stops as SlotStops);
  }
  return free;
}
