import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbService } from '../../src/db/db.service.js';
import { computeStats, type StatRows } from '../../src/stats/stats-rules.js';
import { SqlStatsRepository } from '../../src/stats/stats.repository.js';
import { connectTestDb } from './db-test-helpers.js';

describe('SqlStatsRepository against the _TEST copy', () => {
  let db: DbService;
  let rows: StatRows;

  beforeAll(async () => {
    db = await connectTestDb();
    rows = await new SqlStatsRepository(db).loadRows();
  });

  afterAll(() => db.onModuleDestroy());

  it('returns only live characters', async () => {
    const live = await db.pool
      .request()
      .query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${db.tables.characters} WHERE bDelete = 0`);
    expect(rows.characters).toHaveLength(live.recordset[0].n);
    expect(rows.characters.length).toBeGreaterThan(0);
  });

  it('places each character inside its level, so the experience rule holds', () => {
    for (const character of rows.characters) {
      if (character.levelEndExp === null) continue;
      expect(character.exp).toBeLessThanOrEqual(character.levelEndExp);
      if (character.levelStartExp !== null) expect(character.exp).toBeGreaterThanOrEqual(character.levelStartExp);
    }
  });

  it('only returns sessions, gear, companions and titles of live characters', () => {
    const ids = new Set(rows.characters.map((character) => character.id));
    for (const { charId } of [...rows.sessions, ...rows.gear, ...rows.companions, ...rows.titles]) {
      expect(ids.has(charId)).toBe(true);
    }
  });

  it('reads title names as text and leaves out "No title"', () => {
    expect(rows.titlesTotal).toBeGreaterThan(0);
    for (const title of rows.titles) {
      expect(title.titleId).not.toBe(0);
      expect(typeof title.name).toBe('string');
    }
  });

  it('reads every option rule with a usable scale', () => {
    expect(rows.optionRules.length).toBeGreaterThan(0);
    for (const rule of rows.optionRules) {
      expect(rule.magic).toBeGreaterThanOrEqual(0);
      expect(rule.maxValue).toEqual(expect.any(Number));
      expect(rule.rvType).toEqual(expect.any(Number));
    }
  });

  it('reads the details a tooltip needs for equipped gear', () => {
    expect(rows.gear.length).toBeGreaterThan(0);
    for (const item of rows.gear) {
      expect(item.gem).toEqual(expect.any(Number));
      expect(item.duraCur).toEqual(expect.any(Number));
      expect(item.revision.every((rate) => typeof rate === 'number')).toBe(true);
      expect(item.options.every(({ id, value }) => id > 0 && value >= 0 && value <= 65535)).toBe(true);
      if (item.endsAt) expect(item.endsAt.getUTCFullYear()).toBeGreaterThan(1900);
    }
  });

  it('reads equipped gear with real slots', () => {
    for (const item of rows.gear) {
      expect(item.slot).toBeGreaterThanOrEqual(0);
      expect(item.slot).toBeLessThan(19);
    }
  });

  it('reads friends, guilds and duel wins for every live character', () => {
    expect(rows.social.map(({ charId }) => charId).sort((a, b) => a - b)).toEqual(
      rows.characters.map(({ id }) => id).sort((a, b) => a - b),
    );
    for (const row of rows.social) {
      expect(row.friends).toBeGreaterThanOrEqual(0);
      expect(row.duelWins).toBeGreaterThanOrEqual(0);
      expect(typeof row.inGuild).toBe('boolean');
      expect(typeof row.leadsGuild).toBe('boolean');
    }
  });

  it('reads kills and damage as numbers, even damage too big for 32 bits', async () => {
    const charId = rows.characters[0].id;
    const row = () => db.pool.request().input('charId', sql.Int, charId);
    await row().query(
      `INSERT INTO ${db.tables.characterStats} (dwCharID, dwTotalKills, nDamageDealt) VALUES (@charId, 7, 5000000000)`,
    );
    try {
      const { combat } = await new SqlStatsRepository(db).loadRows();
      expect(combat).toContainEqual({ charId, kills: 7, damageDealt: 5_000_000_000 });
    } finally {
      await row().query(`DELETE FROM ${db.tables.characterStats} WHERE dwCharID = @charId`);
    }
  });

  it('reads only the money spent counter, as a number', async () => {
    const charId = rows.characters[0].id;
    const row = () => db.pool.request().input('charId', sql.Int, charId);
    await row().query(
      `INSERT INTO ${db.tables.characterCounters} (dwCharID, wStatID, nValue) VALUES (@charId, 2, 999), (@charId, 3, 5000000000)`,
    );
    try {
      const { spending } = await new SqlStatsRepository(db).loadRows();
      expect(spending.filter((entry) => entry.charId === charId)).toEqual([{ charId, copper: 5_000_000_000 }]);
    } finally {
      await row().query(`DELETE FROM ${db.tables.characterCounters} WHERE dwCharID = @charId`);
    }
  });

  it('reads only the soul lottery counters, as numbers per character', async () => {
    const charId = rows.characters[0].id;
    const row = () => db.pool.request().input('charId', sql.Int, charId);
    await row().query(
      `INSERT INTO ${db.tables.characterCounters} (dwCharID, wStatID, nValue)
       VALUES (@charId, 3, 999), (@charId, 4, 2), (@charId, 5, 9), (@charId, 6, 5000000000), (@charId, 7, 123000)`,
    );
    try {
      const { soulLottery } = await new SqlStatsRepository(db).loadRows();
      expect(soulLottery.filter((entry) => entry.charId === charId)).toEqual([
        { charId, won: 2, lost: 9, copperWon: 5_000_000_000, copperConsolation: 123_000 },
      ]);
    } finally {
      await row().query(`DELETE FROM ${db.tables.characterCounters} WHERE dwCharID = @charId`);
    }
  });

  it('groups the upgrade log by character, kind, level, result and day', async () => {
    const charId = rows.characters[0].id;
    const row = () => db.pool.request().input('charId', sql.Int, charId);
    const columns = '(dwCharID, bKind, bResult, wItemID, wScrollID, bLevelBefore, bLevelAfter, bChance, bProtect, wMapID, wNpcID, nFee, dLogDate)';
    await row().query(
      `INSERT INTO ${db.tables.upgradeLog} ${columns} VALUES
         (@charId, 1, 1, 40000, 7602, 11, 13, 35, 0, 0, 1, 0, '2026-11-10T13:35:00'),
         (@charId, 1, 1, 40000, 7602, 11, 12, 40, 0, 0, 1, 0, '2026-11-10T23:59:00'),
         (@charId, 1, 2, 40000, 7602, 11, NULL, 35, 0, 0, 1, 0, '2026-11-10T13:36:00'),
         (@charId, 2, 4, 1121, 18191, 0, 0, 90, 0, 0, 1, 0, '2026-11-11T00:01:00')`,
    );
    try {
      const { upgradeAttempts } = await new SqlStatsRepository(db).loadRows();
      expect(upgradeAttempts.filter((entry) => entry.charId === charId).sort((a, b) => a.kind - b.kind || a.result - b.result)).toEqual([
        { charId, kind: 1, level: 11, result: 1, day: '2026-11-10', attempts: 2, chanceTotal: 75 },
        { charId, kind: 1, level: 11, result: 2, day: '2026-11-10', attempts: 1, chanceTotal: 35 },
        { charId, kind: 2, level: 0, result: 4, day: '2026-11-11', attempts: 1, chanceTotal: 90 },
      ]);
    } finally {
      await row().query(`DELETE FROM ${db.tables.upgradeLog} WHERE dwCharID = @charId`);
    }
  });

  it('lists only items destroyed by upgrade scrolls, with the item name from the chart', async () => {
    const charId = rows.characters[0].id;
    const { recordset } = await db.pool.request().query<{ itemId: number; name: string }>(`SELECT TOP 1 wItemID AS itemId, szNAME AS name FROM ${db.tables.items} ORDER BY wItemID`);
    const item = recordset[0];
    const row = () => db.pool.request().input('charId', sql.Int, charId).input('itemId', sql.Int, item.itemId);
    const columns = '(dwCharID, bKind, bResult, wItemID, wScrollID, bLevelBefore, bLevelAfter, bChance, bProtect, wMapID, wNpcID, nFee, dLogDate)';
    await row().query(
      `INSERT INTO ${db.tables.upgradeLog} ${columns} VALUES
         (@charId, 1, 2, @itemId, 7602, 14, NULL, 20, 0, 0, 1, 0, '2026-11-10T13:36:00'),
         (@charId, 1, 3, @itemId, 7602, 16, 14, 20, 3, 0, 1, 0, '2026-11-10T13:37:00'),
         (@charId, 2, 3, @itemId, 18190, 3, 0, 50, 0, 0, 1, 0, '2026-11-10T13:38:00')`,
    );
    try {
      const { upgradeLosses } = await new SqlStatsRepository(db).loadRows();
      expect(upgradeLosses.filter((loss) => loss.charId === charId)).toEqual([
        { charId, itemId: item.itemId, name: item.name, level: 14, at: new Date('2026-11-10T13:36:00Z') },
      ]);
    } finally {
      await row().query(`DELETE FROM ${db.tables.upgradeLog} WHERE dwCharID = @charId`);
    }
  });

  it('reads only the failed upgrade counter, as a number', async () => {
    const charId = rows.characters[0].id;
    const row = () => db.pool.request().input('charId', sql.Int, charId);
    await row().query(`INSERT INTO ${db.tables.characterCounters} (dwCharID, wStatID, nValue) VALUES (@charId, 0, 999), (@charId, 1, 42)`);
    try {
      const { upgradeFailures } = await new SqlStatsRepository(db).loadRows();
      expect(upgradeFailures.filter((entry) => entry.charId === charId)).toEqual([{ charId, failed: 42 }]);
    } finally {
      await row().query(`DELETE FROM ${db.tables.characterCounters} WHERE dwCharID = @charId`);
    }
  });

  it('feeds the rules without errors', () => {
    const stats = computeStats(rows, '2026-11-01');
    expect(stats.characters.size).toBe(rows.characters.length);
  });
});
