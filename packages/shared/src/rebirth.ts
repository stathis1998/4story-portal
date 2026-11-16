import { z } from 'zod';
import { achievementRewardSchema, type AchievementReward } from './achievements.js';
import type { Wallet } from './games.js';

/** The level a character must have reached to be reborn. */
export const REBIRTH_LEVEL = 90;

export type RebirthSettings = { live: boolean; priceGold: number; percent: number;
  limit: number;
  /** EXP gained per rebirth, in percent. 0 = off. */
  expPercent: number;
  /** Monster gold gained per rebirth, in percent. 0 = off. */
  goldPercent: number;
};

export const REBIRTH_DEFAULT_SETTINGS: RebirthSettings = {
  live: false,
  priceGold: 0,
  percent: 2,
  limit: 10,
  expPercent: 0,
  goldPercent: 0,
};

export const REBIRTH_MAX_EXTRA_PERCENT = 25;
export const REBIRTH_MAX_EXTRA_TOTAL = 250;
/** The highest rebirth a reward can be set for (the highest limit). */
export const REBIRTH_MAX_NUMBER = 20;

export const rebirthSettingsSchema: z.ZodType<RebirthSettings> = z
  .object({
    live: z.boolean(),
    // 0 is allowed only while closed; the refinement below demands a price once live.
    priceGold: z.number().int().min(0).max(100_000),
    percent: z.number().int().min(1).max(10),
    limit: z.number().int().min(1).max(20),
    expPercent: z.number().int().min(0).max(REBIRTH_MAX_EXTRA_PERCENT),
    goldPercent: z.number().int().min(0).max(REBIRTH_MAX_EXTRA_PERCENT),
  })
  .superRefine((s, ctx) => {
    if (s.live && s.priceGold < 1)
      ctx.addIssue({ code: 'custom', message: 'Set a price before opening rebirth', path: ['priceGold'] });
    if (s.percent * s.limit > 100)
      ctx.addIssue({ code: 'custom', message: 'Percent times limit cannot pass 100', path: ['percent'] });
    if (s.expPercent * s.limit > REBIRTH_MAX_EXTRA_TOTAL)
      ctx.addIssue({ code: 'custom', message: 'EXP times limit cannot pass 250', path: ['expPercent'] });
    if (s.goldPercent * s.limit > REBIRTH_MAX_EXTRA_TOTAL)
      ctx.addIssue({ code: 'custom', message: 'Gold times limit cannot pass 250', path: ['goldPercent'] });
  });
export type RebirthSettingsInput = z.infer<typeof rebirthSettingsSchema>;

/** The price the player was shown. At most rebirth 20 at the highest price, 100,000 Gold. */
export const rebirthRequestSchema = z.object({ priceGold: z.number().int().min(1).max(2_000_000) });
export type RebirthRequest = z.infer<typeof rebirthRequestSchema>;

export const rebirthIsOpen = (s: RebirthSettings): boolean => s.live && s.priceGold >= 1;

/** min(rebirths, limit) x the given percent. */
export const rebirthExtraBonus = (rebirths: number, limit: number, percent: number): number =>
  Math.min(rebirths, limit) * percent;

export const rebirthBonus = (rebirths: number, s: Pick<RebirthSettings, 'percent' | 'limit'>): number =>
  rebirthExtraBonus(rebirths, s.limit, s.percent);

/** A reward number from a path string: an integer 1 to REBIRTH_MAX_NUMBER. */
export const rebirthRewardNumberSchema: z.ZodType<number> = z.coerce.number().int().min(1).max(REBIRTH_MAX_NUMBER);
export const rebirthRewardSchema = achievementRewardSchema;

export const rebirthPriceGold = (number: number, priceGold: number): number => number * priceGold;

export type RebirthBonuses = { stats: number; exp: number; gold: number };

export type RebirthState = {
  characterId: number;
  name: string;
  level: number;
  online: boolean;
  wornItems: number;
  wallet: Wallet;
  rebirths: number;
  bonuses: RebirthBonuses;
  open: boolean;
  /** The rebirth that can be bought next. Null once the limit is reached. */
  next: { number: number; bonuses: RebirthBonuses; priceGold: number; reward: AchievementReward | null } | null;
};

export type RebirthLogEntry = {
  id: number;
  at: string;
  name: string;
  rebirth: number;
  bonus: number;
  priceGold: number;
};

export type GmRebirthReward = { rebirth: number; reward: AchievementReward };

/** rewards lists every saved reward by rebirth number, including ones above the limit. */
export type GmRebirth = {
  settings: RebirthSettings;
  reborn: number;
  recent: RebirthLogEntry[];
  rewards: GmRebirthReward[];
};
