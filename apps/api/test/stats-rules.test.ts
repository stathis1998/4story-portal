import { describe, expect, it } from 'vitest';
import {
  type CharacterRow,
  type ComputedStats,
  computeStats,
  rankCategory,
  type SessionRow,
  type StatRows,
} from '../src/stats/stats-rules.js';

const at = (value: string) => new Date(`${value}Z`);

const character = (overrides: Partial<CharacterRow> = {}): CharacterRow => ({
  id: 1,
  userId: 10,
  name: 'Kaelith',
  classCode: 0,
  raceCode: 0,
  countryCode: 0,
  level: 50,
  exp: 4017739,
  levelStartExp: 3923253,
  levelEndExp: 4168638,
  gold: 0,
  createdAt: at('2026-01-01T00:00:00'),
  banned: false,
  ...overrides,
});

const session = (login: string, logout: string | null, charId = 1): SessionRow => ({
  charId,
  login: at(login),
  logout: logout === null ? null : at(logout),
});

const rows = (overrides: Partial<StatRows> = {}): StatRows => ({
  characters: [character()],
  sessions: [],
  gear: [],
  optionRules: [],
  companions: [],
  titles: [],
  titlesTotal: 110,
  social: [],
  combat: [],
  spending: [],
  soulLottery: [], lotteryStreaks: [], upgradeAttempts: [], upgradeLosses: [], upgradeFailures: [], progress: [], pets: [],
  accounts: [{ userId: 10, username: 'friend' }],
  ...overrides,
});

const TODAY = '2026-11-01';
const compute = (overrides: Partial<StatRows> = {}): ComputedStats => computeStats(rows(overrides), TODAY);
const char = (stats: ComputedStats, id = 1) => stats.characters.get(id)!;
const account = (stats: ComputedStats, id = 10) => stats.accounts.get(id)!;

describe('hours played', () => {
  it('adds up sessions', () => {
    const stats = compute({
      sessions: [session('2026-10-01T10:00:00', '2026-10-01T11:30:00'), session('2026-10-02T10:00:00', '2026-10-02T11:00:00')],
    });
    expect(char(stats).minutesPlayed).toBe(150);
  });

  it('counts at most 12 hours of a session left running', () => {
    const stats = compute({ sessions: [session('2026-10-01T10:00:00', '2026-10-16T10:00:00')] });
    expect(char(stats).minutesPlayed).toBe(720);
    expect(char(stats).longestSessionMinutes).toBe(720);
  });

  it('ignores a session still open', () => {
    expect(char(compute({ sessions: [session('2026-10-01T10:00:00', null)] })).minutesPlayed).toBe(0);
  });

  it('ignores a session whose logout is not after its login', () => {
    expect(char(compute({ sessions: [session('2026-10-01T10:00:00', '2026-10-01T10:00:00')] })).minutesPlayed).toBe(0);
  });

  it('ignores old log rows from before the character existed', () => {
    const stats = compute({ sessions: [session('2013-01-09T08:00:00', '2013-01-09T09:00:00')] });
    expect(char(stats).minutesPlayed).toBe(0);
  });

  it('keeps a session in the minute the character was created, because log times are cut to the minute', () => {
    const created = at('2026-01-01T10:30:45');
    const stats = compute({
      characters: [character({ createdAt: created })],
      sessions: [session('2026-01-01T10:30:00', '2026-01-01T11:30:00'), session('2026-01-01T10:29:00', '2026-01-01T10:30:00')],
    });
    expect(char(stats).minutesPlayed).toBe(60);
  });

  it('gives zeros to a character with no sessions', () => {
    const stats = compute();
    expect(char(stats)).toMatchObject({ minutesPlayed: 0, daysPlayed: 0, longestStreak: 0, longestSessionMinutes: 0 });
    expect(account(stats)).toMatchObject({ minutesPlayed: 0, daysPlayed: 0, currentStreak: 0, longestStreak: 0 });
  });

  it('keeps a character with no creation date', () => {
    const stats = compute({
      characters: [character({ createdAt: null })],
      sessions: [session('2026-10-01T10:00:00', '2026-10-01T11:00:00')],
    });
    expect(char(stats)).toMatchObject({ minutesPlayed: 60, ageDays: null });
  });
});

