// The achievements and their levels. Each one is a number worked out from the game's stats and up
// to five thresholds that number has to pass. No database or clock in here.
//
// A character achievement is earned by each character on its own, and can pay a reward. An account
// achievement is earned once by the account and pays nothing: it is about the player, not a
// character, so a character starting over (rebirth) has no effect on it.
//
// An ID is stored with every award, so it must never change. Thresholds can: raising one doesn't take
// an awarded level back, and lowering one pays whoever is now past it.

import type { AchievementCategoryId, AchievementScope } from '@4story-portal/shared';
import type { AccountStatsRow, CharacterStatsRow } from '../stats/stats-rules.js';

type Family<Scope extends AchievementScope, Subject> = {
  id: string;
  name: string;
  category: AchievementCategoryId;
  scope: Scope;
  /** The value needed for each level, lowest first. */
  levels: readonly number[];
  value: (subject: Subject) => number;
  /** What a level asks for, such as `Defeat 10,000 monsters`. Plain ASCII: it goes into game mail. */
  goal: (threshold: number) => string;
  /** How a value or threshold reads. Grouped digits when left out. */
  format?: (value: number) => string;
};

export type CharacterFamily = Family<'character', CharacterStatsRow>;
export type AccountFamily = Family<'account', AccountStatsRow>;
export type AchievementFamily = CharacterFamily | AccountFamily;

const COPPER_PER_GOLD = 1_000_000;
// Upgrades from +17 carry a glow in game.
const GLOW_FROM_UPGRADE = 17;
const ROSTER_LEVEL = 50;

const grouped = (value: number) => value.toLocaleString('en-US');
const compact = (value: number) =>
  new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
const plus = (value: number) => `+${value}`;
const times = (count: number) => (count === 1 ? 'once' : `${grouped(count)} times`);
const some = (count: number, one: string, many: string) => (count === 1 ? one : `${grouped(count)} ${many}`);
/** Copper in whole gold. */
const gold = (copper: number) => Math.floor(copper / COPPER_PER_GOLD);

type Spec<F> = Omit<F, 'scope'>;
const character = (spec: Spec<CharacterFamily>): CharacterFamily => ({ ...spec, scope: 'character' });
const account = (spec: Spec<AccountFamily>): AccountFamily => ({ ...spec, scope: 'account' });

const sessions = (id: string, name: string, pick: (row: AccountStatsRow) => number, when: string): AccountFamily =>
  account({ id, name, category: 'playtime', levels: [5, 15, 40, 100, 250], value: pick, goal: (t) => `Log in ${when}, ${times(t)}` });

