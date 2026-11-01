import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Logger } from '@nestjs/common';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PortalStore, StoreUnavailableError } from '../src/store/portal-store.js';

const KNOWN = ['level-10', 'level-25'];

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

  describe('badge dates', () => {
    const held = (entries: [number, string[]][]) => new Map(entries);

    it('stores no date for badges held at the first recording', () => {
      const store = open();
      store.recordBadges(held([[1, ['level-10']]]), '2026-11-01', KNOWN);
      expect(store.badgeUnlocks()).toEqual([{ userId: 1, badgeId: 'level-10', firstSeen: null }]);
    });

    it('dates badges seen after that', () => {
      const store = open();
      store.recordBadges(held([[1, ['level-10']]]), '2026-11-01', KNOWN);
      store.recordBadges(held([[1, ['level-10', 'level-25']], [2, ['level-10']]]), '2026-11-05', KNOWN);

      expect(store.badgeUnlocks()).toEqual([
        { userId: 1, badgeId: 'level-10', firstSeen: null },
        { userId: 1, badgeId: 'level-25', firstSeen: '2026-11-05' },
        { userId: 2, badgeId: 'level-10', firstSeen: '2026-11-05' },
      ]);
    });

    it('keeps the first date on later recordings', () => {
      const store = open();
      store.recordBadges(held([]), '2026-11-01', KNOWN);
      store.recordBadges(held([[1, ['level-10']]]), '2026-11-02', KNOWN);
      store.recordBadges(held([[1, ['level-10']]]), '2026-11-09', KNOWN);
      expect(store.badgeUnlocks()).toEqual([{ userId: 1, badgeId: 'level-10', firstSeen: '2026-11-02' }]);
    });

    it('keeps a badge the account no longer holds', () => {
      const store = open();
      store.recordBadges(held([[1, ['level-10']]]), '2026-11-01', KNOWN);
      store.recordBadges(held([]), '2026-11-02', KNOWN);
      expect(store.badgeUnlocks()).toHaveLength(1);
    });

    it('stores no date for a badge the first time it exists, and dates it after that', () => {
      const store = open();
      const later = [...KNOWN, 'added-later'];
      store.recordBadges(held([[1, ['level-10']]]), '2026-11-01', KNOWN);
      store.recordBadges(held([[1, ['level-10', 'added-later']]]), '2026-11-05', later);
      store.recordBadges(held([[1, ['level-10', 'added-later']], [2, ['added-later']]]), '2026-11-06', later);

      expect(store.badgeUnlocks()).toEqual([
        { userId: 1, badgeId: 'added-later', firstSeen: null },
        { userId: 1, badgeId: 'level-10', firstSeen: null },
        { userId: 2, badgeId: 'added-later', firstSeen: '2026-11-06' },
      ]);
    });

    it('dates a known badge nobody held when it first appeared', () => {
      const store = open();
      store.recordBadges(held([]), '2026-11-01', ['level-125']);
      store.recordBadges(held([[1, ['level-125']]]), '2026-11-02', ['level-125']);
      expect(store.badgeUnlocks()).toEqual([{ userId: 1, badgeId: 'level-125', firstSeen: '2026-11-02' }]);
    });

    const VERSION_1 = `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE setting_changes (id INTEGER PRIMARY KEY, key TEXT NOT NULL, value TEXT NOT NULL, changed_by TEXT NOT NULL, changed_at TEXT NOT NULL);
      CREATE TABLE badge_unlocks (user_id INTEGER NOT NULL, badge_id TEXT NOT NULL, first_seen TEXT, PRIMARY KEY (user_id, badge_id));
      PRAGMA user_version = 1;`;

    it('upgrades a file already in use: the original badges stay dated, new ones start blank', () => {
      const file = join(tempDir(), 'portal.sqlite');
      const old = new DatabaseSync(file);
      old.exec(`${VERSION_1}
        INSERT INTO settings VALUES ('badges_baselined', '2026-11-01');
        INSERT INTO badge_unlocks VALUES (1, 'level-10', NULL);`);
      old.close();

      const known = ['level-10', 'level-25', 'level-125'];
      const store = open(file);
      store.recordBadges(held([[1, known]]), '2026-11-05', known);
      expect(store.badgeUnlocks()).toEqual([
        { userId: 1, badgeId: 'level-10', firstSeen: null },
        { userId: 1, badgeId: 'level-125', firstSeen: null },
        { userId: 1, badgeId: 'level-25', firstSeen: '2026-11-05' },
      ]);
    });

    it('upgrades a file that never recorded anything: everything starts blank', () => {
      const file = join(tempDir(), 'portal.sqlite');
      const old = new DatabaseSync(file);
      old.exec(VERSION_1);
      old.close();

      const store = open(file);
      store.recordBadges(held([[1, ['level-25']]]), '2026-11-05', ['level-25']);
      expect(store.badgeUnlocks()[0].firstSeen).toBeNull();
    });

    it('still treats a later run as not the first after reopening', () => {
      const file = join(tempDir(), 'portal.sqlite');
      const first = new PortalStore(file);
      first.recordBadges(new Map(), '2026-11-01', KNOWN);
      first.close();

      const store = open(file);
      store.recordBadges(held([[1, ['level-10']]]), '2026-11-02', KNOWN);
      expect(store.badgeUnlocks()[0].firstSeen).toBe('2026-11-02');
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
      expect(store.badgeUnlocks()).toEqual([]);
    });

    it('ignores badge recording', () => {
      expect(() => open(corrupt()).recordBadges(new Map([[1, ['level-10']]]), '2026-11-01', KNOWN)).not.toThrow();
    });

    it('says a setting could not be saved', () => {
      expect(() => open(corrupt()).setHideGms(true, 'moose')).toThrow(StoreUnavailableError);
    });
  });
});
