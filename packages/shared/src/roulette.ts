import { z } from 'zod';
import { type Wallet, type WalletCharacter, silverText } from './games.js';
import { characterIdSchema } from './player-stats.js';

/** The 37 pockets in the standard European wheel order. */
export const ROULETTE_POCKETS: readonly number[] = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29,
  7, 28, 12, 35, 3, 26,
];

export type RouletteColour = 'green' | 'red' | 'black';

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export const rouletteColour = (pocket: number): RouletteColour =>
  pocket === 0 ? 'green' : RED.has(pocket) ? 'red' : 'black';

export const ROULETTE_OUTSIDE = [
  'red',
  'black',
  'odd',
  'even',
  'low',
  'high',
  'dozen1',
  'dozen2',
  'dozen3',
  'column1',
  'column2',
  'column3',
] as const;

export type RouletteSpot = `n${number}` | (typeof ROULETTE_OUTSIDE)[number];

/** 'n0'..'n36', then the outside spots: 49 in all. */
export const ROULETTE_SPOTS: readonly RouletteSpot[] = [
  ...Array.from({ length: 37 }, (_, n): RouletteSpot => `n${n}`),
  ...ROULETTE_OUTSIDE,
];

const SPOT_SET: ReadonlySet<string> = new Set(ROULETTE_SPOTS);

export const isNumberSpot = (spot: RouletteSpot): boolean => spot.startsWith('n');

export function spotCovers(spot: RouletteSpot, pocket: number): boolean {
  if (isNumberSpot(spot)) return Number(spot.slice(1)) === pocket;
  // Zero is green and belongs to no outside spot.
  if (pocket === 0) return false;
  switch (spot) {
    case 'red':
      return rouletteColour(pocket) === 'red';
    case 'black':
      return rouletteColour(pocket) === 'black';
    case 'odd':
      return pocket % 2 === 1;
    case 'even':
      return pocket % 2 === 0;
    case 'low':
      return pocket <= 18;
    case 'high':
      return pocket >= 19;
    case 'dozen1':
      return pocket <= 12;
    case 'dozen2':
      return pocket >= 13 && pocket <= 24;
    case 'dozen3':
      return pocket >= 25;
    // Columns follow the table rows: 1, 4, 7 ... then 2, 5, 8 ... then 3, 6, 9 ...
    case 'column1':
      return pocket % 3 === 1;
    case 'column2':
      return pocket % 3 === 2;
    case 'column3':
      return pocket % 3 === 0;
    default:
      return false;
  }
}

/** What a winning chip earns on top of its stake. */
export const spotOdds = (spot: RouletteSpot): number => {
  if (isNumberSpot(spot)) return 35;
  return spot.startsWith('dozen') || spot.startsWith('column') ? 2 : 1;
};

export function spotLabel(spot: RouletteSpot): string {
  if (isNumberSpot(spot)) return spot.slice(1);
  switch (spot) {
    case 'red':
      return 'Red';
    case 'black':
      return 'Black';
    case 'odd':
      return 'Odd';
    case 'even':
      return 'Even';
    case 'low':
      return '1 to 18';
    case 'high':
      return '19 to 36';
    case 'dozen1':
      return '1 to 12';
    case 'dozen2':
      return '13 to 24';
    case 'dozen3':
      return '25 to 36';
    default:
      return `Column ${spot.slice(-1)}`;
  }
}

export type RouletteBet = { spot: RouletteSpot; amount: number };
/** All in whole Silver. */
export type RouletteLimits = { minBet: number; maxNumber: number; maxOutside: number };

export const ROULETTE_DEFAULT_LIMITS: RouletteLimits = { minBet: 10, maxNumber: 1000, maxOutside: 10_000 };
/** 1,000 Gold. */
export const ROULETTE_MAX_LIMIT = 1_000_000;
export const ROULETTE_CHIPS = [10, 50, 100, 500, 1000, 5000] as const;

export const spotLimit = (spot: RouletteSpot, limits: RouletteLimits): number =>
  isNumberSpot(spot) ? limits.maxNumber : limits.maxOutside;

