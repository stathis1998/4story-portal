import { ACHIEVEMENT_CATEGORIES, ACHIEVEMENT_MAX_LEVELS } from '@4story-portal/shared';
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_ACHIEVEMENTS,
  ACCOUNT_LEVELS_TOTAL,
  ACHIEVEMENTS,
  type AchievementFamily,
  CHARACTER_ACHIEVEMENTS,
  CHARACTER_LEVELS_TOTAL,
  accountLevelsDone,
  awardLife,
  baselineOf,
  characterLevelsDone,
  FIRST_LIFE,
  formatValue,
  levelReached,
  levelsDone,
  lifeValue,
  REBIRTH_SETTLE_SECONDS,
  type RebirthBehaviour,
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
import { firstLife, gearDefaults } from './fixtures.js';

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
  ...firstLife,
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

const stats = (overrides: Partial<StatRows> = {}) => computeStats(rows(overrides), '2026-11-01');
const account = (overrides: Partial<StatRows> = {}) => stats(overrides).accounts.get(10)!;
const char = (overrides: Partial<StatRows> = {}, id = 1) => stats(overrides).characters.get(id)!;
const family = (id: string): AchievementFamily => ACHIEVEMENTS.find((entry) => entry.id === id)!;
/** A character achievement's value for one character, or an account achievement's for the account. */
function value(id: string, overrides: Partial<StatRows>, charId = 1): number {
  const entry = family(id);
  return entry.scope === 'character' ? entry.value(char(overrides, charId)) : entry.value(account(overrides));
}
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

  it('counts every level of each kind', () => {
    const count = (entries: readonly AchievementFamily[]) => entries.reduce((total, entry) => total + entry.levels.length, 0);
    expect(CHARACTER_LEVELS_TOTAL).toBe(count(CHARACTER_ACHIEVEMENTS));
    expect(ACCOUNT_LEVELS_TOTAL).toBe(count(ACCOUNT_ACHIEVEMENTS));
    expect(CHARACTER_LEVELS_TOTAL + ACCOUNT_LEVELS_TOTAL).toBe(count(ACHIEVEMENTS));
  });

  it('marks each achievement as a character or an account one', () => {
    expect(CHARACTER_ACHIEVEMENTS.every((entry) => entry.scope === 'character')).toBe(true);
    expect(ACCOUNT_ACHIEVEMENTS.every((entry) => entry.scope === 'account')).toBe(true);
    expect(ACHIEVEMENTS).toHaveLength(CHARACTER_ACHIEVEMENTS.length + ACCOUNT_ACHIEVEMENTS.length);
  });

  it('keeps what a player does over time, and what the account owns, for the account', () => {
    const ids = ACCOUNT_ACHIEVEMENTS.map((entry) => entry.id).sort();
    expect(ids).toEqual(['classes', 'days', 'early-bird', 'hours', 'marathon', 'night-owl', 'pets', 'roster', 'streak', 'weekend-warrior']);
  });

  it('never asks one character for something "on one character"', () => {
    for (const entry of CHARACTER_ACHIEVEMENTS) {
      for (const threshold of entry.levels) expect(entry.goal(threshold), entry.id).not.toMatch(/one character|your characters/);
    }
  });
});

