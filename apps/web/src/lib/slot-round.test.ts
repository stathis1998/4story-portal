import { describe, expect, it } from 'vitest';
import { slotChain, slotReplayRound, type SlotMachine, type SlotSpinView } from '@4story-portal/shared';
import { BOTTOM, TOP, at, bottom, same, showing, stacked } from '../test/slot-fixture';
import { bigWinLine, roundLine, roundListLine, roundSpins, winTier, wonTiles } from './slot-round';

// The middle line wins 10 line stakes, then the letters above make the top line win 10 again, then nothing.
// Its rows 0-2 (stop 1) show 3 scatters and win nothing.
const TWO_WINS = ['CEJHG', 'DFHJH', 'CEGHJ', 'DFEGH', 'BBBGH', 'CEGHG', 'BBBCD', 'DFHGH'];
const chain = stacked(TWO_WINS);
const CHAIN = bottom(TWO_WINS);
const SCATTERS = same(1);
// One winning line, then nothing.
const ONE_WIN = ['DFEGH', 'CEGHG', 'BBBCD', 'DFHGH'];
const oneWin = stacked(ONE_WIN);

// Window at stop 1 shows 2 scatters and wins nothing; the window at stop 5 wins 10 once and nothing falls into a win.
const METER = ['GHGHJ', 'CDEFG', 'JGHGH', 'DFEDG', 'CDEFG', 'BBBCD', 'DFHGH'];
// Rows 2 and 3 show B B B and C C C at stop 3, so two lines win on one step; nothing falls into a win.
const TWO_LINES = ['DFEDG', 'EDFFH', 'BBBGH', 'CCCDE', 'HGHGH'];

const view = (over: Partial<SlotSpinView>): SlotSpinView => ({
  id: 1, at: '2026-11-15T00:00:00Z', character: 'Tester', machine: 'shelf',
  stops: at(0), free: [], meterFree: [], meterBefore: 0, stake: 40, payout: 0, jackpot: 0,
  pots: { mini: 0, major: 0, giga: 0 }, ...over,
});
const times = (steps: { times: number }[]) => steps.map((s) => s.times);
/** What the rules say the round pays, in Silver. */
const paid = (m: SlotMachine, v: SlotSpinView) => (slotReplayRound(m, v).lineStakes * v.stake) / 20;

describe('winTier', () => {
  it.each([[0, 40, 'none'], [39, 40, 'small'], [40, 40, 'win'], [399, 40, 'win'], [400, 40, 'big'], [1999, 40, 'big'], [2000, 40, 'huge']])(
    'winTier(%i, %i) is %s',
    (won, stake, tier) => expect(winTier(won, stake)).toBe(tier),
  );
});

