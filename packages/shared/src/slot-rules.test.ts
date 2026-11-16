import { describe, expect, it } from 'vitest';
import { SLOT_SCATTER, type SlotMachine, type SlotStops } from './slots.js';
import {
  SLOT_LINES,
  parseSlotFree,
  slotChain,
  slotFreeText,
  slotLinesOn,
  slotPaidChainPay,
  slotPlayRound,
  slotReplayRound,
  slotWindow,
  type SlotChain,
  type SlotGrid,
} from './slot-rules.js';

const LETTERS = 'ABCDEFGHIJ';
const TOP = 'GHGHG', BOTTOM = 'HGHGH'; // filler rows that can never start or continue a win here

/** A machine with these five strips. pays[i] = [5, 20, 100] times (i + 1); twoLucky = 2. */
function machineOf(reels: readonly string[], meterSize = 30): SlotMachine {
  return {
    key: 'shelf',
    name: 'Fixture',
    symbols: Array.from({ length: 10 }, (_, i) => ({ name: `S${i}`, sprite: i })),
    reels: reels as SlotMachine['reels'],
    pays: Array.from({ length: 8 }, (_, i) => [5 * (i + 1), 20 * (i + 1), 100 * (i + 1)] as const),
    twoLucky: 2,
    stakes: [20, 40, 60],
    meterSize,
    // Placeholders: nothing here reads the counts.
    counts: { last: [0, 0, 0, 0, 0, 0], blankLast: [0, 0, 0, 0, 0, 0], free: [], steps: [], best: 0, longest: 0, capped: 0 },
    rest: [0, 0, 0, 0, 0],
  };
}

/** A machine whose window at stops [4k+1 x5] is windows[k] (three rows of five letters). Unused strip positions are 'G'. */
function showing(...windows: [string, string, string][]): SlotMachine {
  return machineOf([0, 1, 2, 3, 4].map((r) => windows.map((w) => `${w[0][r]}${w[1][r]}${w[2][r]}G`).join('')));
}
const at = (k: number): SlotStops => [4 * k + 1, 4 * k + 1, 4 * k + 1, 4 * k + 1, 4 * k + 1];

/**
 * A machine whose strips are these rows read downward, one letter per reel, so a test can say what falls in.
 * At `bottom(rows)` the window is the last three rows; a cascade then pulls the rows above it down, nearest first.
 */
function stacked(rows: string[], meterSize = 30): SlotMachine {
  return machineOf([0, 1, 2, 3, 4].map((r) => rows.map((row) => row[r]).join('')), meterSize);
}
const bottom = (rows: string[]): SlotStops => Array(5).fill(rows.length - 2) as SlotStops;
const same = (stop: number): SlotStops => [stop, stop, stop, stop, stop];

/** Three rows of five letters as a [reel][row] grid. */
const grid = (rows: [string, string, string]): SlotGrid => [0, 1, 2, 3, 4].map((r) => rows.map((row) => LETTERS.indexOf(row[r])));
/** One reel's tiles, top first. */
const col = (letters: string) => [...letters].map((l) => LETTERS.indexOf(l));
const scattersOn = (g: SlotGrid) => g.flat().filter((s) => s === SLOT_SCATTER).length;
const still = [0, 0, 0];

/** Draws these stops in turn, then keeps drawing the last one; `calls` counts the draws. */
function drawing(...list: SlotStops[]) {
  const counter = { calls: 0, draw: () => list[Math.min(counter.calls++, list.length - 1)] };
  return counter;
}

