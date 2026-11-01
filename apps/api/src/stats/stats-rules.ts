// How player stats and badges are worked out, from rows the game already stores. Section 3 of the
// design defines each one. No database or clock in here: `today` is passed in.

import type { BadgeCategoryId } from '@4story-portal/shared';

export type CharacterRow = {
  id: number;
  userId: number;
  name: string;
  classCode: number;
  raceCode: number;
  countryCode: number;
  level: number;
  exp: number;
  /** Where this level starts in the chart. Null when the chart has no such row. */
  levelStartExp: number | null;
  /** Where this level ends in the chart. Null when the chart has no such row. */
  levelEndExp: number | null;
  gold: number;
  createdAt: Date | null;
  banned: boolean;
};

// The game's times are server local, and the driver returns them as if they were UTC, so getUTC*
// reads the wall clock.
export type SessionRow = { charId: number; login: Date; logout: Date | null };
export type GearRow = { charId: number; slot: number; itemId: number; name: string | null; upgrade: number };
export type CompanionRow = { charId: number; slot: number; name: string; level: number };
export type TitleRow = { charId: number; titleId: number; name: string };
export type AccountRow = { userId: number; username: string };
export type SocialRow = { charId: number; friends: number; inGuild: boolean; leadsGuild: boolean; duelWins: number };

export type StatRows = {
  characters: CharacterRow[];
  sessions: SessionRow[];
  gear: GearRow[];
  companions: CompanionRow[];
  titles: TitleRow[];
  titlesTotal: number;
  social: SocialRow[];
  accounts: AccountRow[];
};

export type CharacterStatsRow = {
  row: CharacterRow;
  progress: number | null;
  minutesPlayed: number;
  daysPlayed: number;
  longestStreak: number;
  longestSessionMinutes: number;
  ageDays: number | null;
  gear: GearRow[];
  bestItem: GearRow | null;
  companions: CompanionRow[];
  companionLevel: number;
  titles: TitleRow[];
  friends: number;
  inGuild: boolean;
  leadsGuild: boolean;
  duelWins: number;
};

export type AccountStatsRow = {
  userId: number;
  username: string | null;
  characters: CharacterStatsRow[];
  minutesPlayed: number;
  daysPlayed: number;
  currentStreak: number;
  longestStreak: number;
  nightSessions: number;
  earlySessions: number;
  weekendSessions: number;
  activity: { date: string; minutes: number }[];
};

export type ComputedStats = {
  today: string;
  titlesTotal: number;
  characters: Map<number, CharacterStatsRow>;
  accounts: Map<number, AccountStatsRow>;
};

// A session left running for days would otherwise bury everyone else's hours.
const MAX_SESSION_MS = 12 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const NIGHT_ENDS_AT_HOUR = 5;
const EARLY_ENDS_AT_HOUR = 8;
const SUNDAY = 0;
const SATURDAY = 6;
// The 53-week calendar, so a full year always fits.
const ACTIVITY_DAYS = 53 * 7;
// Main weapon, head, body, pants, feet and hands (ES_* in NetCode.h).
const MAIN_GEAR_SLOTS = [0, 3, 5, 6, 7, 8];
// Neck, both rings and both earrings.
const JEWELLERY_SLOTS = [9, 10, 11, 12, 13];
// Hat, dress, accessory and race.
const COSTUME_SLOTS = [15, 16, 17, 18];

const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayNumber = (key: string) => Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10))) / DAY_MS;

type CountedSession = { startMs: number; endMs: number };

/** The part of a session that counts, or null if none does. */
function countedSession(session: SessionRow, createdAt: Date | null): CountedSession | null {
  if (!session.logout) return null;
  const startMs = session.login.getTime();
  const logoutMs = session.logout.getTime();
  if (logoutMs <= startMs) return null;
  // Log times are cut to the minute, so a session in the creation minute can look slightly early.
  if (createdAt && startMs < Math.floor(createdAt.getTime() / MINUTE_MS) * MINUTE_MS) return null;
  return { startMs, endMs: Math.min(logoutMs, startMs + MAX_SESSION_MS) };
}

