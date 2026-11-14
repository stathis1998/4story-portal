import { z } from 'zod';
import { type AchievementReward, achievementRewardSchema } from './achievements.js';
import type { ControlState } from './api-types.js';
import { characterIdSchema } from './player-stats.js';

/** The character that receives a prize must be at least this level, so throwaway accounts can't farm the wheel. */
export const WHEEL_MIN_LEVEL = 20;
/** More segments than this can't be read on a phone. */
export const WHEEL_MAX_PRIZES = 20;
export const WHEEL_MAX_WEIGHT = 10_000;

/**
 * A prize as a GM saves it. The name is shown on the wheel and goes into the letter and the game's
 * chat, whose columns are VARCHAR, so it is printable ASCII only. The reward travels in one letter,
 * so the mail limits apply; no money and no items makes a "no luck" segment.
 */
export const wheelPrizeSchema = achievementRewardSchema.extend({
  name: z
    .string()
    .trim()
    .min(1, 'Give the prize a name')
    .max(40)
    .regex(/^[\x20-\x7E]*$/, 'Use plain letters, digits and punctuation only'),
  weight: z.number().int().min(1).max(WHEEL_MAX_WEIGHT),
  /** Position on the wheel, lowest first. */
  order: z.number().int().min(0).max(9999),
  enabled: z.boolean(),
  /** A win is said in world chat. */
  announce: z.boolean(),
});
export type WheelPrizeInput = z.output<typeof wheelPrizeSchema>;

export const wheelSpinRequestSchema = z.object({ characterId: characterIdSchema });
export type WheelSpinRequest = z.output<typeof wheelSpinRequestSchema>;

export const wheelLiveSchema = z.object({ live: z.boolean() });
export type WheelLiveRequest = z.infer<typeof wheelLiveSchema>;

/** A segment of the wheel as players see it. */
export type WheelPrize = {
  id: number;
  name: string;
  /** Percent, out of the prizes on the wheel. */
  chance: number;
  /** Null for a "no luck" segment. */
  reward: AchievementReward | null;
  announce: boolean;
};

/** A spin that happened. */
export type WheelSpin = {
  id: number;
  /** ISO, the server's clock. */
  at: string;
  character: string;
  prize: string;
  /** What the letter carried. Null when the prize was empty. */
  reward: AchievementReward | null;
};

export type WheelState = {
  /** False until a GM switches the wheel on. */
  live: boolean;
  minLevel: number;
  /** The segments, in wheel order, clockwise from the top. */
  prizes: WheelPrize[];
  /** The account's spin today, or null while it still has one. */
  today: WheelSpin | null;
  /** Until midnight on the server's clock, when the next spin is free. */
  secondsToReset: number;
  /** The account's latest spins, newest first. */
  mine: WheelSpin[];
  /** The latest announced wins by anyone, newest first. */
  winners: WheelSpin[];
};

/** The answer to a spin. `state` is the page as it is afterwards. */
export type WheelSpinResult = { spin: WheelSpin; prizeId: number; state: WheelState };

export type GmWheelPrize = WheelPrizeInput & {
  id: number;
  /** Percent among the enabled prizes; 0 for a disabled one. */
  chance: number;
  reward: AchievementReward | null;
};

export type GmWheel = {
  live: boolean;
  control: ControlState;
  spinsToday: number;
  /** Every prize, disabled ones too, in wheel order. */
  prizes: GmWheelPrize[];
};
