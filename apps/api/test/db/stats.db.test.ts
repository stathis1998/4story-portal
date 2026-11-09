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

  it('feeds the rules without errors', () => {
    const stats = computeStats(rows, '2026-11-01');
    expect(stats.characters.size).toBe(rows.characters.length);
  });
});
