import { z } from 'zod';
import type { Wallet, WalletCharacter } from './games.js';
import { characterIdSchema } from './player-stats.js';

export const SLOT_MACHINE_KEYS = ['shelf', 'armoury', 'hoard'] as const;
export type SlotMachineKey = (typeof SLOT_MACHINE_KEYS)[number];
/** `plural` is how a win is read out: 'Three Experience Potions.' */
export type SlotSymbol = { name: string; plural: string; sprite: number };
export type SlotStops = [number, number, number];
export type SlotStakes = [number, number, number];
export type SlotMachine = {
  key: SlotMachineKey;
  name: string;
  /** Six, the lucky one first, the top prize last. A reel's letter A..F is an index into this. */
  symbols: readonly SlotSymbol[];
  /** Three loops of 32 letters, read downward: the stop is on the win line, the letter before it is above. */
  reels: readonly [string, string, string];
  /** The prize for three of each symbol, as a multiple of the stake, in symbol order. */
  pays: readonly number[];
  /** The prize for two lucky symbols from the left. */
  twoLucky: number;
  /** Starting stakes in Silver. */
  stakes: SlotStakes;
};

export const SLOT_REEL_STOPS = 32;
export const SLOT_MIN_STAKE = 1;
export const SLOT_MAX_STAKE = 100_000;
/** A spin that paid this many times its stake or more is a big win. */
export const SLOT_BIG_WIN = 50;

// The strips and prizes were found by search and counted over all 32768 results: the tests pin the counts.
export const SLOT_MACHINES: readonly SlotMachine[] = [
  {
    key: 'shelf',
    name: "Tranus's Shelf",
    symbols: [
      { name: 'Healing Potion', plural: 'Healing Potions', sprite: 8526 },
      { name: 'Apprentice Formula', plural: 'Apprentice Formulas', sprite: 9781 },
      { name: "Master's Formula", plural: "Master's Formulas", sprite: 9782 },
      { name: 'Serendipity', plural: 'Serendipity potions', sprite: 4177 },
      { name: 'Survival Tincture', plural: 'Survival Tinctures', sprite: 9007 },
      { name: 'Experience Potion', plural: 'Experience Potions', sprite: 8598 },
    ],
    reels: [
      'ABACEABADABAFABACABAEABADABACABA',
      'ABCAEADAFBACAEADABACABAFAEDACABA',
      'ABDABABCABAFBABAEABABABDACBABABA',
    ],
    pays: [5, 10, 15, 25, 50, 100],
    twoLucky: 2,
    stakes: [10, 25, 50],
  },
  {
    key: 'armoury',
    name: 'The Armoury',
    symbols: [
      { name: 'Dragon Iron Boots', plural: 'Dragon Iron Boots', sprite: 8091 },
      { name: 'Sword of Judgement', plural: 'Swords of Judgement', sprite: 8718 },
      { name: 'Diamond Axe', plural: 'Diamond Axes', sprite: 5240 },
      { name: 'Dragon Scale Shield', plural: 'Dragon Scale Shields', sprite: 4627 },
      { name: 'Dragon String Bow', plural: 'Dragon String Bows', sprite: 4706 },
      { name: 'Dragon Eye Wand', plural: 'Dragon Eye Wands', sprite: 4663 },
    ],
    reels: [
      'AEDBACAEADFABEACADEABADAECABADEA',
      'ACBEADAFCABEADACBAEDACBAFAEDACBA',
      'CBADEFCBADECBADCBAECBADFCBAEDCBA',
    ],
    pays: [5, 10, 20, 40, 100, 250],
    twoLucky: 2,
    stakes: [25, 50, 100],
  },
  {
    key: 'hoard',
    name: "Dragon's Hoard",
    symbols: [
      { name: 'Large Crystal', plural: 'Large Crystals', sprite: 9550 },
      { name: 'Saddle', plural: 'Saddles', sprite: 8869 },
      { name: 'Gold Coin', plural: 'Gold Coins', sprite: 10478 },
      { name: 'Jewel of Fire', plural: 'Jewels of Fire', sprite: 8529 },
      { name: "Kerges' Jewel", plural: "Kerges' Jewels", sprite: 5867 },
      { name: "Pokwood's Treasure", plural: "Pokwood's Treasures", sprite: 5864 },
    ],
    reels: [
      'EADCBAEDACBFAEDCABEDACBAEDACBEDA',
      'BACDFBAECBADBACBACDBAFEBACBADCBA',
      'BACABABABFABABEABADBABABACBABABA',
    ],
    pays: [10, 15, 30, 75, 200, 500],
    twoLucky: 3,
    stakes: [50, 100, 200],
  },
];

