import { ACHIEVEMENT_CATEGORIES, ACHIEVEMENT_MAX_LEVELS } from '@4story-portal/shared';
import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENTS,
  type AchievementFamily,
  LEVELS_TOTAL,
  formatValue,
  levelReached,
  levelsDone,
} from '../src/achievements/achievement-rules.js';
import {
  type CharacterRow,
  computeStats,
  type StatRows,
  UPGRADE_KIND_GEM,
  UPGRADE_KIND_SCROLL,
  UPGRADE_LOST_LEVELS,
  UPGRADE_SUCCESS,
} from '../src/stats/stats-rules.js';
import { gearDefaults } from './fixtures.js';

const character = (overrides: Partial<CharacterRow> = {}): CharacterRow => ({
  id: 1,
  userId: 10,
  name: 'Kaelith',
  classCode: 0,
  raceCode: 0,
  countryCode: 0,
  level: 1,
  exp: 0,
  levelStartExp: null,
  levelEndExp: null,
  gold: 0,
  createdAt: null,
  banned: false,
  ...overrides,
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
  soulLottery: [],
  lotteryStreaks: [],
  upgradeAttempts: [],
  upgradeLosses: [],
  upgradeFailures: [],
  progress: [],
  pets: [],
  accounts: [{ userId: 10, username: 'friend' }],
  ...overrides,
});

const account = (overrides: Partial<StatRows> = {}) => computeStats(rows(overrides), '2026-11-01').accounts.get(10)!;
const family = (id: string): AchievementFamily => ACHIEVEMENTS.find((entry) => entry.id === id)!;
const value = (id: string, overrides: Partial<StatRows>) => family(id).value(account(overrides));
const progress = (charId: number, overrides: Partial<StatRows['progress'][number]>) => ({
  charId,
  damageTaken: 0,
  healDone: 0,
  skillLevels: 0,
  monsterTypes: 0,
  topMonsterKills: 0,
  highestUpgrade: 0,
  upgradesSucceeded: 0,
  copperLooted: 0,
  ...overrides,
});
const attempts = (kind: number, result: number, count: number, charId = 1) => ({
  charId,
  kind,
  level: 5,
  result,
  day: '2026-11-01',
  attempts: count,
  chanceTotal: 0,
});

describe('levelReached', () => {
  const kills = family('kills');

  it.each([
    [0, 0],
    [999, 0],
    [1000, 1],
    [9999, 1],
    [10_000, 2],
    [1_000_000, 5],
    [50_000_000, 5],
  ])('a value of %i is level %i', (amount, level) => expect(levelReached(kills, amount)).toBe(level));

  it('handles an achievement with one level', () => {
    expect(levelReached(family('guild-member'), 0)).toBe(0);
    expect(levelReached(family('guild-member'), 1)).toBe(1);
  });
});

describe('the catalogue', () => {
  it('has unique IDs that fit the award table', () => {
    const ids = ACHIEVEMENTS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^[a-z0-9-]{1,40}$/.test(id))).toBe(true);
  });

  it('gives every achievement 1 to 5 rising levels', () => {
    for (const { id, levels } of ACHIEVEMENTS) {
      expect(levels.length, id).toBeGreaterThanOrEqual(1);
      expect(levels.length, id).toBeLessThanOrEqual(ACHIEVEMENT_MAX_LEVELS);
      expect([...levels].sort((a, b) => a - b), id).toEqual([...levels]);
      expect(new Set(levels).size, id).toBe(levels.length);
      expect(levels[0], id).toBeGreaterThan(0);
    }
  });

  it('files every achievement under a known category, and uses every category', () => {
    const known = ACHIEVEMENT_CATEGORIES.map((category) => category.id);
    expect(ACHIEVEMENTS.every((entry) => known.includes(entry.category))).toBe(true);
    expect(new Set(ACHIEVEMENTS.map((entry) => entry.category)).size).toBe(known.length);
  });

  it('writes goals and titles the game mail can carry', () => {
    for (const entry of ACHIEVEMENTS) {
      for (const threshold of entry.levels) expect(entry.goal(threshold), entry.id).toMatch(/^[\x20-\x7E]{1,120}$/);
      expect(entry.name, entry.id).toMatch(/^[\x20-\x7E]{1,24}$/);
    }
  });

  it('counts every level', () => {
    expect(LEVELS_TOTAL).toBe(ACHIEVEMENTS.reduce((total, entry) => total + entry.levels.length, 0));
  });
});

