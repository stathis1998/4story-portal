import type { ItemInstance, OptionRule } from './item-tooltip.js';
// How player stats are worked out, from rows the game already stores. Section 3 of the
// design defines each one. No database or clock in here: `today` is passed in.

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
export type GearRow = ItemInstance & { charId: number; slot: number; name: string | null };
export type OptionRuleRow = OptionRule & { magic: number };
export type CompanionRow = { charId: number; slot: number; name: string; level: number };
export type TitleRow = { charId: number; titleId: number; name: string };
export type AccountRow = { userId: number; username: string };
export type SocialRow = { charId: number; friends: number; inGuild: boolean; leadsGuild: boolean; duelWins: number };
export type CombatRow = { charId: number; kills: number; damageDealt: number };
export type SpendingRow = { charId: number; copper: number };
export type SoulLotteryRow = { charId: number; won: number; lost: number; copperWon: number; copperConsolation: number };
/** From the soul lottery log: the longest run of losses, and the run since the last win (0 after a win). */
export type LotteryStreakRow = { charId: number; longestLoseStreak: number; currentLoseStreak: number };
/** Upgrade log rows grouped by character, kind, level, result and day. Codes are the UPGRADELOG_* enums in TMapType.h. */
export type UpgradeAttemptRow = {
  charId: number;
  kind: number;
  level: number;
  result: number;
  /** `YYYY-MM-DD`, the server's clock. */
  day: string;
  attempts: number;
  /** The attempts' success chances added up, in percent. */
  chanceTotal: number;
};
/** An item a failed upgrade scroll destroyed. */
export type UpgradeLossRow = { charId: number; itemId: number; name: string | null; level: number; at: Date };
/** The failed upgrade counter, which started a day before the upgrade log. */
export type UpgradeFailureRow = { charId: number; failed: number };
/** Numbers only the achievements read, one row per character. */
export type ProgressRow = {
  charId: number;
  damageTaken: number;
  healDone: number;
  /** Every learned skill's level, added up. */
  skillLevels: number;
  /** Different monsters defeated at least once. */
  monsterTypes: number;
  /** Kills of the monster this character has defeated most. */
  topMonsterKills: number;
  /** The highest + a scroll has taken an item to, from the upgrade log. 0 before the log. */
  highestUpgrade: number;
  upgradesSucceeded: number;
  copperLooted: number;
};
/** Mounts and pets belong to the account. */
export type PetRow = { userId: number; pets: number };

export const UPGRADE_KIND_SCROLL = 1;
export const UPGRADE_KIND_GEM = 2;
export const UPGRADE_SUCCESS = 1;
export const UPGRADE_DESTROYED = 2;
export const UPGRADE_LOST_LEVELS = 3;
export const UPGRADE_SAVED = 4;