// Reel 1 shows only C and D, reel 2 only E and F: no line can win unless a test puts a B on both.
// One winning line, the middle of reels 1-3, then nothing.
const ONE_WIN = ['DFEGH', 'CEGHG', 'BBBCD', 'DFHGH'];
// The middle line wins, then the letters above make the top line win, then nothing. Its rows 0-2 show 3 scatters.
const TWO_WINS = ['CEJHG', 'DFHJH', 'CEGHJ', 'DFEGH', 'BBBGH', 'CEGHG', 'BBBCD', 'DFHGH'];
// Two scatters show; the middle line wins and a third scatter falls in on reel 3. Its rows 0-2 show nothing.
const SCATTER_FALLS = ['CEGHG', 'DFHGH', 'CEGHG', 'DFJGH', 'CJGHG', 'BBBCD', 'DFHGJ'];

it('has 20 different lines of rows 0 to 2', () => {
  expect(SLOT_LINES).toHaveLength(20);
  expect(new Set(SLOT_LINES.map((l) => l.join(''))).size).toBe(20);
  for (const line of SLOT_LINES) {
    expect(line).toHaveLength(5);
    for (const row of line) expect([0, 1, 2]).toContain(row);
  }
});

// With a wild in the middle of reel 2, a filler symbol on reel 1 could win through it. A scatter there cannot.
const WILD_TOP = 'JHGHG', WILD_BOTTOM = 'JGHGH';

describe('lines on a grid', () => {
  const m = machineOf(['A', 'A', 'A', 'A', 'A']);

  it.each([
    ['three alike from the left', [TOP, 'BBBCD', BOTTOM], [{ line: 0, symbol: 1, count: 3, multiple: 10 }]],
    ['four alike', [TOP, 'BBBBD', BOTTOM], [{ line: 0, symbol: 1, count: 4, multiple: 40 }]],
    ['five alike', [TOP, 'BBBBB', BOTTOM], [{ line: 0, symbol: 1, count: 5, multiple: 200 }]],
    ['a wild completes a line', [WILD_TOP, 'BIBCD', WILD_BOTTOM], [{ line: 0, symbol: 1, count: 3, multiple: 10 }]],
    ['two wilds complete a line', [WILD_TOP, 'BIICD', WILD_BOTTOM], [{ line: 0, symbol: 1, count: 3, multiple: 10 }]],
    ['two alike pay nothing', [TOP, 'BBCDE', BOTTOM], []],
    ['a line must start on reel 1', [TOP, 'CBBBB', BOTTOM], []],
    ['a scatter on reel 1 pays nothing', [TOP, 'JBBBB', BOTTOM], []],
    ['a wild on reel 1 pays nothing', [TOP, 'IBBBB', BOTTOM], []],
  ])('%s', (_name, rows, lines) => {
    const out = slotLinesOn(m, grid(rows as [string, string, string]));
    expect(out.lines).toEqual(lines);
    expect(out.multiple).toBe(lines.reduce((sum, l) => sum + l.multiple, 0));
  });

  it('pays two lucky symbols on every line through them', () => {
    // Lines 1, 16 and 17 all run through the middle of reels 1 and 2.
    const out = slotLinesOn(m, grid([TOP, 'AACDE', BOTTOM]));
    expect(out.lines.map((l) => [l.line, l.count, l.multiple])).toEqual([[0, 2, 2], [15, 2, 2], [16, 2, 2]]);
    expect(out.multiple).toBe(6);
  });

  it('counts a lucky symbol and a wild as two', () =>
    expect(slotLinesOn(m, grid([WILD_TOP, 'AICDE', WILD_BOTTOM])).multiple).toBe(6));

  it('adds up two winning lines', () => {
    const out = slotLinesOn(m, grid(['CCCGH', 'BBBDE', 'HGHGH']));
    expect(out.lines).toEqual([
      { line: 0, symbol: 1, count: 3, multiple: 10 },
      { line: 1, symbol: 2, count: 3, multiple: 15 },
    ]);
    expect(out.multiple).toBe(25);
  });

  it.each([
    [['JHGHG', 'BCJDE', 'HGHGJ'], 3],
    [[TOP, 'JJJJG', BOTTOM], 4],
    [[TOP, 'JJJJJ', BOTTOM], 5],
    [['GHCHG', 'JIJBB', 'HGDGH'], 2], // a wild is not a scatter
  ])('scatters count anywhere in the grid: %j', (rows, scatters) => {
    const out = slotLinesOn(m, grid(rows as [string, string, string]));
    expect([out.scatters, out.multiple]).toEqual([scatters, 0]);
  });

  it('reads lines and scatters on any grid', () => {
    // Two scatters on one reel and six in all: no strip of 32 shows this, a cascade can.
    const out = slotLinesOn(m, grid(['JJCHJ', 'BBBCD', 'JJGHJ']));
    expect(out.lines).toEqual([{ line: 0, symbol: 1, count: 3, multiple: 10 }]);
    expect(out.scatters).toBe(6);
    // A window is just a grid.
    const shown = showing([TOP, 'BBBBD', BOTTOM]);
    expect(slotLinesOn(shown, slotWindow(shown, at(0)))).toEqual(slotLinesOn(m, grid([TOP, 'BBBBD', BOTTOM])));
  });
});