describe('roundSpins', () => {
  it('shows a paid chain at times 1, 2, 3 with what each step won and the running total', () => {
    const v = view({ stops: CHAIN, stake: 40 });
    const [spin, ...rest] = roundSpins(chain, v);
    expect(rest).toEqual([]);
    expect(spin.kind).toEqual({ paid: true });
    expect(spin.steps.map((s) => ({ times: s.times, won: s.won, total: s.total }))).toEqual([
      { times: 1, won: 20, total: 20 },
      { times: 2, won: 40, total: 60 },
      { times: 3, won: 0, total: 60 },
    ]);
    expect(spin.steps.map((s) => s.grid)).toEqual(slotChain(chain, CHAIN).steps.map((s) => s.grid));
    expect(spin).toMatchObject({ won: 60, total: 60, scatters: 0, added: 0, stops: CHAIN });
    expect(spin.total).toBe(paid(chain, v));
  });

  it('caps the paid multiplier at 5', () => {
    // Every tile is B: 12 winning steps.
    const m = stacked(['BBBBB', 'BBBBB', 'BBBBB', 'BBBBB']);
    const [spin] = roundSpins(m, view({ stops: same(1), stake: 20 }));
    expect(times(spin.steps)).toEqual([1, 2, 3, 4, 5, 5, 5, 5, 5, 5, 5, 5]);
  });

  it('plays free spins at a multiplier that starts at 2, climbs after each win and carries across spins', () => {
    const v = view({ stops: SCATTERS, free: Array.from({ length: 8 }, () => CHAIN), stake: 20 });
    const spins = roundSpins(chain, v);
    expect(spins).toHaveLength(9);
    expect(spins[0]).toMatchObject({ kind: { paid: true }, added: 8, scatters: 3, won: 0, total: 0 });
    expect(spins.slice(1).map((s) => s.kind)).toEqual(Array.from({ length: 8 }, (_, free) => ({ free })));
    // A winning step pays at the multiplier and raises it; the last step of a chain wins nothing and shows the new one.
    expect(times(spins[1].steps)).toEqual([2, 3, 4]);
    expect(times(spins[2].steps)).toEqual([4, 5, 6]);
    expect(times(spins[4].steps)).toEqual([8, 9, 10]);
    expect(times(spins[5].steps)).toEqual([10, 10, 10]);
    expect(spins[1]).toMatchObject({ won: 50, total: 50, added: 0 });
    expect(spins[1].steps.map((s) => s.won)).toEqual([20, 30, 0]);
    expect(spins[8].total).toBe(10 * (2 + 3 + 4 + 5 + 6 + 7 + 8 + 9 + 8 * 10));
    expect(spins.at(-1)!.total).toBe(paid(chain, v));
  });

  it('adds 5 spins for a retrigger and only what fits under 50', () => {
    const v = view({ stops: SCATTERS, free: Array.from({ length: 50 }, () => SCATTERS), stake: 20 });
    const spins = roundSpins(chain, v);
    expect(spins).toHaveLength(51);
    expect(spins[0].added).toBe(8);
    expect(spins.slice(1).map((s) => s.added)).toEqual([...Array(8).fill(5), 2, ...Array(41).fill(0)]);
    expect(spins.at(-1)!.total).toBe(paid(chain, v));
  });

  it('plays meter free spins after the paid spin, from times 2', () => {
    // Two scatters on the paid spin, then a window that pays 10.
    const m = stacked(METER, 3);
    const v = view({ stops: same(1), meterFree: Array.from({ length: 8 }, () => same(5)), meterBefore: 2, stake: 20 });
    const spins = roundSpins(m, v);
    expect(spins).toHaveLength(9);
    expect(spins[0]).toMatchObject({ kind: { paid: true }, scatters: 2, added: 0, won: 0 });
    expect(spins.slice(1).map((s) => s.kind)).toEqual(Array.from({ length: 8 }, (_, meter) => ({ meter })));
    expect(spins[1].steps[0]).toMatchObject({ times: 2, won: 20 });
    expect(spins[8].steps[0].times).toBe(9);
    expect(spins.map((s) => s.added)).toEqual(Array(9).fill(0));
    expect(spins.at(-1)!.total).toBe(10 * (2 + 3 + 4 + 5 + 6 + 7 + 8 + 9));
    expect(spins.at(-1)!.total).toBe(paid(m, v));
  });

  it('keeps the winning tiles of a step as its burst', () => {
    const step = roundSpins(oneWin, view({ stops: bottom(ONE_WIN) }))[0].steps[0];
    expect(wonTiles(step)).toEqual([[0, 1], [1, 1], [2, 1]]);
    expect(wonTiles(step)).toBe(step.burst);
  });
});

