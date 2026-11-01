import { describe, expect, it } from 'vitest';
import {
  BADGES,
  type CharacterRow,
  COMING_SOON_BADGES,
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
  social: [],
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

describe('achievement categories', () => {
  const earned = (overrides: Partial<StatRows>) => earnedBadges(account(compute(overrides)));
  const social = (overrides: Partial<StatRows['social'][number]> = {}) => ({
    charId: 1,
    friends: 0,
    inGuild: false,
    leadsGuild: false,
    duelWins: 0,
    ...overrides,
  });

  it('files every achievement under a category', () => {
    const count = (category: string) => BADGES.filter((badge) => badge.category === category).length;
    expect(BADGES).toHaveLength(46);
    expect(['progress', 'playtime', 'gear', 'collection', 'social'].map(count)).toEqual([6, 15, 6, 12, 7]);
  });

  it('gives each one its own ID, including the coming soon ones', () => {
    const ids = [...BADGES, ...COMING_SOON_BADGES].map((badge) => badge.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps the IDs already stored for players', () => {
    const ids = BADGES.map((badge) => badge.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'level-10', 'level-25', 'level-50', 'level-75', 'level-90',
        'hours-10', 'hours-50', 'hours-100', 'hours-500',
        'streak-7', 'streak-30', 'night-owl', 'veteran',
        'upgrade-10', 'upgrade-15', 'upgrade-20', 'geared',
        'titles-5', 'titles-10', 'companion-20', 'wealth-1000',
      ]),
    );
  });

  it('has coming soon ones for deaths, failed upgrades, destroyed items, kills and quests', () => {
    const count = (prefix: string) => COMING_SOON_BADGES.filter((badge) => badge.id.startsWith(prefix)).length;
    expect(['deaths-', 'failed-upgrades-', 'destroyed-', 'kills-', 'bosses-', 'quests-'].map(count)).toEqual([3, 3, 2, 3, 2, 3]);
  });

  it('stops at level 90, the level cap', () => {
    const levels = BADGES.filter((badge) => /^level-\d+$/.test(badge.id)).map((badge) => badge.id);
    expect(levels).toEqual(['level-10', 'level-25', 'level-50', 'level-75', 'level-90']);
  });

  it('gives Three of a Kind for three characters at level 50', () => {
    const three = (lastLevel: number) => [
      character({ id: 1, level: 50 }),
      character({ id: 2, level: 60 }),
      character({ id: 3, level: lastLevel }),
    ];
    expect(earned({ characters: three(49) })).not.toContain('level-50-x3');
    expect(earned({ characters: three(50) })).toContain('level-50-x3');
  });

  it('gives days played badges, separate from streaks', () => {
    const days = (count: number) =>
      Array.from({ length: count }, (_, i) => {
        const date = new Date(Date.UTC(2026, 0, 2 + i * 2)).toISOString().slice(0, 10);
        return session(`${date}T10:00:00`, `${date}T11:00:00`);
      });
    expect(earned({ sessions: days(6) })).not.toContain('days-7');
    const seven = earned({ sessions: days(7) });
    expect(seven).toContain('days-7');
    expect(seven).not.toContain('streak-3');
    expect(earned({ sessions: days(30) })).toContain('days-30');
    expect(earned({ sessions: days(100) })).toContain('days-100');
  });

  it('gives a 3 day streak', () => {
    const sessions = ['01', '02', '03'].map((day) => session(`2026-10-${day}T10:00:00`, `2026-10-${day}T11:00:00`));
    expect(earned({ sessions: sessions.slice(0, 2) })).not.toContain('streak-3');
    expect(earned({ sessions })).toContain('streak-3');
  });

  it('gives Early Bird for 10 sessions starting from 05:00 to 07:59', () => {
    const logins = (time: string, count: number) =>
      Array.from({ length: count }, (_, i) => {
        const date = `2026-10-${String(i + 1).padStart(2, '0')}`;
        return session(`${date}T${time}`, `${date}T09:30:00`);
      });
    expect(earned({ sessions: logins('05:00:00', 9) })).not.toContain('early-bird');
    expect(earned({ sessions: logins('05:00:00', 10) })).toContain('early-bird');
    expect(earned({ sessions: logins('07:59:00', 10) })).toContain('early-bird');
    expect(earned({ sessions: logins('08:00:00', 10) })).not.toContain('early-bird');
    expect(earned({ sessions: logins('04:59:00', 10) })).not.toContain('early-bird');
  });

  it('gives Weekend Warrior for 10 sessions starting on a Saturday or Sunday', () => {
    // 2026-10-03 is a Saturday and 2026-10-04 a Sunday.
    const weekend = (count: number) =>
      Array.from({ length: count }, (_, i) => {
        const date = new Date(Date.UTC(2026, 9, 3 + Math.floor(i / 2) * 7 + (i % 2))).toISOString().slice(0, 10);
        return session(`${date}T10:00:00`, `${date}T11:00:00`);
      });
    expect(earned({ sessions: weekend(9) })).not.toContain('weekend-warrior');
    expect(earned({ sessions: weekend(10) })).toContain('weekend-warrior');
    // Mondays to Fridays don't count.
    const weekdays = Array.from({ length: 10 }, (_, i) => {
      const date = new Date(Date.UTC(2026, 9, 5 + (i % 5) + Math.floor(i / 5) * 7)).toISOString().slice(0, 10);
      return session(`${date}T10:00:00`, `${date}T11:00:00`);
    });
    expect(earned({ sessions: weekdays })).not.toContain('weekend-warrior');
  });

  it('gives Marathon for one session of 8 hours', () => {
    expect(earned({ sessions: [session('2026-10-01T06:00:00', '2026-10-01T13:59:00')] })).not.toContain('marathon');
    expect(earned({ sessions: [session('2026-10-01T06:00:00', '2026-10-01T14:00:00')] })).toContain('marathon');
  });

  const item = (slot: number, charId = 1) => ({ charId, slot, itemId: 1, name: 'Thing', upgrade: 0 });

  it('gives Fully Jewelled only with all five jewellery slots on one character', () => {
    const characters = [character({ id: 1 }), character({ id: 2 })];
    expect(earned({ gear: [9, 10, 11, 12].map((slot) => item(slot)) })).not.toContain('jeweller');
    expect(earned({ characters, gear: [item(9), item(10), item(11), item(12), item(13, 2)] })).not.toContain('jeweller');
    expect(earned({ gear: [9, 10, 11, 12, 13].map((slot) => item(slot)) })).toContain('jeweller');
  });

  it('gives Dressed Up for any costume slot, and not for the slots around them', () => {
    expect(earned({ gear: [item(14)] })).not.toContain('dressed-up');
    expect(earned({ gear: [item(15)] })).toContain('dressed-up');
    expect(earned({ gear: [item(18)] })).toContain('dressed-up');
  });

  it('gives 25 titles', () => {
    const titles = (count: number) => Array.from({ length: count }, (_, i) => ({ charId: 1, titleId: i + 1, name: `T${i}` }));
    expect(earned({ titles: titles(24) })).not.toContain('titles-25');
    expect(earned({ titles: titles(25) })).toContain('titles-25');
  });

  it('counts companions on one character', () => {
    const companions = (count: number) => Array.from({ length: count }, (_, slot) => ({ charId: 1, slot, name: 'Rex', level: 1 }));
    expect(earned({})).not.toContain('companion-first');
    expect(earned({ companions: companions(1) })).toContain('companion-first');
    expect(earned({ companions: companions(4) })).not.toContain('companion-5');
    expect(earned({ companions: companions(5) })).toContain('companion-5');
  });

  it('counts different classes and races across the account', () => {
    const made = (codes: [number, number][]) =>
      codes.map(([classCode, raceCode], i) => character({ id: i + 1, classCode, raceCode }));
    expect(earned({ characters: made([[0, 0], [0, 0], [1, 0]]) })).not.toContain('classes-3');
    expect(earned({ characters: made([[0, 0], [1, 0], [2, 0]]) })).toContain('classes-3');
    expect(earned({ characters: made([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]]) })).not.toContain('classes-6');
    expect(earned({ characters: made([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0]]) })).toContain('classes-6');
    expect(earned({ characters: made([[0, 0], [0, 1]]) })).not.toContain('races-3');
    expect(earned({ characters: made([[0, 0], [0, 1], [0, 2]]) })).toContain('races-3');
  });

  it.each([
    [99, []],
    [100, ['wealth-100']],
    [999, ['wealth-100']],
    [1000, ['wealth-100', 'wealth-1000']],
    [10000, ['wealth-100', 'wealth-1000', 'wealth-10000']],
  ])('at %i gold', (gold, expected) => {
    expect(earned({ characters: [character({ gold })] }).filter((id) => id.startsWith('wealth-'))).toEqual(expected);
  });

  it('counts friends on one character', () => {
    const characters = [character({ id: 1 }), character({ id: 2 })];
    expect(earned({ social: [social()] })).not.toContain('friends-1');
    expect(earned({ social: [social({ friends: 1 })] })).toContain('friends-1');
    expect(earned({ characters, social: [social({ friends: 4 }), social({ charId: 2, friends: 4 })] })).not.toContain('friends-5');
    expect(earned({ social: [social({ friends: 5 })] })).toContain('friends-5');
  });

  it('separates joining a guild from leading one', () => {
    expect(earned({})).not.toContain('guild-member');
    const member = earned({ social: [social({ inGuild: true })] });
    expect(member).toContain('guild-member');
    expect(member).not.toContain('guild-leader');
    expect(earned({ social: [social({ inGuild: true, leadsGuild: true })] })).toContain('guild-leader');
  });

  it('adds duel wins up across the account', () => {
    const characters = [character({ id: 1 }), character({ id: 2 })];
    const wins = (a: number, b: number) => earned({ characters, social: [social({ duelWins: a }), social({ charId: 2, duelWins: b })] });
    expect(wins(0, 0)).not.toContain('duels-1');
    expect(wins(0, 1)).toContain('duels-1');
    expect(wins(4, 5)).not.toContain('duels-10');
    expect(wins(5, 5)).toContain('duels-10');
    expect(wins(25, 24)).not.toContain('duels-50');
    expect(wins(25, 25)).toContain('duels-50');
  });

  it('ignores social rows of other characters', () => {
    const noSocial = earned({});
    expect(earned({ social: [social({ charId: 99, friends: 5, inGuild: true, leadsGuild: true, duelWins: 50 })] })).toEqual(noSocial);
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
