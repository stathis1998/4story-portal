import { SLOT_REEL_STOPS, slotChain } from '@4story-portal/shared';
import type { SlotMachine, SlotStep, SlotStops } from '@4story-portal/shared';

/**
 * The first stops, counting up from [0, 0, 0, 0, 0] with the last reel fastest, whose spin `want` accepts. So a test
 * can ask a real machine for "a spin that wins 8 free spins" and stay right whatever its strips are. `want` also gets
 * the stops it is looking at, to read their window; it must not change them.
 */
export function stopsWhere(machine: SlotMachine, want: (out: SlotStep & { scatters: number }, stops: SlotStops) => boolean): SlotStops {
  const stops: SlotStops = [0, 0, 0, 0, 0];
  for (;;) {
    const chain = slotChain(machine, stops);
    if (want({ ...chain.steps[0], scatters: chain.scatters }, stops)) return [...stops];
    let reel = 4;
    while (reel >= 0 && stops[reel] === SLOT_REEL_STOPS - 1) stops[reel--] = 0;
    if (reel < 0) throw new Error('No stops satisfy that');
    stops[reel]++;
  }
}

/** Filler rows that can never start or continue a win. */
export const TOP = 'GHGHG';
export const BOTTOM = 'HGHGH';

const NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet'];

/** A machine with these five strips. pays[i] = [5, 20, 100] times (i + 1); twoLucky = 2. Symbols are named Alpha, Bravo ... */
export function machineOf(reels: readonly string[], meterSize = 30): SlotMachine {
  return {
    key: 'shelf',
    name: 'Fixture',
    symbols: NAMES.map((name, i) => ({ name, sprite: i })),
    reels: reels as unknown as SlotMachine['reels'],
    pays: Array.from({ length: 8 }, (_, i) => [5 * (i + 1), 20 * (i + 1), 100 * (i + 1)] as const),
    twoLucky: 2,
    stakes: [20, 40, 60],
    meterSize,
    counts: { last: [0, 0, 0, 0, 0, 0], blankLast: [0, 0, 0, 0, 0, 0], free: [], steps: [], best: 0, longest: 0, capped: 0 },
    rest: [0, 0, 0, 0, 0],
  };
}

/**
 * A machine whose window at stops [4k+1 x5] is windows[k] (three rows of five letters). Unused strip positions are 'G'.
 */
export function showing(...windows: [string, string, string][]): SlotMachine {
  return machineOf([0, 1, 2, 3, 4].map((r) => windows.map((w) => `${w[0][r]}${w[1][r]}${w[2][r]}G`).join('')));
}

/** The stops that show windows[k] of a `showing` machine. */
export const at = (k: number): SlotStops => [4 * k + 1, 4 * k + 1, 4 * k + 1, 4 * k + 1, 4 * k + 1];

/**
 * A machine whose strips are these rows read downward, one letter per reel. At `bottom(rows)` the window is the
 * last three rows; a cascade then pulls the rows above it down, nearest first.
 */
export function stacked(rows: string[], meterSize = 30): SlotMachine {
  return machineOf([0, 1, 2, 3, 4].map((r) => rows.map((row) => row[r]).join('')), meterSize);
}
export const bottom = (rows: string[]): SlotStops => Array(5).fill(rows.length - 2) as SlotStops;
export const same = (stop: number): SlotStops => [stop, stop, stop, stop, stop];
