import { SLOT_REEL_STOPS, slotSpin } from '@4story-portal/shared';
import type { SlotMachine, SlotSpinOutcome, SlotStops } from '@4story-portal/shared';

/**
 * The first stops, counting up from [0, 0, 0, 0, 0] with the last reel fastest, whose spin `want` accepts. So a test
 * can ask a real machine for "a spin that wins 8 free spins" and stay right whatever its strips are. `want` also gets
 * the stops it is looking at, to read their window; it must not change them.
 */
export function stopsWhere(machine: SlotMachine, want: (out: SlotSpinOutcome, stops: SlotStops) => boolean): SlotStops {
  const stops: SlotStops = [0, 0, 0, 0, 0];
  for (;;) {
    if (want(slotSpin(machine, stops), stops)) return [...stops];
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

/**
 * A machine whose window at stops [4k+1 x5] is windows[k] (three rows of five letters). pays[i] = [5, 20, 100]
 * times (i + 1); twoLucky = 2. Unused strip positions are 'G'. Symbols are named Alpha, Bravo ...
 */
export function showing(...windows: [string, string, string][]): SlotMachine {
  const reels = [0, 1, 2, 3, 4].map((r) =>
    windows.map((w) => `${w[0][r]}${w[1][r]}${w[2][r]}G`).join(''),
  ) as unknown as SlotMachine['reels'];
  return {
    key: 'shelf',
    name: 'Fixture',
    symbols: NAMES.map((name, i) => ({ name, sprite: i })),
    reels,
    pays: Array.from({ length: 8 }, (_, i) => [5 * (i + 1), 20 * (i + 1), 100 * (i + 1)] as const),
    twoLucky: 2,
    stakes: [20, 40, 60],
    counts: { linePaid: 0, blank: 0, scatters: [0, 0, 0], blankScatters: [0, 0, 0], best: 0 },
    rest: [0, 0, 0, 0, 0],
  };
}

/** The stops that show windows[k] of a `showing` machine. */
export const at = (k: number): SlotStops => [4 * k + 1, 4 * k + 1, 4 * k + 1, 4 * k + 1, 4 * k + 1];
