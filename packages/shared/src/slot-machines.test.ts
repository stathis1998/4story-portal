import { describe, expect, it } from 'vitest';
import {
  SLOT_LETTERS,
  SLOT_PAYING,
  SLOT_POTS,
  SLOT_REEL_STOPS,
  SLOT_SCATTER,
  SLOT_TOTAL_RETURN,
  SLOT_WILD,
  type SlotMachine,
} from './slots.js';
import { slotChain, slotPaidChainPay, slotWindow } from './slot-rules.js';
import { countSlotMachine } from './slot-count.js';
import {
  slotFreeRate,
  slotJackpotAdds,
  slotJackpotShare,
  slotLostRate,
  slotMeterRate,
  slotPaysRate,
  slotReturn,
} from './slot-figures.js';
import { SLOT_MACHINES, slotMachine } from './slot-machines.js';

const WILD = SLOT_LETTERS[SLOT_WILD];
const SCATTER = SLOT_LETTERS[SLOT_SCATTER];
const machine = (key: string): SlotMachine => slotMachine(key)!;

// The symbols the five-reel machines had: names, sprites and indexes stay exactly as they were.
const SYMBOLS: Record<string, [string, number][]> = {
  shelf: [
    ['Healing Potion', 8526],
    ['Apprentice Formula', 9781],
    ["Master's Formula", 9782],
    ['Serendipity', 4177],
    ['Survival Tincture', 9007],
    ['Experience Potion', 8598],
    ['Four-Leaf Clover Potion', 9010],
    ['Elixir of Wealth', 9055],
    ['Blessed Book of Wisdom', 9080],
    ["Leya's Star", 8850],
  ],
  armoury: [
    ['Dragon Iron Boots', 8091],
    ['Sword of Judgement', 8718],
    ['Diamond Axe', 5240],
    ['Dragon Scale Shield', 4627],
    ['Dragon String Bow', 4706],
    ['Dragon Eye Wand', 4663],
    ['Diamond Claw Dagger', 4520],
    ['Gold Iron Battle Armour', 8102],
    ["Legionnaire's Medal", 5906],
    ['Comet', 8685],
  ],
  hoard: [
    ['Large Crystal', 9550],
    ['Saddle', 8869],
    ['Gold Coin', 10478],
    ['Jewel of Fire', 8529],
    ["Kerges' Jewel", 5867],
    ["Pokwood's Treasure", 5864],
    ['Raw Diamond', 5891],
    ['Osiris Gemstone', 8669],
    ['Golden Key', 8531],
    ['Star Jewellery', 9181],
  ],
};