/** Adds each calendar day the session touches, with its share of the session. */
function addDays(days: Map<string, number>, { startMs, endMs }: CountedSession): void {
  let cursor = startMs;
  while (cursor < endMs) {
    const nextMidnight = (Math.floor(cursor / DAY_MS) + 1) * DAY_MS;
    const until = Math.min(nextMidnight, endMs);
    const key = dayKey(cursor);
    days.set(key, (days.get(key) ?? 0) + until - cursor);
    cursor = until;
  }
}

function streaks(days: Iterable<string>, today: string): { current: number; longest: number } {
  const numbers = [...days].map(dayNumber).sort((a, b) => a - b);
  let longest = 0;
  let run = 0;
  let previous: number | null = null;
  for (const day of numbers) {
    run = previous !== null && day === previous + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = day;
  }
  // The last run still counts if it reaches today or yesterday: today may just not have started.
  const current = previous !== null && previous >= dayNumber(today) - 1 ? run : 0;
  return { current, longest };
}

function levelProgress({ exp, levelStartExp, levelEndExp }: CharacterRow): number | null {
  if (levelEndExp === null) return null;
  const start = levelStartExp ?? 0;
  if (levelEndExp <= start) return null;
  return Math.min(1, Math.max(0, (exp - start) / (levelEndExp - start)));
}

function groupBy<T>(items: T[], key: (item: T) => number): Map<number, T[]> {
  const groups = new Map<number, T[]>();
  for (const item of items) {
    const group = groups.get(key(item));
    if (group) group.push(item);
    else groups.set(key(item), [item]);
  }
  return groups;
}

export function computeStats(rows: StatRows, today: string): ComputedStats {
  const sessions = groupBy(rows.sessions, (session) => session.charId);
  const gear = groupBy(rows.gear, (item) => item.charId);
  const companions = groupBy(rows.companions, (companion) => companion.charId);
  const titles = groupBy(rows.titles, (title) => title.charId);
  const social = new Map(rows.social.map((row) => [row.charId, row]));

  const characters = new Map<number, CharacterStatsRow>();
  const accountDays = new Map<number, Map<string, number>>();
  const accountMs = new Map<number, number>();
  const accountNights = new Map<number, number>();
  const accountEarly = new Map<number, number>();
  const accountWeekend = new Map<number, number>();
  const addTo = (counts: Map<number, number>, userId: number) => counts.set(userId, (counts.get(userId) ?? 0) + 1);

  for (const row of rows.characters) {
    const days = new Map<string, number>();
    const shared = accountDays.get(row.userId) ?? new Map<string, number>();
    accountDays.set(row.userId, shared);
    let totalMs = 0;
    let longestMs = 0;
    for (const session of sessions.get(row.id) ?? []) {
      const counted = countedSession(session, row.createdAt);
      if (!counted) continue;
      const length = counted.endMs - counted.startMs;
      totalMs += length;
      longestMs = Math.max(longestMs, length);
      addDays(days, counted);
      addDays(shared, counted);
      const hour = session.login.getUTCHours();
      const weekday = session.login.getUTCDay();
      if (hour < NIGHT_ENDS_AT_HOUR) addTo(accountNights, row.userId);
      else if (hour < EARLY_ENDS_AT_HOUR) addTo(accountEarly, row.userId);
      if (weekday === SATURDAY || weekday === SUNDAY) addTo(accountWeekend, row.userId);
    }
    accountMs.set(row.userId, (accountMs.get(row.userId) ?? 0) + totalMs);

    const charGear = gear.get(row.id) ?? [];
    const charCompanions = companions.get(row.id) ?? [];
    characters.set(row.id, {
      row,
      progress: levelProgress(row),
      minutesPlayed: Math.round(totalMs / MINUTE_MS),
      daysPlayed: days.size,
      longestStreak: streaks(days.keys(), today).longest,
      longestSessionMinutes: Math.round(longestMs / MINUTE_MS),
      ageDays: row.createdAt ? dayNumber(today) - dayNumber(row.createdAt.toISOString()) : null,
      gear: charGear,
      bestItem: charGear.reduce<GearRow | null>((best, item) => (!best || item.upgrade > best.upgrade ? item : best), null),
      companions: charCompanions,
      companionLevel: Math.max(0, ...charCompanions.map((companion) => companion.level)),
      titles: titles.get(row.id) ?? [],
      friends: social.get(row.id)?.friends ?? 0,
      inGuild: social.get(row.id)?.inGuild ?? false,
      leadsGuild: social.get(row.id)?.leadsGuild ?? false,
      duelWins: social.get(row.id)?.duelWins ?? 0,
    });
  }

  const usernames = new Map(rows.accounts.map((account) => [account.userId, account.username]));
  const accounts = new Map<number, AccountStatsRow>();
  const oldestDay = dayNumber(today) - ACTIVITY_DAYS;
  for (const [userId, chars] of groupBy([...characters.values()], (character) => character.row.userId)) {
    const days = accountDays.get(userId) ?? new Map<string, number>();
    const { current, longest } = streaks(days.keys(), today);
    accounts.set(userId, {
      userId,
      username: usernames.get(userId) ?? null,
      characters: chars,
      minutesPlayed: Math.round((accountMs.get(userId) ?? 0) / MINUTE_MS),
      daysPlayed: days.size,
      currentStreak: current,
      longestStreak: longest,
      nightSessions: accountNights.get(userId) ?? 0,
      earlySessions: accountEarly.get(userId) ?? 0,
      weekendSessions: accountWeekend.get(userId) ?? 0,
      activity: [...days.entries()]
        .filter(([date]) => dayNumber(date) > oldestDay)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, ms]) => ({ date, minutes: Math.round(ms / MINUTE_MS) })),
    });
  }

  return { today, titlesTotal: rows.titlesTotal, characters, accounts };
}

