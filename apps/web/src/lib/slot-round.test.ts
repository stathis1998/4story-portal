import { describe, expect, it } from 'vitest';
import { slotRoundPayout, slotSpin, type SlotSpinView } from '@4story-portal/shared';
import { BOTTOM, TOP, at, showing } from '../test/slot-fixture';
import { bigWinLine, roundLine, roundListLine, roundSpins, winTier, wonTiles } from './slot-round';

// Window 0 pays 10 line stakes, window 1 pays 40, window 2 pays nothing.
const machine = showing([TOP, 'BBBCD', BOTTOM], [TOP, 'BBBBD', BOTTOM], [TOP, 'CDEFG', BOTTOM]);
const view = (over: Partial<SlotSpinView>): SlotSpinView => ({
  id: 1, at: '2026-11-15T00:00:00Z', character: 'Tester', machine: 'shelf',
  stops: at(0), free: [], stake: 40, payout: 0, jackpot: 0, ...over,
});

describe('winTier', () => {
  it.each([[0, 40, 'none'], [39, 40, 'small'], [40, 40, 'win'], [399, 40, 'win'], [400, 40, 'big'], [1999, 40, 'big'], [2000, 40, 'huge']])(
    'winTier(%i, %i) is %s',
    (won, stake, tier) => expect(winTier(won, stake)).toBe(tier),
  );
});

describe('roundSpins', () => {
  const spin = { stops: at(0), free: [at(1), at(2)], stake: 40 };
  it('lists the paid spin and then each free spin with a doubled win and a running total', () => {
    const spins = roundSpins(machine, spin);
    expect(spins.map((s) => ({ free: s.free, won: s.won, total: s.total }))).toEqual([
      { free: null, won: 20, total: 20 },
      { free: 0, won: 160, total: 180 },
      { free: 1, won: 0, total: 180 },
    ]);
    expect(spins[1].stops).toEqual(at(1));
    expect(spins[1].outcome).toEqual(slotSpin(machine, at(1)));
  });
  it('the last total is what the API paid', () =>
    expect(roundSpins(machine, spin).at(-1)!.total).toBe(slotRoundPayout(machine, spin, 40)));
});

it('gives each winning tile once', () => {
  const m = showing([TOP, 'AACDE', BOTTOM]);
  expect(wonTiles(slotSpin(m, at(0)))).toEqual([[0, 1], [1, 1]]);
  expect(wonTiles(slotSpin(showing([TOP, 'CDEFG', BOTTOM]), at(0)))).toEqual([]);
});

describe('roundLine', () => {
  const lose = Array.from({ length: 8 }, () => at(2));
  const winFree = [at(1), at(2)];
  it.each([
    ['jackpot', view({ stops: at(2), jackpot: 31420, payout: 0, stake: 40 }),
      'Jackpot. This round made it drop. You won 31 Gold 420 Silver on a stake of 40 Silver.'],
    ['nothing', view({ stops: at(2) }), 'No win this time. You staked 40 Silver.'],
    ['nothing with free spins', view({ stops: at(2), free: lose }), '8 free spins won you nothing. You staked 40 Silver.'],
    ['paid, one line', view({ payout: 20 }), '1 line won. You won 20 Silver on a stake of 40 Silver.'],
    ['paid with free spins', view({ free: winFree, payout: 180 }),
      '2 free spins won you 160 Silver. You won 180 Silver in all on a stake of 40 Silver.'],
    ['paid with free spins that paid nothing', view({ free: lose, payout: 20 }),
      '8 free spins won you nothing. You won 20 Silver in all on a stake of 40 Silver.'],
  ])('says the round in words: %s', (_name, v, line) => {
    expect(roundLine(v, roundSpins(machine, v))).toBe(line);
  });

  it('counts lines in the plural', () => {
    const m = showing(['CCCGH', 'BBBDE', 'HGHGH']);
    const v = view({ payout: 50 });
    expect(roundLine(v, roundSpins(m, v))).toBe('2 lines won. You won 50 Silver on a stake of 40 Silver.');
  });
});

describe('roundListLine', () => {
  const named = { ...machine, name: "Tranus's Shelf" };
  it.each([
    ['nothing', view({}), "Tranus's Shelf: staked 40 Silver, won nothing"],
    ['an amount', view({ payout: 20 }), "Tranus's Shelf: staked 40 Silver, won 20 Silver"],
    ['the jackpot', view({ payout: 0, jackpot: 31420 }), "Tranus's Shelf: staked 40 Silver, won the jackpot, 31 Gold 420 Silver"],
    ['free spins', view({ payout: 1200, free: Array.from({ length: 8 }, () => at(1)) }),
      "Tranus's Shelf: staked 40 Silver, won 1 Gold 200 Silver with 8 free spins"],
  ])('says a list entry: %s', (_name, v, line) => expect(roundListLine(named, v)).toBe(line));
});

describe('bigWinLine', () => {
  const named = { ...machine, name: "Tranus's Shelf" };
  it.each([
    ['a win', view({ payout: 2400 }), "Tester won 2 Gold 400 Silver on Tranus's Shelf on a stake of 40 Silver"],
    ['a win with free spins', view({ payout: 12500, free: Array.from({ length: 12 }, () => at(1)) }),
      "Tester won 12 Gold 500 Silver on Tranus's Shelf on a stake of 40 Silver, with 12 free spins"],
    ['the jackpot', view({ payout: 0, jackpot: 31420 }), 'Tester won the jackpot, 31 Gold 420 Silver'],
    ['the jackpot after free spins', view({ payout: 0, jackpot: 31420, free: Array.from({ length: 8 }, () => at(2)) }),
      'Tester won the jackpot, 31 Gold 420 Silver'],
  ])('says a big win: %s', (_name, v, line) => expect(bigWinLine(named, v)).toBe(line));
});
