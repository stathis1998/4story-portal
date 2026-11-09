import { z } from 'zod';

/** Route param for a character; the game stores it as a signed 32-bit value. */
export const characterIdSchema = z.coerce.number().int().min(1).max(2147483647);

/** The `q` of a character search: enough letters to be useful, and no longer than a name can be. */
export const characterSearchSchema = z.string().trim().min(2).max(16);

/** Level 90 is already every character's cap, so a freeze stops below it. */
export const MAX_FREEZE_LEVEL = 89;

/** A null level removes the freeze. */
export const levelFreezeRequestSchema = z.object({
  level: z.number().int().min(1).max(MAX_FREEZE_LEVEL).nullable(),
});
export type LevelFreezeRequest = z.infer<typeof levelFreezeRequestSchema>;

export type LevelFreeze = {
  level: number;
  freezeLevel: number | null;
  /** A character that's online can't be changed: the game only reads the freeze when it loads one. */
  online: boolean;
};

export const hallOfFameSettingsSchema = z.object({ hideGms: z.boolean() });
export type HallOfFameSettings = z.infer<typeof hallOfFameSettingsSchema>;

export type CharacterStats = {
  id: number;
  /** How far through the current level, 0 to 1. Null when the level chart has no row for it. */
  progress: number | null;
  hoursPlayed: number;
};

export type ActivityDay = { date: string; minutes: number };

export const BADGE_CATEGORIES = [
  { id: 'progress', label: 'Progress' },
  { id: 'playtime', label: 'Playtime' },
  { id: 'gear', label: 'Gear' },
  { id: 'collection', label: 'Collection' },
  { id: 'social', label: 'Social' },
  { id: 'combat', label: 'Combat' },
  { id: 'misfortune', label: 'Misfortune' },
] as const;

export type BadgeCategoryId = (typeof BADGE_CATEGORIES)[number]['id'];

export type BadgeView = {
  id: string;
  name: string;
  description: string;
  category: BadgeCategoryId;
  /** The game doesn't record this yet, so nobody can earn it. */
  comingSoon: boolean;
  earned: boolean;
  /** Accounts holding it, out of all ranked accounts. */
  holders: number;
  players: number;
  /** `YYYY-MM-DD`. Null when not earned, or earned before the portal started tracking. */
  firstSeen: string | null;
  isNew: boolean;
  firstToEarn: boolean;
};

export type PlayerOverview = {
  /** The server's date, `YYYY-MM-DD`. */
  today: string;
  hoursPlayed: number;
  daysPlayed: number;
  currentStreak: number;
  longestStreak: number;
  /** Days with play in the last year, oldest first. */
  activity: ActivityDay[];
  badges: BadgeView[];
  characters: CharacterStats[];
};

export type TooltipLine = { text: string; color: string };

export type ItemQuality = 'normal' | 'magic' | 'rare' | 'grade' | 'wrap';

/** An item's in-game tooltip, ready to draw. */
export type ItemTooltip = {
  title: TooltipLine;
  /** The number the game prints on the tooltip's icon, null when it shows none. */
  competence: number | null;
  /** Picks the icon's border. */
  quality: ItemQuality;
  lines: TooltipLine[];
};

export type GearItem = {
  slot: number;
  slotName: string;
  itemId: number;
  name: string;
  /** Sprite ID for `/game-icons`, null when the client has no icon. */
  icon: number | null;
  upgrade: number;
  tooltip: ItemTooltip;
};

export type CompanionView = { slot: number; name: string; level: number };

export type HallCategoryId = 'level' | 'hours' | 'streak' | 'item' | 'titles' | 'companion' | 'badges';

export type CharacterRanking = { category: HallCategoryId; label: string; place: number; display: string };

export type CharacterProfile = {
  id: number;
  name: string;
  level: number;
  className: string;
  race: string;
  country: string;
  progress: number | null;
  ageDays: number | null;
  hoursPlayed: number;
  daysPlayed: number;
  longestStreak: number;
  longestSessionMinutes: number;
  gear: GearItem[];
  companions: CompanionView[];
  titles: string[];
  titlesTotal: number;
  /** False for a GM while GM accounts are hidden. */
  ranked: boolean;
  rankings: CharacterRanking[];
};

/** What anyone can see of a character. Everything else on the profile is private to its owner. */
export type CharacterInspect = {
  id: number;
  name: string;
  level: number;
  className: string;
  race: string;
  country: string;
  gear: GearItem[];
};

export type CharacterSearchResult = { id: number; name: string; level: number; className: string };

export type HallEntry = {
  characterId: number;
  place: number;
  name: string;
  className: string;
  level: number;
  /** Ready to show, such as `+24` or `35 h`. */
  display: string;
  /** The item behind a best item entry. */
  detail: string | null;
  mine: boolean;
};

export type HallCategory = {
  id: HallCategoryId;
  label: string;
  entries: HallEntry[];
  /** Your place, when your best character isn't listed. */
  you: { place: number; name: string; display: string } | null;
};

export type HallOfFame = {
  categories: HallCategory[];
  /** False for a GM while GM accounts are hidden. */
  ranked: boolean;
  /** The switch, sent to GMs only. */
  gm: { hideGms: boolean } | null;
};

export type LeaderboardCategoryId = 'damage' | 'kills' | 'gold' | 'lottery';

export type Leaderboard = {
  /** Every ranked character is listed, so `you` is always null. */
  categories: (Omit<HallCategory, 'id'> & { id: LeaderboardCategoryId })[];
  /** False for a GM while GM accounts are hidden. */
  ranked: boolean;
};

export type ActiveEvent = {
  type: number;
  typeName: string;
  bonus: number;
  /** Null means all maps, or a type that has no map. */
  mapName: string | null;
  /** The server's clock, `YYYY-MM-DDTHH:mm`. */
  endsAt: string;
};

export type ActiveEvents = { serverNow: string; events: ActiveEvent[] };
