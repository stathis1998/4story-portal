import { z } from 'zod';
import type { Wallet, WalletCharacter } from './games.js';
import { characterIdSchema } from './player-stats.js';

export const SLOT_MACHINE_KEYS = ['shelf', 'armoury', 'hoard'] as const;
export type SlotMachineKey = (typeof SLOT_MACHINE_KEYS)[number];
export type SlotSymbol = { name: string; sprite: number };
export type SlotStakes = [number, number, number];

export const SLOT_REELS = 5;
export const SLOT_ROWS = 3;
export const SLOT_REEL_STOPS = 32;
export const SLOT_LINE_COUNT = 20;
export const SLOT_STAKE_STEP = 20;
export const SLOT_MIN_STAKE = 20;
export const SLOT_MAX_STAKE = 5_000;
/** A spin that paid this many times its stake or more is a big win. */
export const SLOT_BIG_WIN = 50;
/** Symbol indexes: 0..7 pay (0 is the lucky one, 7 the top prize), 8 is the wild, 9 the scatter. Reel letters A..J. */
export const SLOT_PAYING = 8;
export const SLOT_WILD = 8;
export const SLOT_SCATTER = 9;
export const SLOT_LETTERS = 'ABCDEFGHIJ';
/** Free spins for 3, 4 and 5 scatters showing in a paid spin's last window; 5 or more read as 5. */
export const SLOT_FREE_SPINS: Readonly<Record<number, number>> = { 3: 8, 4: 12, 5: 20 };
/** A cascade chain never has more steps than this. */
export const SLOT_CHAIN_MAX = 12;
/** A paid spin's step j pays times min(j, this). */
export const SLOT_STEP_MULTIPLIER_MAX = 5;
/** The free round's first multiplier. */
export const SLOT_FREE_START = 2;
export const SLOT_FREE_MULTIPLIER_MAX = 10;
/** Free spins a retrigger adds, while they fit under SLOT_FREE_MAX. */
export const SLOT_RETRIGGER = 5;
/** The most free spins one free round plays. */
export const SLOT_FREE_MAX = 50;
/** Free spins a full meter pays. */
export const SLOT_METER_FREE = 8;
/** What the reels, free spins, meter and jackpots pay back together over time. */
export const SLOT_TOTAL_RETURN = 1.05;
/** The rules number of a cascade round's row. */
export const SLOT_RULES_CASCADE = 3;
/** Rounds per account per database day, all machines together. */
export const SLOT_DAILY_DEFAULT = 1_500;
export const SLOT_DAILY_MIN = 100;
export const SLOT_DAILY_MAX = 10_000;
export type SlotStops = [number, number, number, number, number];
/** All windows of the machine, each played through its chain, counted (see slot-count.ts). */
export type SlotCounts = {
  /** Windows by scatters in the chain's last window: 0, 1, 2, 3, 4, 5 or more. */
  last: [number, number, number, number, number, number];
  /** Of those, the windows whose chain pays nothing. */
  blankLast: [number, number, number, number, number, number];
  /** Windows by winning steps W (0..12) and whether the last window shows 3+ scatters (r 0/1): index W * 2 + r. */
  free: number[];
  /** Line stakes of step j (0..11) summed over windows with W winning steps and retrigger r: index (W * 2 + r) * 12 + j. */
  steps: number[];
  /** The most one paid spin's chain pays, line stakes. */
  best: number;
  /** The longest chain met, and how many windows reached SLOT_CHAIN_MAX. */
  longest: number;
  capped: number;
};
export type SlotMachine = {
  key: SlotMachineKey;
  name: string;
  /** Ten, in the index order above. */
  symbols: readonly SlotSymbol[];
  /** Five loops of 32 letters, read downward. */
  reels: readonly [string, string, string, string, string];
  /** For each of the 8 paying symbols: the prize for 3, 4 and 5 alike, in line stakes. */
  pays: readonly (readonly [number, number, number])[];
  /** Two lucky symbols from the left, in line stakes. */
  twoLucky: number;
  stakes: SlotStakes;
  /** Points that fill this machine's meter. */
  meterSize: number;
  counts: SlotCounts;
  /** Where the machine rests before its first spin. */
  rest: SlotStops;
};

/** The three jackpots, smallest first. */
export const SLOT_POTS = ['mini', 'major', 'giga'] as const;
export type SlotPot = (typeof SLOT_POTS)[number];
/** Each pot's row in the pot table. The Giga is row 1, the pot that came before the three. */
export const SLOT_POT_ROW: Record<SlotPot, number> = { giga: 1, mini: 2, major: 3 };
/** Each pot's share of the jackpot money, per cent. */
export const SLOT_POT_SHARE: Record<SlotPot, number> = { mini: 30, major: 30, giga: 40 };
export const SLOT_POT_DEFAULT_CAP: Record<SlotPot, number> = { mini: 1, major: 10, giga: 50 }; // whole Gold
export const SLOT_JACKPOT_MIN_CAP = 1;
export const SLOT_JACKPOT_MAX_CAP = 10_000;
/** The jackpot's random draw is a whole number from 0 up to (not including) this. */
export const SLOT_JACKPOT_ROLLS = 1_000_000_000;
export const BRONZE_PER_SILVER = 1000;
export const BRONZE_PER_GOLD = 1_000_000;


/**
 * Whether the lost round that adds `add` to a pot of `pot` under `cap` makes it drop. All three in Bronze;
 * `roll` is a whole number from 0 up to SLOT_JACKPOT_ROLLS. The database step does the same sum.
 */