export const CHARACTER_ACHIEVEMENTS: readonly CharacterFamily[] = [
  // Progress
  character({
    id: 'level',
    name: 'Adventurer',
    category: 'progress',
    levels: [20, 40, 60, 80, 90],
    value: ({ row }) => row.level,
    goal: (t) => `Reach level ${t}`,
  }),
  character({
    id: 'skills',
    name: 'Scholar',
    category: 'progress',
    // A level 89 character had 134 learned and 238 points unspent a week into the 2026 season.
    levels: [50, 100, 150, 200, 250],
    value: (c) => c.skillLevels,
    goal: (t) => `Learn ${t} skill levels`,
  }),

  // Combat
  character({
    id: 'kills',
    name: 'Slayer',
    category: 'combat',
    levels: [1_000, 10_000, 50_000, 250_000, 1_000_000],
    value: (c) => c.kills,
    goal: (t) => `Defeat ${grouped(t)} monsters`,
  }),
  character({
    id: 'damage',
    name: 'Heavy Hitter',
    category: 'combat',
    levels: [1_000_000, 10_000_000, 100_000_000, 1_000_000_000, 5_000_000_000],
    value: (c) => c.damageDealt,
    goal: (t) => `Deal ${compact(t)} damage to monsters`,
    format: compact,
  }),
  character({
    id: 'damage-taken',
    name: 'Punching Bag',
    category: 'combat',
    levels: [100_000, 500_000, 2_500_000, 10_000_000, 50_000_000],
    value: (c) => c.damageTaken,
    goal: (t) => `Take ${compact(t)} damage`,
    format: compact,
  }),
  character({
    id: 'healing',
    name: 'Lifeline',
    category: 'combat',
    levels: [10_000, 100_000, 1_000_000, 10_000_000, 100_000_000],
    value: (c) => c.healDone,
    goal: (t) => `Heal ${compact(t)} health`,
    format: compact,
  }),
  character({
    id: 'bestiary',
    name: 'Explorer',
    category: 'combat',
    levels: [20, 50, 100, 150, 250],
    value: (c) => c.monsterTypes,
    goal: (t) => `Defeat ${t} different kinds of monster`,
  }),
  character({
    id: 'nemesis',
    name: 'Nemesis',
    category: 'combat',
    levels: [500, 2_500, 10_000, 25_000, 100_000],
    value: (c) => c.topMonsterKills,
    goal: (t) => `Defeat one kind of monster ${grouped(t)} times`,
  }),
  character({
    id: 'duels',
    name: 'Duellist',
    category: 'combat',
    levels: [1, 10, 25, 50, 100],
    value: (c) => c.duelWins,
    goal: (t) => `Win ${some(t, 'a duel', 'duels')}`,
  }),

  // Gear
  character({
    id: 'upgrade',
    name: 'Master Smith',
    category: 'gear',
    levels: [18, 20, 22, 23, 24],
    value: (c) => c.highestUpgrade,
    goal: (t) => `Upgrade an item to +${t}`,
    format: plus,
  }),
  character({
    id: 'upgrade-successes',
    name: 'Steady Hand',
    category: 'gear',
    levels: [25, 100, 300, 1_000, 3_000],
    value: (c) => c.upgradesSucceeded,
    goal: (t) => `Succeed with ${grouped(t)} upgrade scrolls`,
  }),
  character({
    id: 'gem-successes',
    name: 'Gem Cutter',
    category: 'gear',
    levels: [50, 250, 1_000, 5_000, 20_000],
    value: (c) => c.gemSuccesses,
    goal: (t) => `Succeed with ${grouped(t)} gemstones`,
  }),
  character({
    id: 'gem-level',
    name: 'Brilliant',
    category: 'gear',
    levels: [1, 2, 3, 4, 5],
    value: (c) => Math.max(0, ...c.gear.map((item) => item.gem)),
    goal: (t) => `Wear an item with a level ${t} gem`,
  }),
  character({
    id: 'glowing',
    name: 'Radiant',
    category: 'gear',
    levels: [1, 3, 5, 8, 11],
    value: (c) => c.gear.filter((item) => item.upgrade >= GLOW_FROM_UPGRADE).length,
    goal: (t) => `Wear ${some(t, 'an item', 'items')} at +${GLOW_FROM_UPGRADE} or higher`,
  }),
  character({
    id: 'equipped',
    name: 'Fully Geared',
    category: 'gear',
    levels: [6, 11, 15, 17, 19],
    value: (c) => c.gear.length,
    goal: (t) => `Fill ${t} equipment slots`,
  }),

  // Wealth
  character({
    id: 'gold-held',
    name: 'Hoarder',
    category: 'wealth',
    levels: [100, 500, 2_000, 5_000, 10_000],
    value: ({ row }) => row.gold,
    goal: (t) => `Hold ${grouped(t)} gold`,
  }),
  character({
    id: 'gold-looted',
    name: 'Looter',
    category: 'wealth',
    levels: [100, 1_000, 5_000, 20_000, 50_000],
    value: (c) => gold(c.copperLooted),
    goal: (t) => `Loot ${grouped(t)} gold from monsters`,
  }),
  character({
    id: 'gold-spent',
    name: 'Big Spender',
    category: 'wealth',
    levels: [100, 1_000, 5_000, 25_000, 100_000],
    value: (c) => gold(c.copperSpent),
    goal: (t) => `Spend ${grouped(t)} gold at NPCs`,
  }),
  character({
    id: 'lottery-plays',
    name: 'Gambler',
    category: 'wealth',
    levels: [10, 50, 250, 1_000, 5_000],
    value: (c) => c.lotteriesWon + c.lotteriesLost,
    goal: (t) => `Play the soul lottery ${grouped(t)} times`,
  }),
  character({
    id: 'lottery-wins',
    name: 'Lucky',
    category: 'wealth',
    levels: [1, 10, 50, 200, 500],
    value: (c) => c.lotteriesWon,
    goal: (t) => `Win the soul lottery ${times(t)}`,
  }),
  character({
    id: 'lottery-gold',
    name: 'Jackpot',
    category: 'wealth',
    levels: [100, 1_000, 5_000, 20_000, 50_000],
    value: (c) => gold(c.lotteryCopperWon),
    goal: (t) => `Win ${grouped(t)} gold in the soul lottery`,
  }),

  // Collection
  character({
    id: 'titles',
    name: 'Titled',
    category: 'collection',
    levels: [3, 6, 10, 15, 25],
    value: (c) => c.titles.length,
    goal: (t) => `Collect ${t} titles`,
  }),
  character({
    id: 'companions',
    name: 'Pack Leader',
    category: 'collection',
    levels: [1, 2, 3, 4, 5],
    value: (c) => c.companions.length,
    goal: (t) => `Have ${some(t, 'a companion', 'companions')}`,
  }),
  character({
    id: 'companion-level',
    name: 'Beast Master',
    category: 'collection',
    levels: [10, 20],
    value: (c) => c.companionLevel,
    goal: (t) => `Raise a companion to level ${t}`,
  }),

  // Social
  character({
    id: 'friends',
    name: 'Good Company',
    category: 'social',
    levels: [1, 2, 4, 6, 10],
    value: (c) => c.friends,
    goal: (t) => `Have ${some(t, 'a friend', 'friends')}`,
  }),
  character({
    id: 'guild-member',
    name: 'Guild Member',
    category: 'social',
    levels: [1],
    value: (c) => (c.inGuild ? 1 : 0),
    goal: () => 'Join a guild',
  }),
  character({
    id: 'guild-leader',
    name: 'Guild Leader',
    category: 'social',
    levels: [1],
    value: (c) => (c.leadsGuild ? 1 : 0),
    goal: () => 'Lead a guild',
  }),

  // Misfortune
  character({
    id: 'upgrade-fails',
    name: 'Cursed Anvil',
    category: 'misfortune',
    levels: [10, 100, 500, 2_000, 10_000],
    value: (c) => c.upgradesFailed,
    goal: (t) => `Fail ${grouped(t)} upgrade scrolls`,
  }),
  character({
    id: 'setbacks',
    name: 'Two Steps Back',
    category: 'misfortune',
    levels: [10, 50, 200, 1_000, 5_000],
    value: (c) => c.upgradeSetbacks,
    goal: (t) => `Lose item levels to a failed upgrade, ${times(t)}`,
  }),
  character({
    id: 'destroyed',
    name: 'Heartbreak',
    category: 'misfortune',
    levels: [1, 3, 10, 25, 50],
    value: (c) => c.itemsDestroyed,
    goal: (t) => `Lose ${some(t, 'an item', 'items')} to a failed upgrade`,
  }),
  character({
    id: 'lottery-losses',
    name: 'Unlucky',
    category: 'misfortune',
    levels: [10, 100, 500, 2_000, 10_000],
    value: (c) => c.lotteriesLost,
    goal: (t) => `Lose the soul lottery ${grouped(t)} times`,
  }),
  character({
    id: 'lose-streak',
    name: 'Cold Streak',
    category: 'misfortune',
    levels: [10, 20, 35, 50, 75],
    value: (c) => c.longestLoseStreak,
    goal: (t) => `Lose the soul lottery ${t} times in a row`,
  }),
];