describe('roundLine', () => {
  const pots = { mini: 0, major: 0, giga: 0 };
  const eight = Array.from({ length: 8 }, () => CHAIN);
  const quiet = {
    ...showing(['GHGHJ', 'CDEFG', 'JGHGH'], [TOP, 'BBBCD', BOTTOM], [TOP, 'CDEFG', BOTTOM]),
    meterSize: 3,
  };
  // Two lines on one step: the top and the middle row both show B B B.
  const twoLines = stacked(TWO_LINES);

  it.each<[string, SlotMachine, Partial<SlotSpinView>, string]>([
    ['one pot', chain, { stops: same(2), jackpot: 5000, pots: { ...pots, major: 5000 } },
      'Major jackpot. You won 5 Gold on a stake of 40 Silver.'],
    ['two pots', chain, { stops: same(2), jackpot: 2100, pots: { mini: 100, major: 0, giga: 2000 } },
      'Mini and Giga jackpots. You won 2 Gold 100 Silver on a stake of 40 Silver.'],
    ['all pots', chain, { stops: same(2), jackpot: 3, pots: { mini: 1, major: 1, giga: 1 } },
      'Mini, Major and Giga jackpots. You won 3 Silver on a stake of 40 Silver.'],
    ['nothing', chain, { stops: same(2) }, 'No win this time. You staked 40 Silver.'],
    ['nothing after free spins', chain, { stops: SCATTERS, free: eight, stake: 20 }, 'No win this time. You staked 20 Silver.'],
    ['free spins', chain, { stops: SCATTERS, free: eight, stake: 20, payout: 1240 },
      '8 free spins won you 1 Gold 240 Silver. You won 1 Gold 240 Silver in all on a stake of 20 Silver.'],
    ['free spins that paid nothing', quiet, { stops: at(0), meterFree: Array.from({ length: 8 }, () => at(2)), meterBefore: 2, payout: 20 },
      '8 free spins won you nothing. You won 20 Silver in all on a stake of 40 Silver.'],
    ['a chain', chain, { stops: CHAIN, stake: 20, payout: 30 }, 'A chain of 2. You won 30 Silver on a stake of 20 Silver.'],
    ['one line', oneWin, { stops: bottom(ONE_WIN), stake: 20, payout: 10 }, '1 line won. You won 10 Silver on a stake of 20 Silver.'],
    ['two lines', twoLines, { stops: same(3), stake: 20, payout: 25 }, '2 lines won. You won 25 Silver on a stake of 20 Silver.'],
  ])('says the round in words: %s', (_name, m, over, text) => {
    const v = view(over);
    expect(roundLine(v, roundSpins(m, v))).toBe(text);
  });
});

describe('roundListLine', () => {
  const named = { ...chain, name: "Tranus's Shelf" };
  const eight = Array.from({ length: 8 }, () => CHAIN);
  it.each([
    ['nothing', view({}), "Tranus's Shelf: staked 40 Silver, won nothing"],
    ['an amount', view({ payout: 20 }), "Tranus's Shelf: staked 40 Silver, won 20 Silver"],
    ['the jackpot', view({ jackpot: 31420, pots: { mini: 0, major: 0, giga: 31420 } }),
      "Tranus's Shelf: staked 40 Silver, won the jackpot, 31 Gold 420 Silver"],
    ['free spins', view({ payout: 1200, free: eight }), "Tranus's Shelf: staked 40 Silver, won 1 Gold 200 Silver with 8 free spins"],
    ['meter free spins', view({ payout: 1200, meterFree: eight }), "Tranus's Shelf: staked 40 Silver, won 1 Gold 200 Silver with 8 free spins"],
  ])('says a list entry: %s', (_name, v, text) => expect(roundListLine(named, v)).toBe(text));
});

describe('bigWinLine', () => {
  const named = { ...chain, name: "Tranus's Shelf" };
  const twelve = Array.from({ length: 12 }, () => CHAIN);
  it.each([
    ['a win', view({ payout: 2400 }), "Tester won 2 Gold 400 Silver on Tranus's Shelf on a stake of 40 Silver"],
    ['a win with free spins', view({ payout: 12500, free: twelve }),
      "Tester won 12 Gold 500 Silver on Tranus's Shelf on a stake of 40 Silver, with 12 free spins"],
    ['a win with meter free spins', view({ payout: 12500, meterFree: twelve.slice(0, 8) }),
      "Tester won 12 Gold 500 Silver on Tranus's Shelf on a stake of 40 Silver, with 8 free spins"],
    ['three pots', view({ jackpot: 3, pots: { mini: 1, major: 1, giga: 1 } }), 'Tester won the Mini, Major and Giga jackpots, 3 Silver'],
    ['a pot', view({ jackpot: 31420, pots: { mini: 0, major: 0, giga: 31420 } }), 'Tester won the Giga jackpot, 31 Gold 420 Silver'],
    ['two pots', view({ jackpot: 2100, pots: { mini: 100, major: 0, giga: 2000 } }), 'Tester won the Mini and Giga jackpots, 2 Gold 100 Silver'],
  ])('says a big win: %s', (_name, v, text) => expect(bigWinLine(named, v)).toBe(text));
});
