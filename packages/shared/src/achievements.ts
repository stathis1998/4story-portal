import { z } from 'zod';
import type { ControlState } from './api-types.js';
import { MAIL_MAX_ITEMS, mailItemSchema, moneySchema } from './gm-mail.js';

export const ACHIEVEMENT_CATEGORIES = [
  { id: 'progress', label: 'Progress' },
  { id: 'playtime', label: 'Playtime' },
  { id: 'combat', label: 'Combat' },
  { id: 'gear', label: 'Gear' },
  { id: 'wealth', label: 'Wealth' },
  { id: 'collection', label: 'Collection' },
  { id: 'social', label: 'Social' },
  { id: 'misfortune', label: 'Misfortune' },
] as const;

export type AchievementCategoryId = (typeof ACHIEVEMENT_CATEGORIES)[number]['id'];

/** No achievement has more levels than this. */
export const ACHIEVEMENT_MAX_LEVELS = 5;

const ROMAN = ['I', 'II', 'III', 'IV', 'V'];
/** `Slayer III`. A single-level achievement is just its name. */
export const achievementLevelName = (name: string, level: number, levels: number) =>
  levels === 1 ? name : `${name} ${ROMAN[level - 1] ?? level}`;

/** What a level pays, as the GM saves it. It travels in one letter, so the mail limits apply. */
export const achievementRewardSchema = moneySchema.extend({
  items: z.array(mailItemSchema).max(MAIL_MAX_ITEMS).default([]),
});
export type AchievementRewardInput = z.output<typeof achievementRewardSchema>;

export const achievementRewardRequestSchema = z.object({
  achievementId: z.string().min(1).max(40),
  level: z.number().int().min(1).max(ACHIEVEMENT_MAX_LEVELS),
  reward: achievementRewardSchema,
});
export type AchievementRewardRequest = z.output<typeof achievementRewardRequestSchema>;

export const achievementsLiveSchema = z.object({ live: z.boolean() });
export type AchievementsLiveRequest = z.infer<typeof achievementsLiveSchema>;

export type AchievementRewardItem = {
  itemId: number;
  count: number;
  name: string;
  /** Sprite ID for `/game-icons`, null when the client has no icon. */
  icon: number | null;
};

/** A reward ready to show. Null wherever a level pays nothing. */
export type AchievementReward = { gold: number; silver: number; copper: number; items: AchievementRewardItem[] };

export type AchievementLevel = {
  /** 1 is the first. */
  level: number;
  threshold: number;
  /** The threshold written the way `valueText` is, such as `10,000`, `+22` or `100M`. */
  thresholdText: string;
  /** What to do, such as `Defeat 10,000 monsters`. */
  goal: string;
  reward: AchievementReward | null;
  done: boolean;
  /** When the reward letter went out, ISO. Null when not done, or done before the system went live. */
  earnedAt: string | null;
  /** Accounts that have this level, out of `players`. */
  holders: number;
  /** Those accounts, each under its highest level character, by name. Never account names. */
  holderNames: string[];
};

export type Achievement = {
  id: string;
  name: string;
  category: AchievementCategoryId;
  /** The account's number right now, in the unit the thresholds use. */
  value: number;
  /** Ready to show next to a threshold, such as `7,420` or `+22`. */
  valueText: string;
  levelsDone: number;
  levels: AchievementLevel[];
};

export type AchievementsOverview = {
  achievements: Achievement[];
  levelsDone: number;
  levelsTotal: number;
  /** Ranked accounts, the `of y` behind every `holders`. */
  players: number;
  /** False until a GM switches rewards on. Levels show either way. */
  live: boolean;
};

export type NewsItem = {
  id: number;
  /** ISO, the server's clock. */
  at: string;
  /** The line the game announced, such as `Mounara completed Slayer III: Defeat 10,000 monsters`. */
  text: string;
  /** One of the viewer's own characters. */
  mine: boolean;
};

export type News = { serverNow: string; items: NewsItem[] };

export type GmAchievementLevel = { level: number; goal: string; reward: AchievementReward | null };
export type GmAchievement = { id: string; name: string; category: AchievementCategoryId; levels: GmAchievementLevel[] };

export type GmAchievements = {
  live: boolean;
  control: ControlState;
  /** Levels awarded so far this season. */
  awards: number;
  /** Awards whose announcement hasn't gone out yet. */
  pendingAnnouncements: number;
  /** When the worker last looked, ISO. Null before its first run. */
  lastCheck: string | null;
  achievements: GmAchievement[];
};