export const ACCOUNT_ACHIEVEMENTS: readonly AccountFamily[] = [
  // Playtime
  account({
    id: 'hours',
    name: 'Dedicated',
    category: 'playtime',
    levels: [10, 50, 150, 400, 1000],
    value: (row) => Math.floor(row.minutesPlayed / 60),
    goal: (t) => `Play for ${grouped(t)} hours`,
  }),
  account({
    id: 'days',
    name: 'Regular',
    category: 'playtime',
    levels: [3, 10, 30, 75, 150],
    value: (row) => row.daysPlayed,
    goal: (t) => `Play on ${t} different days`,
  }),
  account({
    id: 'streak',
    name: 'Unbroken',
    category: 'playtime',
    levels: [3, 7, 14, 30, 60],
    value: (row) => row.longestStreak,
    goal: (t) => `Play ${t} days in a row`,
  }),
  account({
    id: 'marathon',
    name: 'Marathon',
    category: 'playtime',
    levels: [2, 4, 6, 8, 12],
    value: (row) => Math.floor(Math.max(0, ...row.characters.map((c) => c.longestSessionMinutes)) / 60),
    goal: (t) => `Stay logged in for ${t} hours in one session`,
  }),
  sessions('night-owl', 'Night Owl', (row) => row.nightSessions, 'between midnight and 5 AM'),
  sessions('early-bird', 'Early Bird', (row) => row.earlySessions, 'between 5 AM and 8 AM'),
  sessions('weekend-warrior', 'Weekend Warrior', (row) => row.weekendSessions, 'on a Saturday or Sunday'),

  // Progress
  account({
    id: 'roster',
    name: 'Full Roster',
    category: 'progress',
    levels: [1, 2, 3, 4, 5],
    value: (row) => row.characters.filter((c) => c.row.level >= ROSTER_LEVEL).length,
    goal: (t) => `Have ${some(t, 'a character', 'characters')} at level ${ROSTER_LEVEL}`,
  }),

  // Collection
  account({
    id: 'classes',
    name: 'Jack of Trades',
    category: 'collection',
    levels: [2, 3, 4, 5, 6],
    value: (row) => new Set(row.characters.map((c) => c.row.classCode)).size,
    goal: (t) => `Have characters of ${t} different classes`,
  }),
  account({
    id: 'pets',
    name: 'Stable Master',
    category: 'collection',
    levels: [1, 3, 5, 8, 12],
    value: (row) => row.pets,
    goal: (t) => `Own ${some(t, 'a mount or pet', 'mounts and pets')}`,
  }),
];