/** The standard chips from minBet up to the larger of the two maximums; [minBet] when none fits. */
export function rouletteChips(limits: RouletteLimits): number[] {
  const top = Math.max(limits.maxNumber, limits.maxOutside);
  const chips = ROULETTE_CHIPS.filter((chip) => chip >= limits.minBet && chip <= top);
  return chips.length > 0 ? chips : [limits.minBet];
}

/** Null when the bets are allowed, otherwise the reason, ready to show. */
export function checkBets(bets: RouletteBet[], limits: RouletteLimits): string | null {
  if (bets.length === 0) return 'Put a chip on the table first';
  if (bets.some((b) => !SPOT_SET.has(b.spot))) return 'That is not a spot on the table';
  if (new Set(bets.map((b) => b.spot)).size !== bets.length) return 'Each spot can only be bet on once';
  if (bets.some((b) => !Number.isInteger(b.amount) || b.amount < limits.minBet))
    return `The smallest bet is ${silverText(limits.minBet)}`;
  if (bets.some((b) => isNumberSpot(b.spot) && b.amount > limits.maxNumber))
    return `The largest bet on a number is ${silverText(limits.maxNumber)}`;
  const over = bets.find((b) => !isNumberSpot(b.spot) && b.amount > limits.maxOutside);
  if (over) return `The largest bet on ${spotLabel(over.spot)} is ${silverText(limits.maxOutside)}`;
  return null;
}

/** The payout is every winning stake back plus its odds; zero wins only for a chip on 0. */
export function settleBets(
  bets: RouletteBet[],
  pocket: number,
): { stake: number; payout: number; winning: RouletteSpot[]; numberHit: boolean } {
  let stake = 0;
  let payout = 0;
  let numberHit = false;
  const winning: RouletteSpot[] = [];
  for (const bet of bets) {
    stake += bet.amount;
    if (!spotCovers(bet.spot, pocket)) continue;
    payout += bet.amount * (spotOdds(bet.spot) + 1);
    winning.push(bet.spot);
    if (isNumberSpot(bet.spot)) numberHit = true;
  }
  return { stake, payout, winning, numberHit };
}

const spotSchema = z.custom<RouletteSpot>((value) => typeof value === 'string' && SPOT_SET.has(value), {
  message: 'That is not a spot on the table',
});

export const rouletteSpinRequestSchema = z.object({
  characterId: characterIdSchema,
  bets: z
    .array(z.object({ spot: spotSchema, amount: z.number().int().min(1).max(ROULETTE_MAX_LIMIT) }))
    .min(1)
    .max(ROULETTE_SPOTS.length),
});
export type RouletteSpinRequest = z.output<typeof rouletteSpinRequestSchema>;

const limitSchema = z.number().int().min(1).max(ROULETTE_MAX_LIMIT);

export const rouletteSettingsSchema = z
  .object({ live: z.boolean(), minBet: limitSchema, maxNumber: limitSchema, maxOutside: limitSchema })
  .refine((s) => s.minBet <= s.maxNumber && s.minBet <= s.maxOutside, {
    message: 'The smallest bet cannot be larger than a largest bet',
    path: ['minBet'],
  });
export type RouletteSettingsInput = z.output<typeof rouletteSettingsSchema>;

export type RouletteSpinView = {
  id: number;
  /** ISO, the server's clock. */
  at: string;
  character: string;
  pocket: number;
  /** Whole Silver. */
  stake: number;
  payout: number;
};

export type RouletteState = {
  live: boolean;
  limits: RouletteLimits;
  characters: WalletCharacter[];
  /** The account's latest spins, newest first. */
  mine: RouletteSpinView[];
  /** The latest big wins by anyone, newest first. */
  bigWins: RouletteSpinView[];
};

export type RouletteSpinResult = {
  spin: RouletteSpinView;
  winning: RouletteSpot[];
  wallet: Wallet;
  state: RouletteState;
};

export type RouletteTotals = { spins: number; staked: number; paid: number };

export type GmRoulette = {
  live: boolean;
  limits: RouletteLimits;
  today: RouletteTotals;
  allTime: RouletteTotals;
  latest: RouletteSpinView[];
};
