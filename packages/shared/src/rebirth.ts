import { z } from 'zod';
import type { Wallet } from './games.js';

/** The level a character must have reached to be reborn. */
export const REBIRTH_LEVEL = 90;

export type RebirthSettings = { live: boolean; priceGold: number; percent: number; limit: number };

export const REBIRTH_DEFAULT_SETTINGS: RebirthSettings = { live: false, priceGold: 0, percent: 2, limit: 10 };

export const rebirthSettingsSchema: z.ZodType<RebirthSettings> = z
  .object({
    live: z.boolean(),
    // 0 is allowed only while closed; the refinement below demands a price once live.
    priceGold: z.number().int().min(0).max(100_000),
    percent: z.number().int().min(1).max(10),
    limit: z.number().int().min(1).max(20),
  })
  .superRefine((s, ctx) => {
    if (s.live && s.priceGold < 1)
      ctx.addIssue({ code: 'custom', message: 'Set a price before opening rebirth', path: ['priceGold'] });
    if (s.percent * s.limit > 100)
      ctx.addIssue({ code: 'custom', message: 'Percent times limit cannot pass 100', path: ['percent'] });
  });
export type RebirthSettingsInput = z.infer<typeof rebirthSettingsSchema>;

/** The price the player was shown. */
export const rebirthRequestSchema = z.object({ priceGold: z.number().int().min(1) });
export type RebirthRequest = z.infer<typeof rebirthRequestSchema>;

export const rebirthIsOpen = (s: RebirthSettings): boolean => s.live && s.priceGold >= 1;

export const rebirthBonus = (rebirths: number, s: Pick<RebirthSettings, 'percent' | 'limit'>): number =>
  Math.min(rebirths, s.limit) * s.percent;

export const rebirthPriceGold = (number: number, priceGold: number): number => number * priceGold;

export type RebirthState = {
  characterId: number;
  name: string;
  level: number;
  online: boolean;
  wornItems: number;
  wallet: Wallet;
  rebirths: number;
  bonus: number;
  open: boolean;
  /** The rebirth that can be bought next. Null once the limit is reached. */
  next: { number: number; bonus: number; priceGold: number } | null;
};

export type RebirthLogEntry = {
  id: number;
  at: string;
  name: string;
  rebirth: number;
  bonus: number;
  priceGold: number;
};

export type GmRebirth = { settings: RebirthSettings; reborn: number; recent: RebirthLogEntry[] };