it('shows the real neighbours of a stop and wraps the loop', () => {
  const m = showing(['ABCDE', 'BCDEF', 'CDEFG'], ['GFEDC', 'FEDCB', 'EDCBA']);
  const len = m.reels[0].length;
  const letter = (r: number, i: number) => 'ABCDEFGHIJ'.indexOf(m.reels[r][i]);
  const win = slotWindow(m, [0, 0, 0, 0, 0]);
  expect(win).toHaveLength(5);
  for (let r = 0; r < 5; r++) expect(win[r]).toEqual([letter(r, len - 1), letter(r, 0), letter(r, 1)]);
  const last = slotWindow(m, [len - 1, len - 1, len - 1, len - 1, len - 1]);
  for (let r = 0; r < 5; r++) expect(last[r]).toEqual([letter(r, len - 2), letter(r, len - 1), letter(r, 0)]);
});

describe('a cascade', () => {
  it('ends after one step when nothing wins', () => {
    const m = showing([TOP, 'CDEFG', BOTTOM]);
    const chain = slotChain(m, at(0));
    expect(chain.steps).toHaveLength(1);
    expect(chain.steps[0]).toEqual({
      grid: slotWindow(m, at(0)),
      lines: [],
      multiple: 0,
      burst: [],
      drop: [still, still, still, still, still],
    });
    expect(chain.capped).toBe(false);
  });

  it('bursts a winning line and refills from the strip above', () => {
    const chain = slotChain(stacked(ONE_WIN), bottom(ONE_WIN));
    expect(chain.steps).toHaveLength(2);
    const [first, second] = chain.steps;
    expect(first.grid).toEqual(grid(['CEGHG', 'BBBCD', 'DFHGH']));
    expect(first.lines).toEqual([{ line: 0, symbol: 1, count: 3, multiple: 10 }]);
    expect(first.multiple).toBe(10);
    expect(first.burst).toEqual([[0, 1], [1, 1], [2, 1]]);
    expect(first.drop).toEqual([still, still, still, still, still]);
    // Reels 1-3: the letter above the window (strip[p - 1]) on top, then old rows 0 and 2.
    expect(second.grid).toEqual([col('DCD'), col('FEF'), col('EGH'), col('HCG'), col('GDH')]);
    expect(second.drop).toEqual([[1, 1, 0], [1, 1, 0], [1, 1, 0], still, still]);
    expect(second).toMatchObject({ lines: [], multiple: 0, burst: [] });
    expect(chain.capped).toBe(false);
  });

  it('bursts a tile on two lines once', () => {
    // Lines 1 and 16 share the middle of reels 1 and 2; line 16 takes reel 3's top row.
    const rows = ['DFGGH', 'CEEHG', 'CEBHG', 'BBBCD', 'DFHGH'];
    const [first, second] = slotChain(stacked(rows), bottom(rows)).steps;
    expect(first.lines.map((l) => [l.line, l.count])).toEqual([[0, 3], [15, 3]]);
    expect(first.multiple).toBe(20);
    expect(first.burst).toEqual([[0, 1], [1, 1], [2, 0], [2, 1]]);
    // Reel 3 lost two: strip[p - 2] and strip[p - 1] fall in as a block, two rows each, above its survivor.
    expect(second.grid[2]).toEqual(col('GEH'));
    expect(second.drop[2]).toEqual([2, 2, 0]);
    expect(second.grid[0]).toEqual(col('CCD'));
    expect(second.drop[0]).toEqual([1, 1, 0]);
  });

  it('bursts exactly the two tiles of a two lucky symbols win', () => {
    // Lines 1, 16 and 17 all pay the two Alphas in the middle of reels 1 and 2, and they burst once each.
    const rows = ['DFEGH', 'CEGHG', 'AACDE', 'DFHGH'];
    const [first, second] = slotChain(stacked(rows), bottom(rows)).steps;
    expect(first.lines.map((l) => [l.line, l.count, l.multiple])).toEqual([[0, 2, 2], [15, 2, 2], [16, 2, 2]]);
    expect(first.burst).toEqual([[0, 1], [1, 1]]);
    // Only reels 1 and 2 refill; reel 3's C, past the count of 2, stays where it was.
    expect(second.drop).toEqual([[1, 1, 0], [1, 1, 0], still, still, still]);
    expect(second.grid.slice(0, 3)).toEqual([col('DCD'), col('FEF'), col('GCH')]);
  });

  it('bursts a wild that helped a line', () => {
    // The wild on reel 2 makes the line; the wild on reel 5 is past the line's count of 3.
    const rows = ['DFEGH', 'CEGHG', 'BIBCI', 'DFHGH'];
    const [first, second] = slotChain(stacked(rows), bottom(rows)).steps;
    expect(first.lines).toEqual([{ line: 0, symbol: 1, count: 3, multiple: 10 }]);
    expect(first.burst).toEqual([[0, 1], [1, 1], [2, 1]]);
    expect(second.grid[1]).toEqual(col('FEF'));
    expect(second.grid[4]).toEqual(col('GIH'));
  });

  it('never bursts a scatter, so scatters only stay or grow', () => {
    const chain = slotChain(stacked(SCATTER_FALLS), bottom(SCATTER_FALLS));
    expect(chain.steps.map((s) => scattersOn(s.grid))).toEqual([2, 3]);
    for (const step of chain.steps)
      for (const [reel, row] of step.burst) expect(step.grid[reel][row]).not.toBe(SLOT_SCATTER);
    // Reel 2's scatter slid from the top row to the middle; reel 3's fell in from above.
    const [, second] = chain.steps;
    expect(second.grid[1]).toEqual(col('FJF'));
    expect(second.drop[1]).toEqual([1, 1, 0]);
    expect(second.grid[2]).toEqual(col('JGH'));
    expect(chain.scatters).toBe(3);
  });

  it('pays each step times its step, then 5 from step 5 on', () => {
    const chainOf = (...multiples: number[]): SlotChain => ({
      steps: multiples.map((multiple) => ({ grid: [], lines: [], multiple, burst: [], drop: [] })),
      scatters: 0,
      capped: false,
    });
    const tens = (n: number) => Array<number>(n).fill(10);
    expect([1, 2, 3, 4, 5, 6].map((n) => slotPaidChainPay(chainOf(...tens(n), 0)))).toEqual([10, 30, 60, 100, 150, 200]);
    expect(slotPaidChainPay(chainOf(...tens(12)))).toBe(100 + 8 * 50);
    expect(slotPaidChainPay(chainOf(0))).toBe(0);
    // A real chain: 10 at times 1, then 10 at times 2.
    expect(slotPaidChainPay(slotChain(stacked(TWO_WINS), bottom(TWO_WINS)))).toBe(30);
  });

  it('stops after 12 steps and says so', () => {
    // Every tile is B: all 20 lines pay five alike on every step, forever.
    const chain = slotChain(machineOf(['BBBB', 'BBBB', 'BBBB', 'BBBB', 'BBBB']), same(1));
    expect(chain.steps).toHaveLength(12);
    expect(chain.capped).toBe(true);
    expect(chain.steps.every((s) => s.multiple === 20 * 200)).toBe(true);
    expect(chain.steps[1].drop).toEqual([[3, 3, 3], [3, 3, 3], [3, 3, 3], [3, 3, 3], [3, 3, 3]]);
    // The 12th step still names its winning tiles, though nothing falls after it.
    expect(chain.steps[11].burst).toHaveLength(15);
  });
});

