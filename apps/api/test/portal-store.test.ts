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

  describe('when the file cannot be used', () => {
    const corrupt = () => {
      const file = join(tempDir(), 'corrupt.sqlite');
      writeFileSync(file, 'this is not a database, and it is long enough to be read as one'.repeat(40));
      return file;
    };

    it('does not throw when opening, and gives the defaults', () => {
      const store = open(corrupt());
      expect(store.hideGms()).toBe(false);
    });

    it('says a setting could not be saved', () => {
      expect(() => open(corrupt()).setHideGms(true, 'moose')).toThrow(StoreUnavailableError);
    });

    it('opens a file that still has the old badge tables', () => {
      const file = join(tempDir(), 'portal.sqlite');
      const first = new PortalStore(file);
      first.setHideGms(true, 'moose');
      first.close();
      const old = new DatabaseSync(file);
      old.exec("INSERT INTO badge_unlocks VALUES (1, 'level-10', '2026-11-01')");
      old.close();

      expect(open(file).hideGms()).toBe(true);
    });
  });
});