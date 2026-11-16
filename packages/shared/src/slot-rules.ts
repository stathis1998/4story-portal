import {
  SLOT_CHAIN_MAX,
  SLOT_FREE_MAX,
  SLOT_FREE_MULTIPLIER_MAX,
  SLOT_FREE_SPINS,
  SLOT_FREE_START,
  SLOT_LETTERS,
  SLOT_METER_FREE,
  SLOT_REELS,
  SLOT_REEL_STOPS,
  SLOT_RETRIGGER,
  SLOT_ROWS,
  SLOT_SCATTER,
  SLOT_STEP_MULTIPLIER_MAX,
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

const SCATTER_COUNTS = Object.keys(SLOT_FREE_SPINS).map(Number);
/** The fewest scatters that win (or retrigger) free spins. */
const FEWEST_SCATTERS = Math.min(...SCATTER_COUNTS);
/** More scatters than this pay as this many: a cascade can show more than one per reel. */
const MOST_SCATTERS = Math.max(...SCATTER_COUNTS);

/** [reel][row] symbol indexes; row 0 top. */
export type SlotGrid = number[][];

/** The symbol at a strip position. Positions wrap by the strip's own length and may be negative. */
function symbolAt(reel: string, position: number): number {
  return SLOT_LETTERS.indexOf(reel[((position % reel.length) + reel.length) % reel.length]);
}

/**
 * [reel][row] symbol indexes. Row 1 is the stop; row 0 is the strip's letter before it, row 2 the one after.
 * It wraps by each strip's own length, so a test can use short strips; the real machines are all 32.
 */
export function slotWindow(machine: Pick<SlotMachine, 'reels'>, stops: SlotStops): SlotGrid {
  return machine.reels.map((reel, i) => [symbolAt(reel, stops[i] - 1), symbolAt(reel, stops[i]), symbolAt(reel, stops[i] + 1)]);
}

/** `line` indexes SLOT_LINES. `multiple` is in line stakes, before any multiplier. */
export type SlotLineWin = { line: number; symbol: number; count: 2 | 3 | 4 | 5; multiple: number };

/** What 20 lines and the scatters read on any grid. `multiple` in line stakes, no multiplier. */
export function slotLinesOn(
  machine: Pick<SlotMachine, 'pays' | 'twoLucky'>,
  grid: SlotGrid,
): { lines: SlotLineWin[]; multiple: number; scatters: number } {
  const lines: SlotLineWin[] = [];
  SLOT_LINES.forEach((rows, line) => {
    const symbols = rows.map((row, reel) => grid[reel][row]);
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
  return {
    lines,
    multiple: lines.reduce((sum, l) => sum + l.multiple, 0),
    scatters: grid.flat().filter((s) => s === SLOT_SCATTER).length,
  };
}

export type SlotStep = {
  grid: SlotGrid;
  lines: SlotLineWin[];
  /** Line stakes this step's lines pay, before any multiplier. */
  multiple: number;
  /**
   * The tiles that burst, [reel, row], each once, reel then row. Empty for the step that ends the chain.
   * A 12th step that wins still lists its winning tiles, though nothing falls after it.
   */
  burst: [number, number][];
  /**
   * How many rows each tile of this grid fell to reach its place: [reel][row]. All 0 on step 1.
   * A tile that survived the last burst fell one row for each tile that burst below it on its reel. A tile
   * new to the window entered from above it with the others new to that reel, so each fell as many rows as
   * that reel lost.
   */
  drop: number[][];
};
/** Every step read, the last one winning nothing unless the chain hit SLOT_CHAIN_MAX. */
export type SlotChain = { steps: SlotStep[]; scatters: number; capped: boolean };

/** Every tile within a winning line's paying count. Scatters never are: they neither start nor carry a line. */
function burstTiles(lines: SlotLineWin[]): [number, number][] {
  const hit = Array.from({ length: SLOT_REELS }, () => new Array<boolean>(SLOT_ROWS).fill(false));
  for (const { line, count } of lines) for (let reel = 0; reel < count; reel++) hit[reel][SLOT_LINES[line][reel]] = true;
  const burst: [number, number][] = [];
  hit.forEach((rows, reel) => rows.forEach((h, row) => h && burst.push([reel, row])));
  return burst;
}

export function slotChain(machine: Pick<SlotMachine, 'reels' | 'pays' | 'twoLucky'>, stops: SlotStops): SlotChain {
  // The strip position each reel's top row shows. It only ever falls, and may go below 0: symbolAt wraps it.
  const top = stops.map((stop) => stop - 1);
  let grid = slotWindow(machine, stops);
  let drop = grid.map((tiles) => tiles.map(() => 0));
  const steps: SlotStep[] = [];
  for (;;) {
    const { lines, multiple, scatters } = slotLinesOn(machine, grid);
    const burst = burstTiles(lines);
    steps.push({ grid, lines, multiple, burst, drop });
    if (lines.length === 0 || steps.length === SLOT_CHAIN_MAX) return { steps, scatters, capped: lines.length > 0 };
    // Each reel's survivors slide to the bottom in their order; the strip above its top row fills the gaps.
    const next: SlotGrid = [];
    const fell: number[][] = [];
    grid.forEach((tiles, reel) => {
      const lost = burst.filter(([r]) => r === reel).map(([, row]) => row);
      const kept = tiles.map((symbol, row) => ({ symbol, row })).filter(({ row }) => !lost.includes(row));
      const k = lost.length;
      top[reel] -= k;
      next.push([
        ...Array.from({ length: k }, (_, i) => symbolAt(machine.reels[reel], top[reel] + i)),
        ...kept.map((t) => t.symbol),
      ]);
      fell.push([...new Array<number>(k).fill(k), ...kept.map((t, i) => k + i - t.row)]);
    });
    grid = next;
    drop = fell;
  }
}

/** A paid spin's chain, in line stakes: the sum over steps of multiple x min(step, 5). */
export function slotPaidChainPay(chain: SlotChain): number {
  return chain.steps.reduce((sum, step, i) => sum + step.multiple * Math.min(i + 1, SLOT_STEP_MULTIPLIER_MAX), 0);
}

export type SlotRoundPlay = {
  stops: SlotStops;
  free: SlotStops[];
  meterFree: SlotStops[];
  /** Line stakes the whole round pays; Silver is this x stake / SLOT_LINE_COUNT. */
  lineStakes: number;
  meterBefore: number;
  meterAfter: number;
};

type Draw = (kind: 'paid' | 'free' | 'meter') => SlotStops;

/**
 * A free round of `spins`, scatter or meter. The multiplier starts at SLOT_FREE_START, rises by 1 after
 * every winning step up to SLOT_FREE_MULTIPLIER_MAX and carries across spins. A spin whose last window
 * shows enough scatters adds SLOT_RETRIGGER spins, never past SLOT_FREE_MAX in the round.
 */
function playFreeRound(
  machine: SlotMachine,
  spins: number,
  draw: () => SlotStops,
): { played: SlotStops[]; lineStakes: number } {
  const played: SlotStops[] = [];
  let left = spins;
  let total = spins;
  let times = SLOT_FREE_START;
  let lineStakes = 0;
  while (left > 0) {
    const stops = draw();
    played.push(stops);
    const chain = slotChain(machine, stops);
    for (const step of chain.steps) {
      if (step.lines.length === 0) continue;
      lineStakes += step.multiple * times;
      times = Math.min(times + 1, SLOT_FREE_MULTIPLIER_MAX);
    }
    if (chain.scatters >= FEWEST_SCATTERS) {
      const add = Math.min(SLOT_RETRIGGER, SLOT_FREE_MAX - total);
      left += add;
      total += add;
    }
    left -= 1;
  }
  return { played, lineStakes };
}

/** The round itself. Draws come in the spec's order: the paid spin, its free spins as played, then the meter's. */
function playRound(machine: SlotMachine, meterBefore: number, draw: Draw): SlotRoundPlay {
  const stops = draw('paid');
  const chain = slotChain(machine, stops);
  const won = SLOT_FREE_SPINS[Math.min(chain.scatters, MOST_SCATTERS)] ?? 0;
  const free = playFreeRound(machine, won, () => draw('free'));
  // Points come from the last window's 1 or 2 scatters; a spin with more already won free spins.
  let meterAfter = meterBefore + (won === 0 ? chain.scatters : 0);
  let meter = { played: [] as SlotStops[], lineStakes: 0 };
  if (meterAfter >= machine.meterSize) {
    meter = playFreeRound(machine, SLOT_METER_FREE, () => draw('meter'));
    meterAfter -= machine.meterSize;
  }
  return {
    stops,
    free: free.played,
    meterFree: meter.played,
    lineStakes: slotPaidChainPay(chain) + free.lineStakes + meter.lineStakes,
    meterBefore,
    meterAfter,
  };
}

/** Plays a round, drawing stops as the rules need them, in the spec's draw order. */
export function slotPlayRound(machine: SlotMachine, meterBefore: number, draw: () => SlotStops): SlotRoundPlay {
  return playRound(machine, meterBefore, () => draw());
}

/** Plays a recorded round again; throws if the record has too few or too many stops for what the rules play. */
export function slotReplayRound(
  machine: SlotMachine,
  round: Pick<SlotRoundPlay, 'stops' | 'free' | 'meterFree' | 'meterBefore'>,
): SlotRoundPlay {
  const names = { paid: 'paid spin', free: 'free spin', meter: 'meter free spin' } as const;
  const record = { paid: [round.stops], free: [...round.free], meter: [...round.meterFree] };
  const play = playRound(machine, round.meterBefore, (kind) => {
    const stops = record[kind].shift();
    if (!stops) throw new Error(`The record has too few ${names[kind]} stops for this round`);
    return stops;
  });
  for (const kind of ['free', 'meter'] as const) {
    if (record[kind].length > 0)
      throw new Error(`The record has ${record[kind].length} ${names[kind]} stops more than this round plays`);
  }
  return play;
}

/** '3,17,0,22,9;1,2,3,4,5', '' for none. */
export function slotFreeText(free: SlotStops[]): string {
  return free.map((stops) => stops.join(',')).join(';');
}

/** Null when the text is not that: a wrong count of stops, a stop outside 0..31, more than 50 spins, anything else. */
export function parseSlotFree(text: string): SlotStops[] | null {
  if (text === '') return [];
  const spins = text.split(';');
  if (spins.length > SLOT_FREE_MAX) return null;
  const free: SlotStops[] = [];
  for (const spin of spins) {
    if (!/^\d+(,\d+){4}$/.test(spin)) return null;
    const stops = spin.split(',').map(Number);
    if (stops.some((n) => n >= SLOT_REEL_STOPS)) return null;
    free.push(stops as SlotStops);
  }
  return free;
}