describe('a round', () => {
  it('plays free spins from the last window, not the first', () => {
    // The first window shows 2 scatters; a third falls in on step 2. Free spins are drawn at the quiet rows 0-2.
    const d = drawing(bottom(SCATTER_FALLS), same(1));
    const round = slotPlayRound(stacked(SCATTER_FALLS), 0, d.draw);
    expect(round.free).toHaveLength(8);
    expect(d.calls).toBe(9);
    expect(round.lineStakes).toBe(10);
    expect(round.meterAfter).toBe(0);
  });

  it('gives 20 free spins for five or more scatters', () => {
    const m = showing(['CEJJJ', 'DFJJJ', 'CEGHG'], [TOP, 'CDEFG', BOTTOM]);
    expect(slotLinesOn(m, slotWindow(m, at(0))).scatters).toBe(6);
    expect(slotPlayRound(m, 0, drawing(at(0), at(1)).draw).free).toHaveLength(20);
  });

  it('climbs the free multiplier from 2 to 10 across the round', () => {
    // 3 scatters win 8 free spins; each free spin is the chain that wins 10, then 10 again.
    const round = slotPlayRound(stacked(TWO_WINS), 0, drawing(same(1), bottom(TWO_WINS)).draw);
    expect(round.free).toHaveLength(8);
    // Times 2, 3 | 4, 5 | 6, 7 | 8, 9 | then 10 for the last 8 winning steps.
    expect(round.lineStakes).toBe(10 * (2 + 3 + 4 + 5 + 6 + 7 + 8 + 9 + 8 * 10));
  });

  it('retriggers 5 spins and never passes 50', () => {
    // Every spin shows 3 scatters: 8, then 13, 18 ... 48, then 50 (only 2 fit), then no more.
    const d = drawing(same(1));
    const round = slotPlayRound(stacked(TWO_WINS), 0, d.draw);
    expect(round.free).toHaveLength(50);
    expect(d.calls).toBe(51);
    expect(round.meterFree).toEqual([]);
  });

  // 2 scatters, nothing; 1 scatter; quiet.
  const meter = (size: number) => ({ ...showing(['GHGHJ', 'CDEFG', 'JGHGH'], ['GHGHJ', 'CDEFG', BOTTOM], [TOP, 'CDEFG', BOTTOM]), meterSize: size });

  it('fills the meter from 1 or 2 scatters, plays 8 free spins when full and keeps the rest', () => {
    const full = slotPlayRound(meter(3), 2, drawing(at(0), at(2)).draw);
    expect(full).toMatchObject({ meterBefore: 2, meterAfter: 1, free: [], lineStakes: 0 });
    expect(full.meterFree).toHaveLength(8);
    const exactly = slotPlayRound(meter(3), 1, drawing(at(0), at(2)).draw);
    expect([exactly.meterAfter, exactly.meterFree.length]).toEqual([0, 8]);
    const one = slotPlayRound(meter(3), 0, drawing(at(1)).draw);
    expect([one.meterAfter, one.meterFree.length]).toEqual([1, 0]);
    const none = slotPlayRound(meter(3), 2, drawing(at(2)).draw);
    expect([none.meterAfter, none.meterFree.length]).toEqual([2, 0]);
  });

  it('adds no meter points from a paid spin that won free spins', () => {
    // Its first window showed 2 scatters, its last 3.
    const round = slotPlayRound(stacked(SCATTER_FALLS, 3), 2, drawing(bottom(SCATTER_FALLS), same(1)).draw);
    expect(round.free).toHaveLength(8);
    expect(round.meterAfter).toBe(2);
    expect(round.meterFree).toEqual([]);
  });

  // Reels 1 and 2 never win. Reels 3-5 show a scatter each at stop 1 and none at stop 4. Reel 1's stop numbers the draws.
  const ORDER = machineOf(['CD'.repeat(16), 'EF'.repeat(16), 'GJGGGG', 'GJGGGG', 'GJGGGG']);
  function playOrder() {
    const drawn: SlotStops[] = [];
    // Draw 0 (the paid spin) and draw 3 (the third free spin) show 3 scatters.
    const draw = (): SlotStops => {
      const n = drawn.length;
      const s = n === 0 || n === 3 ? 1 : 4;
      drawn.push([n, 0, s, s, s]);
      return drawn[n];
    };
    // A meter already at its size pays even when the paid spin won free spins: free spins first, then the meter's.
    return { round: slotPlayRound(ORDER, 30, draw), drawn };
  }

  it('draws in the spec order: paid, free in play order, meter free', () => {
    const { round, drawn } = playOrder();
    expect(drawn).toHaveLength(1 + 13 + 8);
    expect(round.stops).toEqual(drawn[0]);
    expect(round.free).toEqual(drawn.slice(1, 14));
    expect(round.meterFree).toEqual(drawn.slice(14));
    expect([round.meterBefore, round.meterAfter]).toEqual([30, 0]);
  });

  it('replays a recorded round to the same play, and refuses a record with a stop too many or too few', () => {
    const { round } = playOrder();
    const { stops, free, meterFree, meterBefore } = round;
    expect(slotReplayRound(ORDER, { stops, free, meterFree, meterBefore })).toEqual(round);
    const climb = slotPlayRound(stacked(TWO_WINS), 0, drawing(same(1), bottom(TWO_WINS)).draw);
    expect(slotReplayRound(stacked(TWO_WINS), climb)).toEqual(climb);

    const extra: SlotStops = [20, 0, 4, 4, 4];
    for (const bad of [
      { stops, free: [...free, extra], meterFree, meterBefore },
      { stops, free: free.slice(0, -1), meterFree, meterBefore },
      { stops, free, meterFree: [...meterFree, extra], meterBefore },
      { stops, free, meterFree: meterFree.slice(0, -1), meterBefore },
      { stops, free, meterFree, meterBefore: 0 },
    ])
      expect(() => slotReplayRound(ORDER, bad)).toThrow(/stops/);
  });
});

it('reads and writes up to 50 free spins as text', () => {
  const two: SlotStops[] = [[3, 17, 0, 22, 9], [1, 2, 3, 4, 5]];
  expect(slotFreeText([])).toBe('');
  expect(slotFreeText(two)).toBe('3,17,0,22,9;1,2,3,4,5');
  expect(parseSlotFree('3,17,0,22,9;1,2,3,4,5')).toEqual(two);
  expect(parseSlotFree('')).toEqual([]);
  const fifty = Array.from({ length: 50 }, (_, i): SlotStops => [i % 32, 1, 2, 3, 31]);
  expect(parseSlotFree(slotFreeText(fifty))).toEqual(fifty);
  const text = slotFreeText(fifty);
  for (const bad of ['1,2,3', '1,2,3,4,32', '1,2,3,4,x', '1,2,3,4,5;', `${text};1,2,3,4,5`])
    expect(parseSlotFree(bad), bad).toBeNull();
});
