import { describe, expect, it } from 'vitest';
import { SLOT_LETTERS, SLOT_PAYING, SLOT_REEL_STOPS, SLOT_SCATTER, SLOT_WILD } from './slots.js';
import { slotSpin, slotWindow } from './slot-rules.js';
import { countSlotMachine } from './slot-count.js';
import { slotFreeRate, slotJackpotAdd, slotJackpotShare, slotLostRate, slotReturn } from './slot-figures.js';
import { SLOT_MACHINES, slotMachine } from './slot-machines.js';

const WILD = SLOT_LETTERS[SLOT_WILD];
const SCATTER = SLOT_LETTERS[SLOT_SCATTER];
const payRate = (key: string) => 1 - slotLostRate(slotMachine(key)!);

describe.each(SLOT_MACHINES)('$name', (machine) => {
  it('has ten symbols with different names, plurals and icons', () => {
    expect(machine.symbols).toHaveLength(10);
    for (const field of ['name', 'plural', 'sprite'] as const) {
      expect(new Set(machine.symbols.map((s) => s[field])).size).toBe(10);
    }
  });

  it('has five strips of 32 letters that follow the strip rules', () => {
    expect(machine.reels).toHaveLength(5);
    machine.reels.forEach((reel, r) => {
      expect(reel).toMatch(/^[A-J]{32}$/);
      // Every paying symbol on every reel.
      for (const letter of SLOT_LETTERS.slice(0, SLOT_PAYING)) expect(reel).toContain(letter);
      // The wild only on reels 2, 3 and 4, and on each of them.
      if (r === 0 || r === 4) expect(reel).not.toContain(WILD);
      else expect(reel).toContain(WILD);
      // A scatter on every reel, and two on one reel at least 3 stops apart round the loop.
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
    expect(machine.pays).toHaveLength(SLOT_PAYING);
    machine.pays.forEach((pay, s) => {
      expect(pay.every((n) => Number.isInteger(n))).toBe(true);
      expect(pay[0]).toBeLessThan(pay[1]);
      expect(pay[1]).toBeLessThan(pay[2]);
      if (s > 0) for (let c = 0; c < 3; c++) expect(machine.pays[s - 1][c]).toBeLessThan(pay[c]);
    });
    expect(Number.isInteger(machine.twoLucky)).toBe(true);
    expect(machine.twoLucky).toBeGreaterThanOrEqual(1);
    expect(machine.twoLucky).toBeLessThan(machine.pays[0][0]);
  });

  it('stores the counts its strips really give', () => expect(countSlotMachine(machine)).toEqual(machine.counts), 120_000);

  it('returns between 95% and 96.5%', () => {
    expect(slotReturn(machine)).toBeGreaterThanOrEqual(0.95);
    expect(slotReturn(machine)).toBeLessThanOrEqual(0.965);
  });

  it('never pays back more than is staked, the jackpot counted', () => {
    const back = slotReturn(machine);
    const lost = slotLostRate(machine);
    const { num, den } = slotJackpotShare(machine);
    expect(back + (lost * num) / den).toBeLessThanOrEqual(1);
    expect(back + (lost * num) / den).toBeGreaterThan(1 - 3e-9);
    // What a lost round adds, in Bronze, is never more than the share of the stake the machine keeps.
    for (const stake of [...machine.stakes, 100_000]) {
      expect(slotJackpotAdd(machine, stake)).toBeLessThanOrEqual((stake * 1000 * (1 - back)) / lost);
    }
  });

  it('rests on a window that looks like nothing', () => {
    expect(machine.rest.every((n) => Number.isInteger(n) && n >= 0 && n < SLOT_REEL_STOPS)).toBe(true);
    const outcome = slotSpin(machine, machine.rest);
    expect(outcome.lines).toEqual([]);
    expect(outcome.scatters).toBe(0);
    const window = slotWindow(machine, machine.rest);
    expect(window.flat()).not.toContain(SLOT_WILD);
    expect(new Set(window.map((reel) => reel[1])).size).toBe(5);
  });
});

it.each([
  ['shelf', 0.28, 0.4, 65, 100, 4_000],
  ['armoury', 0.21, 0.29, 95, 150, 10_000],
  ['hoard', 0.17, 0.23, 130, 200, 20_000],
] as const)('%s pays and gives free spins as often as planned', (key, payLow, payHigh, freeLow, freeHigh, best) => {
  const machine = slotMachine(key)!;
  expect(payRate(key)).toBeGreaterThanOrEqual(payLow);
  expect(payRate(key)).toBeLessThanOrEqual(payHigh);
  expect(1 / slotFreeRate(machine)).toBeGreaterThanOrEqual(freeLow);
  expect(1 / slotFreeRate(machine)).toBeLessThanOrEqual(freeHigh);
  expect(machine.counts.best).toBeGreaterThanOrEqual(best);
});

it('the Shelf pays most often and the Hoard least', () => {
  expect(payRate('shelf')).toBeGreaterThan(payRate('armoury'));
  expect(payRate('armoury')).toBeGreaterThan(payRate('hoard'));
});

it('keeps the starting stakes', () =>
  expect(SLOT_MACHINES.map((m) => [m.key, m.name, m.stakes])).toEqual([
    ['shelf', "Tranus's Shelf", [20, 40, 60]],
    ['armoury', 'The Armoury', [40, 60, 100]],
    ['hoard', "Dragon's Hoard", [60, 100, 200]],
  ]));