export const ACHIEVEMENTS: readonly AchievementFamily[] = [...CHARACTER_ACHIEVEMENTS, ...ACCOUNT_ACHIEVEMENTS];

const levelCount = (families: readonly AchievementFamily[]) => families.reduce((total, family) => total + family.levels.length, 0);
export const CHARACTER_LEVELS_TOTAL = levelCount(CHARACTER_ACHIEVEMENTS);
export const ACCOUNT_LEVELS_TOTAL = levelCount(ACCOUNT_ACHIEVEMENTS);

/** How many of the levels `value` has passed. */
export const levelReached = (family: Pick<AchievementFamily, 'levels'>, value: number): number =>
  family.levels.filter((threshold) => value >= threshold).length;

export const formatValue = (family: Pick<AchievementFamily, 'format'>, value: number): string => (family.format ?? grouped)(value);

/** Every character achievement level this character's stats reach right now. */
export const characterLevelsDone = (subject: CharacterStatsRow): number =>
  CHARACTER_ACHIEVEMENTS.reduce((total, family) => total + levelReached(family, family.value(subject)), 0);

/** Every account achievement level the account's stats reach right now. */
export const accountLevelsDone = (subject: AccountStatsRow): number =>
  ACCOUNT_ACHIEVEMENTS.reduce((total, family) => total + levelReached(family, family.value(subject)), 0);

/** The account's own levels, plus those of each of its characters that isn't banned. */
export const levelsDone = (subject: AccountStatsRow): number =>
  accountLevelsDone(subject) +
  subject.characters.filter(({ row }) => !row.banned).reduce((total, each) => total + characterLevelsDone(each), 0);