export function slotMachine(key: string): SlotMachine | undefined {
  return SLOT_MACHINES.find((m) => m.key === key);
}

const LETTERS = 'ABCDEF';
const symbolAt = (reel: string, stop: number): number =>
  LETTERS.indexOf(reel[((stop % SLOT_REEL_STOPS) + SLOT_REEL_STOPS) % SLOT_REEL_STOPS]);

/** The three symbols showing on each reel, top to bottom, as symbol indexes: [reel][row], row 1 is the win line. */
export function slotWindow(machine: SlotMachine, stops: SlotStops): number[][] {
  return machine.reels.map((reel, i) => [
    symbolAt(reel, stops[i] - 1),
    symbolAt(reel, stops[i]),
    symbolAt(reel, stops[i] + 1),
  ]);
}

export type SlotPrize = { multiple: number; count: 0 | 2 | 3; symbol: number | null };

/** Only the win line counts: three alike pay by symbol, two lucky symbols from the left pay a smaller prize. */
export function slotPrize(machine: SlotMachine, stops: SlotStops): SlotPrize {
  const [a, b, c] = machine.reels.map((reel, i) => symbolAt(reel, stops[i]));
  if (a === b && b === c) return { multiple: machine.pays[a], count: 3, symbol: a };
  if (a === 0 && b === 0) return { multiple: machine.twoLucky, count: 2, symbol: 0 };
  return { multiple: 0, count: 0, symbol: null };
}

/**
 * Where a machine rests before its first spin, so a resting machine never looks like a win: the line pays nothing,
 * its three symbols are all different and the left one is not the lucky symbol, and no row of the window is three
 * alike. Found from the strips, so it stays right if a strip changes: the first stops in the order [0, 0, 0],
 * [0, 0, 1] ... [31, 31, 31] (reel 1 counted slowest, reel 3 fastest) that keep all of that. If no stops keep it
 * all, the first stops that pay nothing and keep the most of the other rules, and if every result pays, the first
 * that keeps the most of them.
 */
export function slotRest(machine: SlotMachine): SlotStops {
  let best: SlotStops = [0, 0, 0];
  let bestScore = -1;
  for (let a = 0; a < SLOT_REEL_STOPS; a++)
    for (let b = 0; b < SLOT_REEL_STOPS; b++)
      for (let c = 0; c < SLOT_REEL_STOPS; c++) {
        const stops: SlotStops = [a, b, c];
        const window = slotWindow(machine, stops);
        const line = window.map((rows) => rows[1]);
        const others =
          Number(new Set(line).size === 3) +
          Number(line[0] !== 0) +
          Number([0, 1, 2].every((row) => new Set(window.map((rows) => rows[row])).size > 1));
        // Paying nothing outranks every other rule together.
        const score = (slotPrize(machine, stops).multiple === 0 ? 4 : 0) + others;
        if (score === 7) return stops;
        if (score > bestScore) {
          best = stops;
          bestScore = score;
        }
      }
  return best;
}

const NUMBER_WORDS = { 2: 'Two', 3: 'Three' } as const;