describe.each(SLOT_MACHINES)('$name', (m) => {
  it('keeps its ten symbols, all different, at the same indexes', () => {
    expect(m.symbols.map((s) => [s.name, s.sprite])).toEqual(SYMBOLS[m.key]);
    for (const field of ['name', 'sprite'] as const) {
      expect(new Set(m.symbols.map((s) => s[field])).size).toBe(10);
    }
  });

  it('has five strips of 32 letters that follow the strip rules', () => {
    expect(m.reels).toHaveLength(5);
    m.reels.forEach((reel, r) => {
      expect(reel).toMatch(/^[A-J]{32}$/);
      // Every paying symbol on every reel.
      for (const letter of SLOT_LETTERS.slice(0, SLOT_PAYING)) expect(reel).toContain(letter);
      // The wild only on reels 2, 3 and 4, and on each of them.
      if (r === 0 || r === 4) expect(reel).not.toContain(WILD);
      else expect(reel).toContain(WILD);
      // A scatter on every reel; two on one reel at least 3 stops apart round the loop, so step 1 never shows two.
      const at = [...reel].flatMap((letter, i) => (letter === SCATTER ? [i] : []));
      expect(at.length).toBeGreaterThan(0);
      for (const i of at) {
        for (const j of at) {
          if (i === j) continue;
          const apart = Math.abs(i - j);
          expect(Math.min(apart, SLOT_REEL_STOPS - apart)).toBeGreaterThanOrEqual(3);
        }
      }
    });
  });

  it('has prizes that rise', () => {
    expect(m.pays).toHaveLength(SLOT_PAYING);
    m.pays.forEach((pay, s) => {
      expect(pay).toHaveLength(3);
      expect(pay.every((n) => Number.isInteger(n) && n >= 1)).toBe(true);
      expect(pay[0]).toBeLessThan(pay[1]);
      expect(pay[1]).toBeLessThan(pay[2]);
      if (s > 0) for (let c = 0; c < 3; c++) expect(m.pays[s - 1][c]).toBeLessThan(pay[c]);
    });
    expect(Number.isInteger(m.twoLucky)).toBe(true);
    expect(m.twoLucky).toBeGreaterThanOrEqual(1);
    expect(m.twoLucky).toBeLessThan(m.pays[0][0]);
  });

  it('pays back between 100% and 102% from the reels, free spins and meter', () => {
    expect(slotReturn(m)).toBeGreaterThanOrEqual(1);
    expect(slotReturn(m)).toBeLessThanOrEqual(1.02);
  });

  it('pays back 105% with the jackpots, never more', () => {
    const back = slotReturn(m);
    const lost = slotLostRate(m);
    const { num, den } = slotJackpotShare(m);
    expect(back + (lost * num) / den).toBeLessThanOrEqual(SLOT_TOTAL_RETURN);
    expect(back + (lost * num) / den).toBeGreaterThan(SLOT_TOTAL_RETURN - 3e-9);
    // What a lost round adds to the three pots, in Bronze, is never more than the share of the stake left for them.
    for (const stake of [...m.stakes, 5_000]) {
      const adds = slotJackpotAdds(m, stake);
      const sum = SLOT_POTS.reduce((total, pot) => total + adds[pot], 0);
      expect(sum).toBeLessThanOrEqual((stake * 1000 * (SLOT_TOTAL_RETURN - back)) / lost);
    }
  });

  it('never reaches the 12-step cap', () => {
    expect(m.counts.capped).toBe(0);
  });

  it('rests on a window that looks like nothing', () => {
    expect(m.rest.every((n) => Number.isInteger(n) && n >= 0 && n < SLOT_REEL_STOPS)).toBe(true);
    const chain = slotChain(m, m.rest);
    expect(chain.steps).toHaveLength(1);
    expect(chain.steps[0].lines).toEqual([]);
    expect(slotPaidChainPay(chain)).toBe(0);
    const window = slotWindow(m, m.rest);
    expect(window.flat()).not.toContain(SLOT_SCATTER);
    expect(window.flat()).not.toContain(SLOT_WILD);
    expect(new Set(window.map((reel) => reel[1])).size).toBe(5);
  });
});

describe('the counts', () => {
  it.each(SLOT_MACHINES)('$name stores the counts its strips really give', (m) => {
    expect(countSlotMachine(m)).toEqual(m.counts);
  }, 300_000);
});

it.each([
  // key, pays low, pays high, free spins once in (low, high), meter fills once every (low, high), meter size (low, high)
  ['shelf', 0.5, 0.62, 65, 100, 45, 80, 30, 30],
  ['armoury', 0.44, 0.56, 90, 140, 60, 110, 30, 60],
  ['hoard', 0.36, 0.48, 110, 180, 80, 140, 30, 60],
] as const)(
  '%s pays, gives free spins and fills its meter as often as planned',
  (key, payLow, payHigh, freeLow, freeHigh, meterLow, meterHigh, sizeLow, sizeHigh) => {
    const m = machine(key);
    expect(slotPaysRate(m)).toBeGreaterThanOrEqual(payLow);
    expect(slotPaysRate(m)).toBeLessThanOrEqual(payHigh);
    expect(1 / slotFreeRate(m)).toBeGreaterThanOrEqual(freeLow);
    expect(1 / slotFreeRate(m)).toBeLessThanOrEqual(freeHigh);
    expect(1 / slotMeterRate(m)).toBeGreaterThanOrEqual(meterLow);
    expect(1 / slotMeterRate(m)).toBeLessThanOrEqual(meterHigh);
    expect(Number.isInteger(m.meterSize)).toBe(true);
    expect(m.meterSize).toBeGreaterThanOrEqual(sizeLow);
    expect(m.meterSize).toBeLessThanOrEqual(sizeHigh);
  },
);

it('the Shelf pays most often and the Hoard least', () => {
  expect(slotPaysRate(machine('shelf'))).toBeGreaterThan(slotPaysRate(machine('armoury')));
  expect(slotPaysRate(machine('armoury'))).toBeGreaterThan(slotPaysRate(machine('hoard')));
});

it("the Hoard's biggest win is the biggest", () => {
  expect(machine('hoard').counts.best).toBeGreaterThan(machine('shelf').counts.best);
  expect(machine('hoard').counts.best).toBeGreaterThan(machine('armoury').counts.best);
});

it('keeps the starting stakes', () =>
  expect(SLOT_MACHINES.map((m) => [m.key, m.name, m.stakes])).toEqual([
    ['shelf', "Tranus's Shelf", [20, 40, 60]],
    ['armoury', 'The Armoury', [40, 60, 100]],
    ['hoard', "Dragon's Hoard", [60, 100, 200]],
  ]));