describe('values', () => {
  it('reads each character its own level', () => {
    const characters = [character({ level: 40 }), character({ id: 2, level: 72 })];
    expect(value('level', { characters }, 1)).toBe(40);
    expect(value('level', { characters }, 2)).toBe(72);
  });

  it('counts characters at level 50', () => {
    const characters = [character({ level: 50 }), character({ id: 2, level: 49 }), character({ id: 3, level: 90 })];
    expect(value('roster', { characters })).toBe(2);
  });

  it('counts a character own kills, not the account total', () => {
    const characters = [character(), character({ id: 2 })];
    const combat = [
      { charId: 1, kills: 600, damageDealt: 10 },
      { charId: 2, kills: 400, damageDealt: 5 },
    ];
    expect(value('kills', { characters, combat }, 1)).toBe(600);
    expect(value('kills', { characters, combat }, 2)).toBe(400);
    expect(value('damage', { characters, combat }, 2)).toBe(5);
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
    expect(value('damage-taken', rowsWith)).toBe(100);
    expect(value('healing', rowsWith)).toBe(7);
    expect(value('skills', rowsWith)).toBe(30);
    expect(value('bestiary', rowsWith)).toBe(12);
    expect(value('nemesis', rowsWith)).toBe(900);
    expect(value('upgrade-successes', rowsWith)).toBe(4);
    // 1.5 gold looted, counted in whole gold.
    expect(value('gold-looted', rowsWith)).toBe(1);
    expect(value('skills', rowsWith, 2)).toBe(44);
    expect(value('gold-looted', rowsWith, 2)).toBe(0);
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
    expect(value('gem-level', { characters, gear })).toBe(4);
    expect(value('equipped', { characters, gear })).toBe(3);
    expect(value('gem-level', { characters, gear }, 2)).toBe(5);
    expect(value('equipped', { characters, gear }, 2)).toBe(1);
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

describe('levels done', () => {
  // Level 40 is two levels of `level`; 1,000 kills is one of `kills`. Level 60 is three, and puts one character on the roster.
  const played = {
    characters: [character({ level: 40 }), character({ id: 2, level: 60 }), character({ id: 3, level: 90, banned: true })],
    combat: [{ charId: 1, kills: 1000, damageDealt: 0 }],
  };

  it('is 0 for a fresh account', () => expect(levelsDone(account())).toBe(0));

  it('counts a character own levels', () => {
    expect(characterLevelsDone(char(played, 1))).toBe(3);
    expect(characterLevelsDone(char(played, 2))).toBe(3);
  });

  it('counts the account own levels', () => {
    // Two characters at level 50 or more: the banned one still counts as owned.
    expect(accountLevelsDone(account(played))).toBe(2);
  });

  it('adds the account and its characters up, leaving banned characters out', () => {
    expect(levelsDone(account(played))).toBe(3 + 3 + 2);
  });
});

describe('rebirth', () => {
  const RESTARTS = ['level', 'skills'];
  const SINCE = [
    'kills',
    'damage',
    'damage-taken',
    'healing',
    'duels',
    'upgrade-successes',
    'gem-successes',
    'gold-looted',
    'gold-spent',
    'lottery-plays',
    'lottery-wins',
    'lottery-gold',
    'upgrade-fails',
    'setbacks',
    'destroyed',
    'lottery-losses',
  ];
  const ONCE = [
    'bestiary',
    'nemesis',
    'upgrade',
    'gem-level',
    'glowing',
    'equipped',
    'gold-held',
    'titles',
    'companions',
    'companion-level',
    'friends',
    'guild-member',
    'guild-leader',
    'lose-streak',
  ];
  const characterFamily = (id: string) => CHARACTER_ACHIEVEMENTS.find((entry) => entry.id === id)!;
  const sorted = (ids: string[]) => [...ids].sort();
  const kills = (count: number) => [{ charId: 1, kills: count, damageDealt: 0 }];

  it('gives every character achievement a rebirth behaviour', () => {
    const ids = (behaviour: RebirthBehaviour) => CHARACTER_ACHIEVEMENTS.filter((entry) => entry.rebirth === behaviour).map((entry) => entry.id);
    expect(sorted(ids('restarts'))).toEqual(sorted(RESTARTS));
    expect(sorted(ids('since'))).toEqual(sorted(SINCE));
    expect(sorted(ids('once'))).toEqual(sorted(ONCE));
    expect(CHARACTER_ACHIEVEMENTS).toHaveLength(RESTARTS.length + SINCE.length + ONCE.length);
  });

  it('counts a counter from the rebirth', () => {
    const reborn = (baseline: Record<string, number>) => char({ characters: [character({ rebirth: 1, baseline })], combat: kills(1500) });
    expect(lifeValue(characterFamily('kills'), reborn({ kills: 1200 }))).toBe(300);
    // A baseline above the number now never counts below zero.
    expect(lifeValue(characterFamily('kills'), reborn({ kills: 2000 }))).toBe(0);
    // A counter missing from the baseline counts from zero.
    expect(lifeValue(characterFamily('kills'), reborn({}))).toBe(1500);
  });

  it('leaves level and kept things as they are', () => {
    expect(lifeValue(characterFamily('level'), char({ characters: [character({ rebirth: 1, level: 12, baseline: {} })] }))).toBe(12);
    const rich = char({ characters: [character({ rebirth: 1, gold: 500, baseline: { 'gold-held': 400, level: 10 } })] });
    expect(lifeValue(characterFamily('gold-held'), rich)).toBe(500);
    expect(lifeValue(characterFamily('level'), rich)).toBe(1);
  });

  it('awards kept things under the first life', () => {
    const reborn = char({ characters: [character({ rebirth: 2 })] });
    expect(awardLife(characterFamily('titles'), reborn)).toBe(FIRST_LIFE);
    expect(awardLife(characterFamily('kills'), reborn)).toBe(2);
    expect(awardLife(characterFamily('level'), reborn)).toBe(2);
    expect(FIRST_LIFE).toBe(0);
  });

  it('takes the baseline from the counters only', () => {
    const played = char({ characters: [character({ level: 90, gold: 800 })], combat: kills(1500) });
    const baseline = baselineOf(played);
    expect(sorted(Object.keys(baseline))).toEqual(sorted(SINCE));
    expect(baseline.kills).toBe(1500);
  });

  it('counts only the levels of the current life', () => {
    // 1,000 kills before the rebirth and none since; level 20 again.
    const reborn = char({ characters: [character({ rebirth: 1, level: 20, baseline: { kills: 1000 } })], combat: kills(1000) });
    expect(characterLevelsDone(reborn)).toBe(1);
  });

  it('waits two minutes after a rebirth', () => expect(REBIRTH_SETTLE_SECONDS).toBe(120));
});

describe('formatValue', () => {
  it('groups plain numbers', () => expect(formatValue(family('kills'), 7420)).toBe('7,420'));
  it('writes upgrades with a plus', () => expect(formatValue(family('upgrade'), 22)).toBe('+22'));
  it('shortens damage', () => expect(formatValue(family('damage'), 81_300_000)).toBe('81.3M'));
});
