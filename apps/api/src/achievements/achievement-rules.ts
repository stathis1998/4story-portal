// The achievements and their levels. Each one is a number worked out from an account's stats and
// up to five thresholds that number has to pass. No database or clock in here.
//
// An ID is stored with every award, so it must never change. Thresholds can: raising one doesn't take
// an awarded level back, and lowering one pays whoever is now past it.

import type { AchievementCategoryId } from '@4story-portal/shared';
import type { AccountStatsRow, CharacterStatsRow } from '../stats/stats-rules.js';

export type AchievementFamily = {
  id: string;
  name: string;
  category: AchievementCategoryId;
  /** The value needed for each level, lowest first. */
  levels: readonly number[];
  value: (account: AccountStatsRow) => number;
  /** What a level asks for, such as `Defeat 10,000 monsters`. Plain ASCII: it goes into game mail. */
  goal: (threshold: number) => string;
  /** How a value or threshold reads. Grouped digits when left out. */
  format?: (value: number) => string;
};

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

type Pick = (character: CharacterStatsRow) => number;
/** Added up across the account's characters. */
const sum = (pick: Pick) => (account: AccountStatsRow) => account.characters.reduce((total, character) => total + pick(character), 0);
/** The account's best character. */
const best = (pick: Pick) => (account: AccountStatsRow) => Math.max(0, ...account.characters.map(pick));
/** Copper added up across the account, in whole gold. */
const gold = (pick: Pick) => (account: AccountStatsRow) => Math.floor(sum(pick)(account) / COPPER_PER_GOLD);
const any = (test: (character: CharacterStatsRow) => boolean) => (account: AccountStatsRow) => (account.characters.some(test) ? 1 : 0);

const sessions = (id: string, name: string, pick: (account: AccountStatsRow) => number, when: string): AchievementFamily => ({
  id,
  name,
  category: 'playtime',
  levels: [5, 15, 40, 100, 250],
  value: pick,
  goal: (t) => `Log in ${when}, ${times(t)}`,
});