export type BadgeDefinition = {
  id: string;
  name: string;
  description: string;
  category: BadgeCategoryId;
  earned: (account: AccountStatsRow) => boolean;
};

export type ComingSoonBadge = Omit<BadgeDefinition, 'earned'>;

const anyCharacter = (test: (character: CharacterStatsRow) => boolean) => (account: AccountStatsRow) =>
  account.characters.some(test);

const hasSlots = (character: CharacterStatsRow, slots: number[]) =>
  slots.every((slot) => character.gear.some((item) => item.slot === slot));

const levelBadge = (level: number): BadgeDefinition => ({
  id: `level-${level}`,
  name: `Level ${level}`,
  description: `Reach level ${level}`,
  category: 'progress',
  earned: anyCharacter(({ row }) => row.level >= level),
});

const hoursBadge = (hours: number): BadgeDefinition => ({
  id: `hours-${hours}`,
  name: `${hours} Hours`,
  description: `Play for ${hours} hours across your characters`,
  category: 'playtime',
  earned: (account) => account.minutesPlayed >= hours * 60,
});

const daysBadge = (days: number): BadgeDefinition => ({
  id: `days-${days}`,
  name: `${days} Days Played`,
  description: `Play on ${days} different days`,
  category: 'playtime',
  earned: (account) => account.daysPlayed >= days,
});

const streakBadge = (days: number): BadgeDefinition => ({
  id: `streak-${days}`,
  name: `${days} Day Streak`,
  description: `Play ${days} days in a row`,
  category: 'playtime',
  earned: (account) => account.longestStreak >= days,
});

const upgradeBadge = (upgrade: number): BadgeDefinition => ({
  id: `upgrade-${upgrade}`,
  name: `+${upgrade} Item`,
  description: `Equip an item upgraded to +${upgrade}`,
  category: 'gear',
  earned: anyCharacter(({ bestItem }) => (bestItem?.upgrade ?? 0) >= upgrade),
});

const titlesBadge = (count: number): BadgeDefinition => ({
  id: `titles-${count}`,
  name: `${count} Titles`,
  description: `Collect ${count} titles on one character`,
  category: 'collection',
  earned: anyCharacter(({ titles }) => titles.length >= count),
});

const classesBadge = (id: string, name: string, count: number, description: string): BadgeDefinition => ({
  id,
  name,
  description,
  category: 'collection',
  earned: (account) => new Set(account.characters.map(({ row }) => row.classCode)).size >= count,
});

