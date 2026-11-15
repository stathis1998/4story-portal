import { describe, expect, it } from 'vitest';
import type { SlotMachine, SlotStops } from './slots.js';
import { SLOT_LINES, parseSlotFree, slotFreeText, slotRoundPayout, slotSpin, slotWindow } from './slot-rules.js';

const TOP = 'GHGHG', BOTTOM = 'HGHGH'; // filler rows that can never start or continue a win here

/**
 * A machine whose window at stops [4k+1 x5] is windows[k] (three rows of five letters). pays[i] = [5, 20, 100]
 * times (i + 1); twoLucky = 2. Unused strip positions are 'G'.
 */
function showing(...windows: [string, string, string][]): SlotMachine {
  const reels = [0, 1, 2, 3, 4].map((r) =>
    windows.map((w) => `${w[0][r]}${w[1][r]}${w[2][r]}G`).join(''),
  ) as unknown as SlotMachine['reels'];
  return {
    key: 'shelf',
    name: 'Fixture',
    symbols: Array.from({ length: 10 }, (_, i) => ({ name: `S${i}`, sprite: i })),
    reels,
    pays: Array.from({ length: 8 }, (_, i) => [5 * (i + 1), 20 * (i + 1), 100 * (i + 1)] as const),
    twoLucky: 2,
    stakes: [20, 40, 60],
    counts: { linePaid: 0, blank: 0, scatters: [0, 0, 0], blankScatters: [0, 0, 0], best: 0 },
    rest: [0, 0, 0, 0, 0],
  };
}
const at = (k: number): SlotStops => [4 * k + 1, 4 * k + 1, 4 * k + 1, 4 * k + 1, 4 * k + 1];

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

describe('a spin', () => {
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
    const out = slotSpin(showing(rows as [string, string, string]), at(0));
    expect(out.lines).toEqual(lines);
    expect(out.multiple).toBe(lines.reduce((sum, l) => sum + l.multiple, 0));
  });

  it('pays two lucky symbols on every line through them', () => {
    // Lines 1, 16 and 17 all run through the middle of reels 1 and 2.
    const out = slotSpin(showing([TOP, 'AACDE', BOTTOM]), at(0));
    expect(out.lines.map((l) => [l.line, l.count, l.multiple])).toEqual([[0, 2, 2], [15, 2, 2], [16, 2, 2]]);
    expect(out.multiple).toBe(6);
  });

  it('counts a lucky symbol and a wild as two', () =>
    expect(slotSpin(showing([WILD_TOP, 'AICDE', WILD_BOTTOM]), at(0)).multiple).toBe(6));

  it('adds up two winning lines', () => {
    const out = slotSpin(showing(['CCCGH', 'BBBDE', 'HGHGH']), at(0));
    expect(out.lines).toEqual([
      { line: 0, symbol: 1, count: 3, multiple: 10 },
      { line: 1, symbol: 2, count: 3, multiple: 15 },
    ]);
    expect(out.multiple).toBe(25);
  });

  it.each([
    [['JHGHG', 'BCJDE', 'HGHGJ'], 3, 8],
    [[TOP, 'JJJJG', BOTTOM], 4, 12],
    [[TOP, 'JJJJJ', BOTTOM], 5, 20],
    [['GHCHG', 'JIJBB', 'HGDGH'], 2, 0], // a wild is not a scatter
  ])('scatters count anywhere in the window: %j', (rows, scatters, freeSpins) => {
    const out = slotSpin(showing(rows as [string, string, string]), at(0));
    expect([out.scatters, out.freeSpins, out.multiple]).toEqual([scatters, freeSpins, 0]);
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

it('pays a round: the paid spin once and each free spin doubled, at a twentieth of the stake', () => {
  const m = showing([TOP, 'BBBCD', BOTTOM], [TOP, 'BBBBD', BOTTOM], [TOP, 'CDEFG', BOTTOM]);
  expect(slotRoundPayout(m, { stops: at(0), free: [] }, 40)).toBe(20); // 10 x 2
  expect(slotRoundPayout(m, { stops: at(0), free: [at(1), at(2)] }, 40)).toBe(180); // (10 + 2 x 40) x 2
  expect(slotRoundPayout(m, { stops: at(2), free: [] }, 100_000)).toBe(0);
});

it('writes free spins as text and reads them back', () => {
  const two: SlotStops[] = [[3, 17, 0, 22, 9], [1, 2, 3, 4, 5]];
  expect(slotFreeText([])).toBe('');
  expect(slotFreeText(two)).toBe('3,17,0,22,9;1,2,3,4,5');
  expect(parseSlotFree('3,17,0,22,9;1,2,3,4,5')).toEqual(two);
  expect(parseSlotFree('')).toEqual([]);
  const twenty = Array.from({ length: 20 }, () => '1,2,3,4,5').join(';');
  expect(parseSlotFree(twenty)).toHaveLength(20);
  for (const bad of ['1,2,3', '1,2,3,4,32', '1,2,3,4,x', '1,2,3,4,5;', `${twenty};1,2,3,4,5`])
    expect(parseSlotFree(bad), bad).toBeNull();
});