export const ACHIEVEMENTS: readonly AchievementFamily[] = [
  // Progress
  {
    id: 'level',
    name: 'Adventurer',
    category: 'progress',
    levels: [20, 40, 60, 80, 90],
    value: best(({ row }) => row.level),
    goal: (t) => `Reach level ${t}`,
  },
  {
    id: 'roster',
    name: 'Full Roster',
    category: 'progress',
    levels: [1, 2, 3, 4, 5],
    value: (account) => account.characters.filter(({ row }) => row.level >= ROSTER_LEVEL).length,
    goal: (t) => `Have ${some(t, 'a character', 'characters')} at level ${ROSTER_LEVEL}`,
  },
  {
    id: 'skills',
    name: 'Scholar',
    category: 'progress',
    // A level 89 character had 134 learned and 238 points unspent a week into the 2026 season.
    levels: [50, 100, 150, 200, 250],
    value: best((c) => c.skillLevels),
    goal: (t) => `Learn ${t} skill levels on one character`,
  },

  // Playtime
  {
    id: 'hours',
    name: 'Dedicated',
    category: 'playtime',
    levels: [10, 50, 150, 400, 1000],
    value: (account) => Math.floor(account.minutesPlayed / 60),
    goal: (t) => `Play for ${grouped(t)} hours`,
  },
  {
    id: 'days',
    name: 'Regular',
    category: 'playtime',
    levels: [3, 10, 30, 75, 150],
    value: (account) => account.daysPlayed,
    goal: (t) => `Play on ${t} different days`,
  },
  {
    id: 'streak',
    name: 'Unbroken',
    category: 'playtime',
    levels: [3, 7, 14, 30, 60],
    value: (account) => account.longestStreak,
    goal: (t) => `Play ${t} days in a row`,
  },
  {
    id: 'marathon',
    name: 'Marathon',
    category: 'playtime',
    levels: [2, 4, 6, 8, 12],
    value: (account) => Math.floor(best((c) => c.longestSessionMinutes)(account) / 60),
    goal: (t) => `Stay logged in for ${t} hours in one session`,
  },
  sessions('night-owl', 'Night Owl', (account) => account.nightSessions, 'between midnight and 5 AM'),
  sessions('early-bird', 'Early Bird', (account) => account.earlySessions, 'between 5 AM and 8 AM'),
  sessions('weekend-warrior', 'Weekend Warrior', (account) => account.weekendSessions, 'on a Saturday or Sunday'),

  // Combat
  {
    id: 'kills',
    name: 'Slayer',
    category: 'combat',
    levels: [1_000, 10_000, 50_000, 250_000, 1_000_000],
    value: sum((c) => c.kills),
    goal: (t) => `Defeat ${grouped(t)} monsters`,
  },
  {
    id: 'damage',
    name: 'Heavy Hitter',
    category: 'combat',
    levels: [1_000_000, 10_000_000, 100_000_000, 1_000_000_000, 5_000_000_000],
    value: sum((c) => c.damageDealt),
    goal: (t) => `Deal ${compact(t)} damage to monsters`,
    format: compact,
  },
  {
    id: 'damage-taken',
    name: 'Punching Bag',
    category: 'combat',
    levels: [100_000, 500_000, 2_500_000, 10_000_000, 50_000_000],
    value: sum((c) => c.damageTaken),
    goal: (t) => `Take ${compact(t)} damage`,
    format: compact,
  },
  {
    id: 'healing',
    name: 'Lifeline',
    category: 'combat',
    levels: [10_000, 100_000, 1_000_000, 10_000_000, 100_000_000],
    value: sum((c) => c.healDone),
    goal: (t) => `Heal ${compact(t)} health`,
    format: compact,
  },
  {
    id: 'bestiary',
    name: 'Explorer',
    category: 'combat',
    levels: [20, 50, 100, 150, 250],
    value: best((c) => c.monsterTypes),
    goal: (t) => `Defeat ${t} different kinds of monster on one character`,
  },
  {
    id: 'nemesis',
    name: 'Nemesis',
    category: 'combat',
    levels: [500, 2_500, 10_000, 25_000, 100_000],
    value: best((c) => c.topMonsterKills),
    goal: (t) => `Defeat one kind of monster ${grouped(t)} times on one character`,
  },
  {
    id: 'duels',
    name: 'Duellist',
    category: 'combat',
    levels: [1, 10, 25, 50, 100],
    value: sum((c) => c.duelWins),
    goal: (t) => `Win ${some(t, 'a duel', 'duels')}`,
  },

  // Gear
  {
    id: 'upgrade',
    name: 'Master Smith',
    category: 'gear',
    levels: [18, 20, 22, 23, 24],
    value: best((c) => c.highestUpgrade),
    goal: (t) => `Upgrade an item to +${t}`,
    format: plus,
  },
  {
    id: 'upgrade-successes',
    name: 'Steady Hand',
    category: 'gear',
    levels: [25, 100, 300, 1_000, 3_000],
    value: sum((c) => c.upgradesSucceeded),
    goal: (t) => `Succeed with ${grouped(t)} upgrade scrolls`,
  },
  {
    id: 'gem-successes',
    name: 'Gem Cutter',
    category: 'gear',
    levels: [50, 250, 1_000, 5_000, 20_000],
    value: sum((c) => c.gemSuccesses),
    goal: (t) => `Succeed with ${grouped(t)} gemstones`,
  },
  {
    id: 'gem-level',
    name: 'Brilliant',
    category: 'gear',
    levels: [1, 2, 3, 4, 5],
    value: best((c) => Math.max(0, ...c.gear.map((item) => item.gem))),
    goal: (t) => `Wear an item with a level ${t} gem`,
  },
  {
    id: 'glowing',
    name: 'Radiant',
    category: 'gear',
    levels: [1, 3, 5, 8, 11],
    value: best((c) => c.gear.filter((item) => item.upgrade >= GLOW_FROM_UPGRADE).length),
    goal: (t) => `Wear ${some(t, 'an item', 'items')} at +${GLOW_FROM_UPGRADE} or higher on one character`,
  },
  {
    id: 'equipped',
    name: 'Fully Geared',
    category: 'gear',
    levels: [6, 11, 15, 17, 19],
    value: best((c) => c.gear.length),
    goal: (t) => `Fill ${t} equipment slots on one character`,
  },

  // Wealth
  {
    id: 'gold-held',
    name: 'Hoarder',
    category: 'wealth',
    levels: [100, 500, 2_000, 5_000, 10_000],
    value: best(({ row }) => row.gold),
    goal: (t) => `Hold ${grouped(t)} gold on one character`,
  },
  {
    id: 'gold-looted',
    name: 'Looter',
    category: 'wealth',
    levels: [100, 1_000, 5_000, 20_000, 50_000],
    value: gold((c) => c.copperLooted),
    goal: (t) => `Loot ${grouped(t)} gold from monsters`,
  },
  {
    id: 'gold-spent',
    name: 'Big Spender',
    category: 'wealth',
    levels: [100, 1_000, 5_000, 25_000, 100_000],
    value: gold((c) => c.copperSpent),
    goal: (t) => `Spend ${grouped(t)} gold at NPCs`,
  },
  {
    id: 'lottery-plays',
    name: 'Gambler',
    category: 'wealth',
    levels: [10, 50, 250, 1_000, 5_000],
    value: sum((c) => c.lotteriesWon + c.lotteriesLost),
    goal: (t) => `Play the soul lottery ${grouped(t)} times`,
  },
  {
    id: 'lottery-wins',
    name: 'Lucky',
    category: 'wealth',
    levels: [1, 10, 50, 200, 500],
    value: sum((c) => c.lotteriesWon),
    goal: (t) => `Win the soul lottery ${times(t)}`,
  },
  {
    id: 'lottery-gold',
    name: 'Jackpot',
    category: 'wealth',
    levels: [100, 1_000, 5_000, 20_000, 50_000],
    value: gold((c) => c.lotteryCopperWon),
    goal: (t) => `Win ${grouped(t)} gold in the soul lottery`,
  },

  // Collection
  {
    id: 'titles',
    name: 'Titled',
    category: 'collection',
    levels: [3, 6, 10, 15, 25],
    value: best((c) => c.titles.length),
    goal: (t) => `Collect ${t} titles on one character`,
  },
  {
    id: 'companions',
    name: 'Pack Leader',
    category: 'collection',
    levels: [1, 2, 3, 4, 5],
    value: best((c) => c.companions.length),
    goal: (t) => `Have ${some(t, 'a companion', 'companions')} on one character`,
  },
  {
    id: 'companion-level',
    name: 'Beast Master',
    category: 'collection',
    levels: [10, 20],
    value: best((c) => c.companionLevel),
    goal: (t) => `Raise a companion to level ${t}`,
  },
  {
    id: 'pets',
    name: 'Stable Master',
    category: 'collection',
    levels: [1, 3, 5, 8, 12],
    value: (account) => account.pets,
    goal: (t) => `Own ${some(t, 'a mount or pet', 'mounts and pets')}`,
  },
  {
    id: 'classes',
    name: 'Jack of Trades',
    category: 'collection',
    levels: [2, 3, 4, 5, 6],
    value: (account) => new Set(account.characters.map(({ row }) => row.classCode)).size,
    goal: (t) => `Have characters of ${t} different classes`,
  },

  // Social
  {
    id: 'friends',
    name: 'Good Company',
    category: 'social',
    levels: [1, 2, 4, 6, 10],
    value: best((c) => c.friends),
    goal: (t) => `Have ${some(t, 'a friend', 'friends')} on one character`,
  },
  {
    id: 'guild-member',
    name: 'Guild Member',
    category: 'social',
    levels: [1],
    value: any((c) => c.inGuild),
    goal: () => 'Join a guild',
  },
  {
    id: 'guild-leader',
    name: 'Guild Leader',
    category: 'social',
    levels: [1],
    value: any((c) => c.leadsGuild),
    goal: () => 'Lead a guild',
  },

  // Misfortune
  {
    id: 'upgrade-fails',
    name: 'Cursed Anvil',
    category: 'misfortune',
    levels: [10, 100, 500, 2_000, 10_000],
    value: sum((c) => c.upgradesFailed),
    goal: (t) => `Fail ${grouped(t)} upgrade scrolls`,
  },
  {
    id: 'setbacks',
    name: 'Two Steps Back',
    category: 'misfortune',
    levels: [10, 50, 200, 1_000, 5_000],
    value: sum((c) => c.upgradeSetbacks),
    goal: (t) => `Lose item levels to a failed upgrade, ${times(t)}`,
  },
  {
    id: 'destroyed',
    name: 'Heartbreak',
    category: 'misfortune',
    levels: [1, 3, 10, 25, 50],
    value: sum((c) => c.itemsDestroyed),
    goal: (t) => `Lose ${some(t, 'an item', 'items')} to a failed upgrade`,
  },
  {
    id: 'lottery-losses',
    name: 'Unlucky',
    category: 'misfortune',
    levels: [10, 100, 500, 2_000, 10_000],
    value: sum((c) => c.lotteriesLost),
    goal: (t) => `Lose the soul lottery ${grouped(t)} times`,
  },
  {
    id: 'lose-streak',
    name: 'Cold Streak',
    category: 'misfortune',
    levels: [10, 20, 35, 50, 75],
    value: best((c) => c.longestLoseStreak),
    goal: (t) => `Lose the soul lottery ${t} times in a row`,
  },
];

export const LEVELS_TOTAL = ACHIEVEMENTS.reduce((total, family) => total + family.levels.length, 0);

/** How many of the levels `value` has passed. */
export const levelReached = (family: AchievementFamily, value: number): number =>
  family.levels.filter((threshold) => value >= threshold).length;

export const formatValue = (family: AchievementFamily, value: number): string => (family.format ?? grouped)(value);

/** Every level the account's stats reach right now, across all achievements. */
export const levelsDone = (account: AccountStatsRow): number =>
  ACHIEVEMENTS.reduce((total, family) => total + levelReached(family, family.value(account)), 0);