const wealthBadge = (id: string, name: string, gold: number): BadgeDefinition => ({
  id,
  name,
  description: `Hold ${gold.toLocaleString('en-US')} gold on one character`,
  category: 'collection',
  earned: anyCharacter(({ row }) => row.gold >= gold),
});

const duelsBadge = (wins: number, name: string): BadgeDefinition => ({
  id: `duels-${wins}`,
  name,
  description: wins === 1 ? 'Win a duel' : `Win ${wins} duels across your characters`,
  category: 'social',
  earned: (account) => account.characters.reduce((total, { duelWins }) => total + duelWins, 0) >= wins,
});

export const BADGES: readonly BadgeDefinition[] = [
  ...[10, 25, 50, 75, 90].map(levelBadge),
  {
    id: 'level-50-x3',
    name: 'Three of a Kind',
    description: 'Have three characters at level 50',
    category: 'progress',
    earned: (account) => account.characters.filter(({ row }) => row.level >= 50).length >= 3,
  },

  ...[10, 50, 100, 500].map(hoursBadge),
  ...[7, 30, 100].map(daysBadge),
  ...[3, 7, 30].map(streakBadge),
  {
    id: 'night-owl',
    name: 'Night Owl',
    description: 'Log in between midnight and 5 AM, 10 times',
    category: 'playtime',
    earned: (account) => account.nightSessions >= 10,
  },
  {
    id: 'early-bird',
    name: 'Early Bird',
    description: 'Log in between 5 AM and 8 AM, 10 times',
    category: 'playtime',
    earned: (account) => account.earlySessions >= 10,
  },
  {
    id: 'weekend-warrior',
    name: 'Weekend Warrior',
    description: 'Log in on a Saturday or Sunday, 10 times',
    category: 'playtime',
    earned: (account) => account.weekendSessions >= 10,
  },
  {
    id: 'marathon',
    name: 'Marathon',
    description: 'Stay logged in for 8 hours in one session',
    category: 'playtime',
    earned: anyCharacter(({ longestSessionMinutes }) => longestSessionMinutes >= 8 * 60),
  },
  {
    id: 'veteran',
    name: 'Veteran',
    description: 'Have a character at least a year old',
    category: 'playtime',
    earned: anyCharacter(({ ageDays }) => (ageDays ?? 0) >= 365),
  },

  ...[10, 15, 20].map(upgradeBadge),
  {
    id: 'geared',
    name: 'Fully Geared',
    description: 'Equip a main weapon, head, body, pants, feet and hands on one character',
    category: 'gear',
    earned: anyCharacter((character) => hasSlots(character, MAIN_GEAR_SLOTS)),
  },
  {
    id: 'jeweller',
    name: 'Fully Jewelled',
    description: 'Equip a necklace, two rings and two earrings on one character',
    category: 'gear',
    earned: anyCharacter((character) => hasSlots(character, JEWELLERY_SLOTS)),
  },
  {
    id: 'dressed-up',
    name: 'Dressed Up',
    description: 'Equip a costume item',
    category: 'gear',
    earned: anyCharacter(({ gear }) => gear.some((item) => COSTUME_SLOTS.includes(item.slot))),
  },

  ...[5, 10, 25].map(titlesBadge),
  {
    id: 'companion-first',
    name: 'New Best Friend',
    description: 'Get a companion',
    category: 'collection',
    earned: anyCharacter(({ companions }) => companions.length >= 1),
  },
  {
    id: 'companion-20',
    name: 'Beast Master',
    description: 'Raise a companion to level 20',
    category: 'collection',
    earned: anyCharacter(({ companionLevel }) => companionLevel >= 20),
  },
  {
    id: 'companion-5',
    name: 'Full Pack',
    description: 'Have 5 companions on one character',
    category: 'collection',
    earned: anyCharacter(({ companions }) => companions.length >= 5),
  },
  classesBadge('classes-3', 'Jack of Trades', 3, 'Have characters of 3 different classes'),
  classesBadge('classes-6', 'Master of All', 6, 'Have a character of every class'),
  {
    id: 'races-3',
    name: 'World Traveller',
    description: 'Have a character of every race',
    category: 'collection',
    earned: (account) => new Set(account.characters.map(({ row }) => row.raceCode)).size >= 3,
  },
  wealthBadge('wealth-100', 'Pocket Money', 100),
  wealthBadge('wealth-1000', 'Treasure Hoard', 1000),
  wealthBadge('wealth-10000', 'Dragon Hoard', 10000),

  {
    id: 'friends-1',
    name: 'First Friend',
    description: 'Add a friend',
    category: 'social',
    earned: anyCharacter(({ friends }) => friends >= 1),
  },
  {
    id: 'friends-5',
    name: 'Good Company',
    description: 'Have 5 friends on one character',
    category: 'social',
    earned: anyCharacter(({ friends }) => friends >= 5),
  },
  {
    id: 'guild-member',
    name: 'Guild Member',
    description: 'Join a guild',
    category: 'social',
    earned: anyCharacter(({ inGuild }) => inGuild),
  },
  {
    id: 'guild-leader',
    name: 'Guild Leader',
    description: 'Lead a guild',
    category: 'social',
    earned: anyCharacter(({ leadsGuild }) => leadsGuild),
  },
  duelsBadge(1, 'First Blood'),
  duelsBadge(10, 'Duellist'),
  duelsBadge(50, 'Champion'),
];