export function slotJackpotDrops(pot: number, add: number, cap: number, roll: number): boolean {
  // BigInt so a 10,000 Gold cap times the roll range cannot overflow.
  const p = BigInt(pot);
  const c = BigInt(cap);
  const floor = c / 10n;
  const from = p > floor ? p : floor;
  const to = p + BigInt(add) > floor ? p + BigInt(add) : floor;
  if (from >= c) return true;
  return BigInt(roll) * (c - from) < (to - from) * BigInt(SLOT_JACKPOT_ROLLS);
}

const potSettings = z.object({
  live: z.boolean(),
  cap: z.number().int().min(SLOT_JACKPOT_MIN_CAP).max(SLOT_JACKPOT_MAX_CAP),
});

/** Caps in whole Gold. */
export const slotPotsSettingsSchema = z
  .object({ mini: potSettings, major: potSettings, giga: potSettings })
  .refine((pots) => pots.mini.cap < pots.major.cap && pots.major.cap < pots.giga.cap, {
    message: 'The caps must rise: Mini below Major below Giga',
  });
export type SlotPotsSettingsInput = Record<SlotPot, { live: boolean; cap: number }>;

export const slotDailySchema = z.object({ rounds: z.number().int().min(SLOT_DAILY_MIN).max(SLOT_DAILY_MAX) });

/** What players see of one pot. All money whole Silver, rounded down. */
export type SlotJackpotView = {
  pot: SlotPot;
  live: boolean;
  amount: number;
  /** The cap this pot runs under; the cap set now while the pot has none. */
  cap: number;
  /** A tenth of the cap. */
  floor: number;
  last: { character: string; amount: number; at: string } | null;
};
/** One account's meter on one machine at one stake (whole Silver). */
export type SlotMeterView = { machine: SlotMachineKey; stake: number; points: number };

/** The stakes when the text is three different multiples of 20 within the limits, lowest first; otherwise null. */
export function parseSlotStakes(text: string): SlotStakes | null {
  const parts = text.split(',').map((p) => p.trim());
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  const [a, b, c] = parts.map(Number);
  if (a < SLOT_MIN_STAKE || c > SLOT_MAX_STAKE || !(a < b && b < c)) return null;
  if ([a, b, c].some((n) => n % SLOT_STAKE_STEP !== 0)) return null;
  return [a, b, c];
}

export const slotSpinRequestSchema = z.object({
  characterId: characterIdSchema,
  machine: z.enum(SLOT_MACHINE_KEYS),
  stake: z.number().int().min(SLOT_MIN_STAKE).max(SLOT_MAX_STAKE).multipleOf(SLOT_STAKE_STEP),
});
export type SlotSpinRequest = z.output<typeof slotSpinRequestSchema>;

export const slotFloorSchema = z.object({ live: z.boolean() });

const settingsStake = z.number().int();

export const slotMachineSettingsSchema = z.object({
  live: z.boolean(),
  // One message for every way three stakes can be wrong, so the GM page can show it as it stands.
  stakes: z
    .tuple([settingsStake, settingsStake, settingsStake])
    .refine(
      (stakes) =>
        stakes.every((n) => n >= SLOT_MIN_STAKE && n <= SLOT_MAX_STAKE && n % SLOT_STAKE_STEP === 0) &&
        stakes[0] < stakes[1] &&
        stakes[1] < stakes[2],
      { message: 'Enter three different stakes in multiples of 20 Silver, lowest first' },
    ),
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
  /** Each free spin's stops in the order played; empty when there were none. */
  free: SlotStops[];
  /** Each meter free spin's stops in the order played; empty when the meter did not fill. */
  meterFree: SlotStops[];
  /** The meter's points before the round, which a replay needs to know whether the meter filled. */
  meterBefore: number;
  /** Whole Silver. */
  stake: number;
  /** The whole round, whole Silver. */
  payout: number;
  /** Whole Silver won from the pots, 0 for a spin that won none: the sum of `pots`. */
  jackpot: number;
  /** Whole Silver won from each pot; `jackpot` stays their sum. */
  pots: Record<SlotPot, number>;
};
export type SlotsState = {
  live: boolean;
  machines: SlotMachineState[];
  characters: WalletCharacter[];
  /** The account's latest spins, newest first. */
  mine: SlotSpinView[];
  /** The latest big wins by anyone, newest first. */
  bigWins: SlotSpinView[];
  /** Empty when the pots cannot be read; otherwise all three, Mini first. */
  jackpots: SlotJackpotView[];
  meters: SlotMeterView[];
  daily: { limit: number; played: number };
};
export type SlotSpinResult = { spin: SlotSpinView; wallet: Wallet; state: SlotsState; meter: SlotMeterView };
export type SlotTotals = {
  spins: number;
  staked: number;
  paid: number;
  /** Whole Silver that went to the jackpot. */
  added: number;
};
export type GmSlotMachine = SlotMachineState & { today: SlotTotals; allTime: SlotTotals };
/** One pot. All money whole Silver, rounded down. */
export type GmSlotPot = {
  pot: SlotPot;
  live: boolean;
  /** The cap set for the next jackpot, whole Gold. */
  setCap: number;
  /** Null when the pot cannot be read. `cap` is what this pot runs under: the set cap while it has none. */
  running: { pot: number; cap: number; floor: number } | null;
  added: number;
  paid: number;
  drops: number;
  /** The latest 10 drops, newest first. */
  wins: SlotSpinView[];
};
export type GmSlots = {
  live: boolean;
  machines: GmSlotMachine[];
  latest: SlotSpinView[];
  jackpots: GmSlotPot[];
  daily: { limit: number };
};