export type StatRows = {
  characters: CharacterRow[];
  sessions: SessionRow[];
  gear: GearRow[];
  companions: CompanionRow[];
  titles: TitleRow[];
  titlesTotal: number;
  social: SocialRow[];
  combat: CombatRow[];
  spending: SpendingRow[];
  soulLottery: SoulLotteryRow[];
  lotteryStreaks: LotteryStreakRow[];
  upgradeAttempts: UpgradeAttemptRow[];
  upgradeLosses: UpgradeLossRow[];
  upgradeFailures: UpgradeFailureRow[];
  progress: ProgressRow[];
  pets: PetRow[];
  optionRules: OptionRuleRow[];
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
  kills: number;
  damageDealt: number;
  copperSpent: number;
  lotteriesWon: number;
  lotteriesLost: number;
  lotteryCopperWon: number;
  lotteryCopperConsolation: number;
  /** Soul lottery losses in a row, from the soul lottery log. */
  longestLoseStreak: number;
  currentLoseStreak: number;
  /** Failed upgrade scrolls, from the counter. */
  upgradesFailed: number;
  /** Items lost to failed upgrade scrolls, from the upgrade log. */
  itemsDestroyed: number;
  /** Failed upgrade scrolls that cost the item levels, from the upgrade log. */
  upgradeSetbacks: number;
  gemSuccesses: number;
  damageTaken: number;
  healDone: number;
  skillLevels: number;
  monsterTypes: number;
  topMonsterKills: number;
  /** The best + reached: what is worn now, or what the upgrade log saw. */
  highestUpgrade: number;
  upgradesSucceeded: number;
  copperLooted: number;
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
  pets: number;
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
  const spending = new Map(rows.spending.map((row) => [row.charId, row.copper]));
  const combat = new Map(rows.combat.map((row) => [row.charId, row]));
  const soulLottery = new Map(rows.soulLottery.map((row) => [row.charId, row]));
  const lotteryStreaks = new Map(rows.lotteryStreaks.map((row) => [row.charId, row]));
  const upgradeFailures = new Map(rows.upgradeFailures.map((row) => [row.charId, row.failed]));
  const progress = new Map(rows.progress.map((row) => [row.charId, row]));
  const pets = new Map(rows.pets.map((row) => [row.userId, row.pets]));
  const itemsDestroyed = new Map<number, number>();
  const upgradeSetbacks = new Map<number, number>();
  const gemSuccesses = new Map<number, number>();
  const count = (counts: Map<number, number>, row: UpgradeAttemptRow) =>
    counts.set(row.charId, (counts.get(row.charId) ?? 0) + row.attempts);
  for (const row of rows.upgradeAttempts) {
    if (row.kind === UPGRADE_KIND_SCROLL && row.result === UPGRADE_DESTROYED) count(itemsDestroyed, row);
    if (row.kind === UPGRADE_KIND_SCROLL && row.result === UPGRADE_LOST_LEVELS) count(upgradeSetbacks, row);
    if (row.kind === UPGRADE_KIND_GEM && row.result === UPGRADE_SUCCESS) count(gemSuccesses, row);
  }

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
    const charProgress = progress.get(row.id);
    const bestItem = charGear.reduce<GearRow | null>((best, item) => (!best || item.upgrade > best.upgrade ? item : best), null);
    characters.set(row.id, {
      row,
      progress: levelProgress(row),
      minutesPlayed: Math.round(totalMs / MINUTE_MS),
      daysPlayed: days.size,
      longestStreak: streaks(days.keys(), today).longest,
      longestSessionMinutes: Math.round(longestMs / MINUTE_MS),
      ageDays: row.createdAt ? dayNumber(today) - dayNumber(row.createdAt.toISOString()) : null,
      gear: charGear,
      bestItem,
      companions: charCompanions,
      companionLevel: Math.max(0, ...charCompanions.map((companion) => companion.level)),
      titles: titles.get(row.id) ?? [],
      friends: social.get(row.id)?.friends ?? 0,
      inGuild: social.get(row.id)?.inGuild ?? false,
      leadsGuild: social.get(row.id)?.leadsGuild ?? false,
      duelWins: social.get(row.id)?.duelWins ?? 0,
      kills: combat.get(row.id)?.kills ?? 0,
      damageDealt: combat.get(row.id)?.damageDealt ?? 0,
      copperSpent: spending.get(row.id) ?? 0,
      lotteriesWon: soulLottery.get(row.id)?.won ?? 0,
      lotteriesLost: soulLottery.get(row.id)?.lost ?? 0,
      lotteryCopperWon: soulLottery.get(row.id)?.copperWon ?? 0,
      lotteryCopperConsolation: soulLottery.get(row.id)?.copperConsolation ?? 0,
      longestLoseStreak: lotteryStreaks.get(row.id)?.longestLoseStreak ?? 0,
      currentLoseStreak: lotteryStreaks.get(row.id)?.currentLoseStreak ?? 0,
      upgradesFailed: upgradeFailures.get(row.id) ?? 0,
      itemsDestroyed: itemsDestroyed.get(row.id) ?? 0,
      upgradeSetbacks: upgradeSetbacks.get(row.id) ?? 0,
      gemSuccesses: gemSuccesses.get(row.id) ?? 0,
      damageTaken: charProgress?.damageTaken ?? 0,
      healDone: charProgress?.healDone ?? 0,
      skillLevels: charProgress?.skillLevels ?? 0,
      monsterTypes: charProgress?.monsterTypes ?? 0,
      topMonsterKills: charProgress?.topMonsterKills ?? 0,
      highestUpgrade: Math.max(bestItem?.upgrade ?? 0, charProgress?.highestUpgrade ?? 0),
      upgradesSucceeded: charProgress?.upgradesSucceeded ?? 0,
      copperLooted: charProgress?.copperLooted ?? 0,
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
      pets: pets.get(userId) ?? 0,
      activity: [...days.entries()]
        .filter(([date]) => dayNumber(date) > oldestDay)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, ms]) => ({ date, minutes: Math.round(ms / MINUTE_MS) })),
    });
  }

  return { today, titlesTotal: rows.titlesTotal, characters, accounts };
}

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