describe('days and activity', () => {
  it('counts both days of a session crossing midnight, splitting the minutes', () => {
    const stats = compute({ sessions: [session('2026-10-01T23:30:00', '2026-10-02T00:45:00')] });
    expect(char(stats).daysPlayed).toBe(2);
    expect(account(stats).activity).toEqual([
      { date: '2026-10-01', minutes: 30 },
      { date: '2026-10-02', minutes: 45 },
    ]);
  });

  it('does not count days an idle session only ran on after its 12 hours', () => {
    const stats = compute({ sessions: [session('2026-10-01T10:00:00', '2026-10-16T10:00:00')] });
    expect(char(stats).daysPlayed).toBe(1);
  });

  it('counts a date once across sessions and characters', () => {
    const stats = compute({
      characters: [character(), character({ id: 2, name: 'Second' })],
      sessions: [session('2026-10-01T10:00:00', '2026-10-01T11:00:00', 1), session('2026-10-01T12:00:00', '2026-10-01T13:00:00', 2)],
    });
    expect(account(stats).daysPlayed).toBe(1);
    expect(account(stats).minutesPlayed).toBe(120);
    expect(account(stats).activity).toEqual([{ date: '2026-10-01', minutes: 120 }]);
  });

  it('keeps only the last year in the activity', () => {
    const stats = compute({
      characters: [character({ createdAt: at('2024-01-01T00:00:00') })],
      sessions: [session('2025-01-01T10:00:00', '2025-01-01T11:00:00'), session('2026-10-01T10:00:00', '2026-10-01T11:00:00')],
    });
    expect(account(stats).activity).toEqual([{ date: '2026-10-01', minutes: 60 }]);
    expect(account(stats).daysPlayed).toBe(2);
  });
});

describe('streaks', () => {
  const days = (...dates: string[]) => dates.map((date) => session(`${date}T10:00:00`, `${date}T11:00:00`));

  it('runs on to today', () => {
    expect(account(compute({ sessions: days('2026-10-30', '2026-10-31', '2026-11-01') })).currentStreak).toBe(3);
  });

  it('still counts when the last day was yesterday', () => {
    expect(account(compute({ sessions: days('2026-10-30', '2026-10-31') })).currentStreak).toBe(2);
  });

  it('is over after a missed day', () => {
    const stats = account(compute({ sessions: days('2026-10-29', '2026-10-30') }));
    expect(stats.currentStreak).toBe(0);
    expect(stats.longestStreak).toBe(2);
  });

  it('finds the longest run across a month end', () => {
    const stats = compute({ sessions: days('2026-08-31', '2026-09-01', '2026-09-02', '2026-09-20') });
    expect(char(stats).longestStreak).toBe(3);
  });

  it('combines characters for the account streak', () => {
    const stats = compute({
      characters: [character(), character({ id: 2, name: 'Second' })],
      sessions: [session('2026-10-30T10:00:00', '2026-10-30T11:00:00', 1), session('2026-10-31T10:00:00', '2026-10-31T11:00:00', 2)],
    });
    expect(account(stats).longestStreak).toBe(2);
    expect(char(stats, 1).longestStreak).toBe(1);
  });
});

describe('level progress', () => {
  it('measures the way through the current level', () => {
    const stats = compute({ characters: [character({ exp: 150, levelStartExp: 100, levelEndExp: 200 })] });
    expect(char(stats).progress).toBe(0.5);
  });

  it('is null with no chart row', () => {
    expect(char(compute({ characters: [character({ levelEndExp: null })] })).progress).toBeNull();
  });

  it('treats a missing previous level as starting from 0', () => {
    const stats = compute({ characters: [character({ exp: 50, levelStartExp: null, levelEndExp: 200 })] });
    expect(char(stats).progress).toBe(0.25);
  });

  it('stays between 0 and 1 for odd data', () => {
    expect(char(compute({ characters: [character({ exp: 500, levelStartExp: 100, levelEndExp: 200 })] })).progress).toBe(1);
    expect(char(compute({ characters: [character({ exp: 50, levelStartExp: 100, levelEndExp: 200 })] })).progress).toBe(0);
    expect(char(compute({ characters: [character({ exp: 50, levelStartExp: 200, levelEndExp: 200 })] })).progress).toBeNull();
  });
});

describe('rankCategory', () => {
  const candidates = (...values: [string, number][]) => values.map(([key, value]) => ({ key, name: key, value }));

  it('shares a place on a tie and skips the next', () => {
    const ranked = rankCategory(candidates(['a', 5], ['b', 9], ['c', 9], ['d', 1]));
    expect(ranked.map(({ key, place }) => [key, place])).toEqual([
      ['b', 1],
      ['c', 1],
      ['a', 3],
      ['d', 4],
    ]);
  });

  it('drops zeros', () => {
    expect(rankCategory(candidates(['a', 0], ['b', 1])).map(({ key }) => key)).toEqual(['b']);
  });

  it('sorts a tie by name', () => {
    const ranked = rankCategory([
      { key: 1, name: 'Zed', value: 3 },
      { key: 2, name: 'Amy', value: 3 },
    ]);
    expect(ranked.map(({ name }) => name)).toEqual(['Amy', 'Zed']);
  });
});
