import type { SlotMachine, SlotStops } from '@4story-portal/shared';

/** Filler rows that can never start or continue a win. */
export const TOP = 'GHGHG';
export const BOTTOM = 'HGHGH';

const NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet'];

/**
 * A machine whose window at stops [4k+1 x5] is windows[k] (three rows of five letters). pays[i] = [5, 20, 100]
 * times (i + 1); twoLucky = 2. Unused strip positions are 'G'. Symbols are named Alpha, Bravo ... with plurals.
 */
export function showing(...windows: [string, string, string][]): SlotMachine {
  const reels = [0, 1, 2, 3, 4].map((r) =>
    windows.map((w) => `${w[0][r]}${w[1][r]}${w[2][r]}G`).join(''),
  ) as unknown as SlotMachine['reels'];
  return {
    key: 'shelf',
    name: 'Fixture',
    symbols: NAMES.map((name, i) => ({ name, plural: `${name}s`, sprite: i })),
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
