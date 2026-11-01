import { describe, expect, it } from 'vitest';
import {
  type CharacterRow,
  type ComputedStats,
  computeStats,
  earnedBadges,
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
  companions: [],
  titles: [],
  titlesTotal: 110,
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

describe('badges', () => {
  const earned = (overrides: Partial<StatRows>) => earnedBadges(account(compute(overrides)));

  it.each([
    [9, []],
    [10, ['level-10']],
    [24, ['level-10']],
    [25, ['level-10', 'level-25']],
    [90, ['level-10', 'level-25', 'level-50', 'level-75', 'level-90']],
  ])('at level %i', (level, expected) => {
    const badges = earned({ characters: [character({ level })] }).filter((id) => id.startsWith('level-'));
    expect(badges).toEqual(expected);
  });

  const hours = (count: number) => {
    const sessions: SessionRow[] = [];
    for (let day = 0; day < Math.ceil(count / 12); day++) {
      const date = new Date(Date.UTC(2026, 0, 2 + day * 2)).toISOString().slice(0, 10);
      const length = Math.min(12, count - day * 12);
      sessions.push(session(`${date}T06:00:00`, `${date}T${String(6 + length).padStart(2, '0')}:00:00`));
    }
    return sessions;
  };

  it('gives hour badges at their thresholds, using capped time', () => {
    expect(earned({ sessions: hours(9) }).filter((id) => id.startsWith('hours-'))).toEqual([]);
    expect(earned({ sessions: hours(10) }).filter((id) => id.startsWith('hours-'))).toEqual(['hours-10']);
    expect(earned({ sessions: hours(50) }).filter((id) => id.startsWith('hours-'))).toEqual(['hours-10', 'hours-50']);
    expect(earned({ sessions: [session('2026-10-01T10:00:00', '2026-11-01T10:00:00')] })).not.toContain('hours-50');
  });

  it('gives streak badges', () => {
    const run = (length: number) =>
      Array.from({ length }, (_, i) => {
        const date = new Date(Date.UTC(2026, 5, 1 + i)).toISOString().slice(0, 10);
        return session(`${date}T10:00:00`, `${date}T11:00:00`);
      });
    expect(earned({ sessions: run(6) })).not.toContain('streak-7');
    expect(earned({ sessions: run(7) })).toContain('streak-7');
    expect(earned({ sessions: run(30) })).toContain('streak-30');
  });

  it('gives Night Owl for 10 sessions starting before 05:00', () => {
    const nights = (time: string, count: number) =>
      Array.from({ length: count }, (_, i) => {
        const date = new Date(Date.UTC(2026, 5, 1 + i)).toISOString().slice(0, 10);
        return session(`${date}T${time}:00`, `${date}T${time.slice(0, 2)}:59:30`);
      });
    expect(earned({ sessions: nights('04:59', 9) })).not.toContain('night-owl');
    expect(earned({ sessions: nights('04:59', 10) })).toContain('night-owl');
    expect(earned({ sessions: nights('05:00', 10) })).not.toContain('night-owl');
  });

  it('gives Veteran to a character at least a year old', () => {
    expect(earned({ characters: [character({ createdAt: at('2025-11-02T00:00:00') })] })).not.toContain('veteran');
    expect(earned({ characters: [character({ createdAt: at('2025-11-01T00:00:00') })] })).toContain('veteran');
  });

  const item = (slot: number, upgrade = 0, charId = 1) => ({ charId, slot, itemId: 100 + slot, name: `Item ${slot}`, upgrade });

  it('gives upgrade badges from equipped items', () => {
    expect(earned({ gear: [item(0, 9)] }).filter((id) => id.startsWith('upgrade-'))).toEqual([]);
    expect(earned({ gear: [item(0, 15)] }).filter((id) => id.startsWith('upgrade-'))).toEqual(['upgrade-10', 'upgrade-15']);
  });

  it('gives Fully Geared only with all six main slots on one character', () => {
    const main = [0, 3, 5, 6, 7, 8];
    expect(earned({ gear: main.slice(1).map((slot) => item(slot)) })).not.toContain('geared');
    expect(earned({ gear: main.map((slot) => item(slot)) })).toContain('geared');
    const split = main.map((slot, i) => item(slot, 0, i < 3 ? 1 : 2));
    expect(earned({ characters: [character(), character({ id: 2, name: 'Second' })], gear: split })).not.toContain('geared');
  });

  it('gives title badges by the character with the most', () => {
    const titles = (count: number) => Array.from({ length: count }, (_, i) => ({ charId: 1, titleId: i + 1, name: `Title ${i}` }));
    expect(earned({ titles: titles(4) })).not.toContain('titles-5');
    expect(earned({ titles: titles(5) })).toContain('titles-5');
    expect(earned({ titles: titles(10) })).toContain('titles-10');
  });

  it('gives Beast Master for a level 20 companion', () => {
    const pet = (level: number) => [{ charId: 1, slot: 0, name: 'Rex', level }];
    expect(earned({ companions: pet(19) })).not.toContain('companion-20');
    expect(earned({ companions: pet(20) })).toContain('companion-20');
  });

  it('gives Treasure Hoard for 1,000 gold on one character', () => {
    expect(earned({ characters: [character({ gold: 999 })] })).not.toContain('wealth-1000');
    expect(earned({ characters: [character({ gold: 1000 })] })).toContain('wealth-1000');
    const split = [character({ gold: 600 }), character({ id: 2, name: 'Second', gold: 600 })];
    expect(earned({ characters: split })).not.toContain('wealth-1000');
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