/** 'Three Experience Potions.', 'Two Healing Potions.' or 'No win this time.' */
export function slotLine(machine: SlotMachine, prize: SlotPrize): string {
  if (prize.count === 0 || prize.symbol === null) return 'No win this time.';
  return `${NUMBER_WORDS[prize.count]} ${machine.symbols[prize.symbol].plural}.`;
}

/** Every possible result counted: `paid` is the sum of prize multiples, `hits` the results that pay, `top` those that pay the top prize. */
export function slotOdds(machine: SlotMachine): { combos: number; paid: number; hits: number; top: number } {
  const topPrize = Math.max(...machine.pays);
  let paid = 0;
  let hits = 0;
  let top = 0;
  for (let a = 0; a < SLOT_REEL_STOPS; a++)
    for (let b = 0; b < SLOT_REEL_STOPS; b++)
      for (let c = 0; c < SLOT_REEL_STOPS; c++) {
        const { multiple } = slotPrize(machine, [a, b, c]);
        paid += multiple;
        if (multiple > 0) hits++;
        if (multiple === topPrize) top++;
      }
  return { combos: SLOT_REEL_STOPS ** 3, paid, hits, top };
}

/** The share of all stakes the machine pays back: paid / combos. */
export const slotReturn = (machine: SlotMachine): number => {
  const { paid, combos } = slotOdds(machine);
  return paid / combos;
};

/** The most one spin can win at these stakes, in Silver. */
export const slotLargestWin = (machine: SlotMachine, stakes: SlotStakes): number =>
  Math.max(...machine.pays, machine.twoLucky) * Math.max(...stakes);

/** The stakes when the text is three different whole stakes within the limits, lowest first; otherwise null. */
export function parseSlotStakes(text: string): SlotStakes | null {
  const parts = text.split(',').map((p) => p.trim());
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  const [a, b, c] = parts.map(Number);
  if (a < SLOT_MIN_STAKE || c > SLOT_MAX_STAKE || !(a < b && b < c)) return null;
  return [a, b, c];
}

export const slotSpinRequestSchema = z.object({
  characterId: characterIdSchema,
  machine: z.enum(SLOT_MACHINE_KEYS),
  stake: z.number().int().min(SLOT_MIN_STAKE).max(SLOT_MAX_STAKE),
});
export type SlotSpinRequest = z.output<typeof slotSpinRequestSchema>;

export const slotFloorSchema = z.object({ live: z.boolean() });

const stakeSchema = z.number().int().min(SLOT_MIN_STAKE).max(SLOT_MAX_STAKE);

export const slotMachineSettingsSchema = z.object({
  live: z.boolean(),
  stakes: z
    .tuple([stakeSchema, stakeSchema, stakeSchema])
    .refine(([a, b, c]) => a < b && b < c, { message: 'Enter three different stakes, lowest first' }),
});
export type SlotMachineSettingsInput = z.output<typeof slotMachineSettingsSchema>;

export type SlotMachineState = { key: SlotMachineKey; live: boolean; stakes: SlotStakes };
export type SlotSpinView = {
  id: number;
  /** ISO, the server's clock. */
  at: string;
  character: string;
  machine: SlotMachineKey;
  stops: SlotStops;
  /** Whole Silver. */
  stake: number;
  payout: number;
};
export type SlotsState = {
  live: boolean;
  machines: SlotMachineState[];
  characters: WalletCharacter[];
  /** The account's latest spins, newest first. */
  mine: SlotSpinView[];
  /** The latest big wins by anyone, newest first. */
  bigWins: SlotSpinView[];
};
export type SlotSpinResult = { spin: SlotSpinView; wallet: Wallet; state: SlotsState };
export type SlotTotals = { spins: number; staked: number; paid: number };
export type GmSlotMachine = SlotMachineState & { today: SlotTotals; allTime: SlotTotals };
export type GmSlots = { live: boolean; machines: GmSlotMachine[]; latest: SlotSpinView[] };
