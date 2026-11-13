import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Logger } from '@nestjs/common';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PortalStore, StoreUnavailableError } from '../src/store/portal-store.js';

describe('PortalStore', () => {
  const stores: PortalStore[] = [];
  const dirs: string[] = [];

  beforeAll(() => Logger.overrideLogger(false));

  afterEach(() => {
    for (const store of stores.splice(0)) store.close();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const open = (file = ':memory:') => {
    const store = new PortalStore(file);
    stores.push(store);
    return store;
  };

  const tempDir = () => {
    const dir = mkdtempSync(join(tmpdir(), 'portal-store-'));
    dirs.push(dir);
    return dir;
  };

  describe('hide GMs setting', () => {
    it('is off by default', () => {
      expect(open().hideGms()).toBe(false);
    });

    it('can be turned on and off', () => {
      const store = open();
      store.setHideGms(true, 'moose');
      expect(store.hideGms()).toBe(true);
      store.setHideGms(false, 'moose');
      expect(store.hideGms()).toBe(false);
    });

    it('records who changed it', () => {
      const store = open();
      store.setHideGms(true, 'moose');
      expect(store.settingChanges()).toEqual([
        expect.objectContaining({ key: 'hide_gms', value: 'true', changedBy: 'moose', changedAt: expect.any(String) }),
      ]);
    });

    it('survives reopening the file, and makes its folder', () => {
      const file = join(tempDir(), 'nested', 'portal.sqlite');
      const first = new PortalStore(file);
      first.setHideGms(true, 'moose');
      first.close();

      expect(open(file).hideGms()).toBe(true);
    });
  });

  describe('achievements switch', () => {
    it('is off by default', () => {
      expect(open().achievementsLive()).toBe(false);
    });

    it('can be turned on and off, and records who did', () => {
      const store = open();
      store.setAchievementsLive(true, 'moose');
      expect(store.achievementsLive()).toBe(true);
      store.setAchievementsLive(false, 'friend');
      expect(store.achievementsLive()).toBe(false);
      expect(store.settingChanges().map(({ key, value, changedBy }) => [key, value, changedBy])).toEqual([
        ['achievements_live', 'true', 'moose'],
        ['achievements_live', 'false', 'friend'],
      ]);
    });
  });

  describe('achievement rewards', () => {
    const reward = (overrides = {}) => ({ achievementId: 'kills', level: 2, gold: 100, silver: 5, copper: 0, items: [{ itemId: 7602, count: 3 }], ...overrides });

    it('has none to start with', () => {
      expect(open().achievementRewards()).toEqual([]);
    });

    it('saves a reward for each level, with its items', () => {
      const store = open();
      store.setAchievementReward(reward(), 'moose');
      store.setAchievementReward(reward({ level: 1, gold: 10, silver: 0, items: [] }), 'moose');
      expect(store.achievementRewards()).toEqual([reward({ level: 1, gold: 10, silver: 0, items: [] }), reward()]);
    });

    it('replaces the reward of a level saved again', () => {
      const store = open();
      store.setAchievementReward(reward(), 'moose');
      store.setAchievementReward(reward({ gold: 250, items: [] }), 'moose');
      expect(store.achievementRewards()).toEqual([reward({ gold: 250, items: [] })]);
    });

    it('removes a reward saved as nothing', () => {
      const store = open();
      store.setAchievementReward(reward(), 'moose');
      store.setAchievementReward(reward({ gold: 0, silver: 0, copper: 0, items: [] }), 'moose');
      expect(store.achievementRewards()).toEqual([]);
    });

    it('survives reopening the file', () => {
      const file = join(tempDir(), 'portal.sqlite');
      const first = new PortalStore(file);
      first.setAchievementReward(reward(), 'moose');
      first.close();

      expect(open(file).achievementRewards()).toEqual([reward()]);
    });

    it('upgrades a file from before achievements had rewards, keeping its settings', () => {
      const file = join(tempDir(), 'portal.sqlite');
      const old = new DatabaseSync(file);
      old.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE setting_changes (id INTEGER PRIMARY KEY, key TEXT NOT NULL, value TEXT NOT NULL, changed_by TEXT NOT NULL, changed_at TEXT NOT NULL);
        CREATE TABLE badge_unlocks (user_id INTEGER NOT NULL, badge_id TEXT NOT NULL, first_seen TEXT, PRIMARY KEY (user_id, badge_id));
        CREATE TABLE badge_baselines (badge_id TEXT PRIMARY KEY);
        INSERT INTO settings VALUES ('hide_gms', 'true');
        PRAGMA user_version = 2;`);
      old.close();

      const store = open(file);
      expect(store.hideGms()).toBe(true);
      store.setAchievementReward(reward(), 'moose');
      expect(store.achievementRewards()).toEqual([reward()]);
    });
  });

  describe('when the file cannot be used', () => {
    const corrupt = () => {
      const file = join(tempDir(), 'corrupt.sqlite');
      writeFileSync(file, 'this is not a database, and it is long enough to be read as one'.repeat(40));
      return file;
    };

    it('does not throw when opening, and gives the defaults', () => {
      const store = open(corrupt());
      expect(store.hideGms()).toBe(false);
      expect(store.achievementsLive()).toBe(false);
      expect(store.achievementRewards()).toEqual([]);
    });

    it('says a setting could not be saved', () => {
      expect(() => open(corrupt()).setHideGms(true, 'moose')).toThrow(StoreUnavailableError);
      expect(() => open(corrupt()).setAchievementsLive(true, 'moose')).toThrow(StoreUnavailableError);
    });

    it('says a reward could not be saved', () => {
      const reward = { achievementId: 'kills', level: 1, gold: 1, silver: 0, copper: 0, items: [] };
      expect(() => open(corrupt()).setAchievementReward(reward, 'moose')).toThrow(StoreUnavailableError);
    });
  });
});