describe('values', () => {
  it('takes the highest level character', () => {
    expect(value('level', { characters: [character({ level: 40 }), character({ id: 2, level: 72 })] })).toBe(72);
  });

  it('counts characters at level 50', () => {
    const characters = [character({ level: 50 }), character({ id: 2, level: 49 }), character({ id: 3, level: 90 })];
    expect(value('roster', { characters })).toBe(2);
  });

  it('adds kills up across the account', () => {
    const characters = [character(), character({ id: 2 })];
    const combat = [
      { charId: 1, kills: 600, damageDealt: 10 },
      { charId: 2, kills: 400, damageDealt: 5 },
    ];
    expect(value('kills', { characters, combat })).toBe(1000);
    expect(value('damage', { characters, combat })).toBe(15);
  });

  it('reads the numbers only achievements use', () => {
    const characters = [character(), character({ id: 2 })];
    const rowsWith = {
      characters,
      progress: [
        progress(1, { damageTaken: 100, healDone: 7, skillLevels: 30, monsterTypes: 12, topMonsterKills: 900, upgradesSucceeded: 4, copperLooted: 1_500_000 }),
        progress(2, { damageTaken: 50, healDone: 3, skillLevels: 44, monsterTypes: 20, topMonsterKills: 300, upgradesSucceeded: 6, copperLooted: 700_000 }),
      ],
    };
    expect(value('damage-taken', rowsWith)).toBe(150);
    expect(value('healing', rowsWith)).toBe(10);
    expect(value('skills', rowsWith)).toBe(44);
    expect(value('bestiary', rowsWith)).toBe(20);
    expect(value('nemesis', rowsWith)).toBe(900);
    expect(value('upgrade-successes', rowsWith)).toBe(10);
    // 2.2 gold looted, counted in whole gold.
    expect(value('gold-looted', rowsWith)).toBe(2);
  });

  it('takes the best upgrade from what is worn or what the log saw', () => {
    const worn = { ...gearDefaults, charId: 1, slot: 0, itemId: 5, name: 'Sword', upgrade: 19 };
    expect(value('upgrade', { gear: [worn] })).toBe(19);
    expect(value('upgrade', { gear: [worn], progress: [progress(1, { highestUpgrade: 22 })] })).toBe(22);
    expect(value('upgrade', { progress: [progress(1, { highestUpgrade: 18 })] })).toBe(18);
  });

  it('counts worn items at +17 or higher, the best gem and filled slots, per character', () => {
    const item = (slot: number, upgrade: number, gem: number, charId = 1) => ({ ...gearDefaults, charId, slot, itemId: slot + 1, name: 'x', upgrade, gem });
    const gear = [item(0, 17, 2), item(3, 22, 0), item(5, 16, 4), item(0, 20, 5, 2)];
    const characters = [character(), character({ id: 2 })];
    expect(value('glowing', { characters, gear })).toBe(2);
    expect(value('gem-level', { characters, gear })).toBe(5);
    expect(value('equipped', { characters, gear })).toBe(3);
  });

  it('counts gemstone successes and scroll setbacks from the upgrade log', () => {
    const upgradeAttempts = [
      attempts(UPGRADE_KIND_GEM, UPGRADE_SUCCESS, 30),
      attempts(UPGRADE_KIND_GEM, UPGRADE_LOST_LEVELS, 9),
      attempts(UPGRADE_KIND_SCROLL, UPGRADE_LOST_LEVELS, 4),
      attempts(UPGRADE_KIND_SCROLL, UPGRADE_SUCCESS, 2),
    ];
    expect(value('gem-successes', { upgradeAttempts })).toBe(30);
    expect(value('setbacks', { upgradeAttempts })).toBe(4);
  });

  it('counts hours from minutes and the longest session in whole hours', () => {
    const at = (text: string) => new Date(`${text}Z`);
    const sessions = [
      { charId: 1, login: at('2026-10-01T10:00:00'), logout: at('2026-10-01T14:30:00') },
      { charId: 1, login: at('2026-10-02T10:00:00'), logout: at('2026-10-02T11:00:00') },
    ];
    expect(value('hours', { sessions })).toBe(5);
    expect(value('marathon', { sessions })).toBe(4);
    expect(value('days', { sessions })).toBe(2);
    expect(value('streak', { sessions })).toBe(2);
  });

  it('counts lottery plays as wins plus losses, and winnings in whole gold', () => {
    const soulLottery = [{ charId: 1, won: 3, lost: 40, copperWon: 480_000_000, copperConsolation: 0 }];
    expect(value('lottery-plays', { soulLottery })).toBe(43);
    expect(value('lottery-wins', { soulLottery })).toBe(3);
    expect(value('lottery-losses', { soulLottery })).toBe(40);
    expect(value('lottery-gold', { soulLottery })).toBe(480);
  });

  it('counts the account mounts and pets, and its different classes', () => {
    const characters = [character({ classCode: 1 }), character({ id: 2, classCode: 1 }), character({ id: 3, classCode: 4 })];
    expect(value('pets', { pets: [{ userId: 10, pets: 4 }] })).toBe(4);
    expect(value('classes', { characters })).toBe(2);
  });

  it('turns guild membership into one level', () => {
    const social = [{ charId: 1, friends: 2, inGuild: true, leadsGuild: false, duelWins: 0 }];
    expect(value('guild-member', { social })).toBe(1);
    expect(value('guild-leader', { social })).toBe(0);
    expect(value('friends', { social })).toBe(2);
  });
});

describe('levelsDone', () => {
  it('is 0 for a fresh account', () => expect(levelsDone(account())).toBe(0));

  it('adds up the levels reached in every achievement', () => {
    // Level 40 is two levels of `level`; 1,000 kills is one of `kills`.
    const done = levelsDone(account({ characters: [character({ level: 40 })], combat: [{ charId: 1, kills: 1000, damageDealt: 0 }] }));
    expect(done).toBe(3);
  });
});

describe('formatValue', () => {
  it('groups plain numbers', () => expect(formatValue(family('kills'), 7420)).toBe('7,420'));
  it('writes upgrades with a plus', () => expect(formatValue(family('upgrade'), 22)).toBe('+22'));
  it('shortens damage', () => expect(formatValue(family('damage'), 81_300_000)).toBe('81.3M'));
});