// Shown but not earnable: the game doesn't record these. Most of TMapSvr's log calls are commented
// out, including LogUserDie and LogItemUpgrade.
export const COMING_SOON_BADGES: readonly ComingSoonBadge[] = [
  { id: 'quests-10', name: 'Helping Hand', description: 'Finish 10 quests', category: 'progress' },
  { id: 'quests-100', name: 'Adventurer', description: 'Finish 100 quests', category: 'progress' },
  { id: 'quests-500', name: 'Living Legend', description: 'Finish 500 quests', category: 'progress' },

  { id: 'kills-100', name: 'Hunter', description: 'Defeat 100 monsters', category: 'combat' },
  { id: 'kills-1000', name: 'Slayer', description: 'Defeat 1,000 monsters', category: 'combat' },
  { id: 'kills-10000', name: 'Exterminator', description: 'Defeat 10,000 monsters', category: 'combat' },
  { id: 'bosses-1', name: 'Giant Killer', description: 'Defeat a boss', category: 'combat' },
  { id: 'bosses-10', name: 'Boss Slayer', description: 'Defeat 10 bosses', category: 'combat' },

  { id: 'deaths-1', name: 'Ouch', description: 'Die for the first time', category: 'misfortune' },
  { id: 'deaths-100', name: 'Back Again', description: 'Die 100 times', category: 'misfortune' },
  { id: 'deaths-1000', name: 'Death Is a Habit', description: 'Die 1,000 times', category: 'misfortune' },
  { id: 'failed-upgrades-1', name: 'Bad Luck', description: 'Fail an upgrade', category: 'misfortune' },
  { id: 'failed-upgrades-10', name: 'Cursed Anvil', description: 'Fail 10 upgrades', category: 'misfortune' },
  { id: 'failed-upgrades-100', name: 'Why Do I Keep Trying', description: 'Fail 100 upgrades', category: 'misfortune' },
  { id: 'destroyed-1', name: 'Gone', description: 'Lose an item to a failed upgrade', category: 'misfortune' },
  { id: 'destroyed-10', name: 'Heartbreak', description: 'Lose 10 items to failed upgrades', category: 'misfortune' },
];

export const earnedBadges = (account: AccountStatsRow): string[] =>
  BADGES.filter((badge) => badge.earned(account)).map((badge) => badge.id);

export type RankCandidate<K> = { key: K; name: string; value: number };
export type Ranked<K> = RankCandidate<K> & { place: number };

/** Best first, without zeros. A tie shares a place and the next place is skipped: 1, 1, 3. */
export function rankCategory<K>(candidates: RankCandidate<K>[]): Ranked<K>[] {
  const sorted = candidates
    .filter((candidate) => candidate.value > 0)
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  const ranked: Ranked<K>[] = [];
  sorted.forEach((candidate, i) => {
    const previous = ranked[i - 1];
    ranked.push({ ...candidate, place: previous && previous.value === candidate.value ? previous.place : i + 1 });
  });
  return ranked;
}
