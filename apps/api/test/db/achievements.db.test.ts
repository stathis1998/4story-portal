import { readFileSync } from 'node:fs';
import path from 'node:path';
import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ANNOUNCE_SENT,
  ANNOUNCE_WAITING,
  AWARD_ALREADY_GIVEN,
  AWARD_NO_CHARACTER,
  type AwardInput,
  SqlAchievementsRepository,
} from '../../src/achievements/achievements.repository.js';
import { loadConfig } from '../../src/config/config.js';
import type { DbService } from '../../src/db/db.service.js';
import { connectTestDb, inRolledBackTransaction } from './db-test-helpers.js';

// Run in this order inside each test's transaction: the tables, then the procedures that use them.
const setupSql = ['TPORTALPOSTNOTIFY.sql', 'TPortalGmPost.sql', 'TPORTALACHIEVEMENTTABLE.sql', 'TPortalAchievementAward.sql'].map((file) =>
  readFileSync(path.resolve(process.cwd(), 'sql', file), 'utf8'),
);

describe('SqlAchievementsRepository against the _TEST copy', () => {
  let db: DbService;
  let gameName: string;
  let character: { charId: number; userId: number; name: string };
  let stackable: { itemId: number; stack: number };

  beforeAll(async () => {
    db = await connectTestDb();
    gameName = loadConfig(process.env).db.gameName;
    const chars = await db.pool
      .request()
      .query<{ charId: number; userId: number; name: string }>(
        `SELECT TOP 1 dwCharID AS charId, dwUserID AS userId, szName AS name FROM ${db.tables.characters} WHERE bDelete = 0 ORDER BY dwCharID`,
      );
    character = chars.recordset[0];
    const stacks = await db.pool
      .request()
      .query<{ itemId: number; stack: number }>(
        `SELECT TOP 1 wItemID AS itemId, bStack AS stack FROM ${db.tables.items} WHERE bStack >= 20 ORDER BY wItemID`,
      );
    stackable = stacks.recordset[0];
  });

  afterAll(() => db.onModuleDestroy());

  const input = (overrides: Partial<AwardInput> = {}): AwardInput => ({
    userId: character.userId,
    achievementId: 'kills',
    level: 2,
    charId: character.charId,
    sender: 'Achievements',
    title: 'Achievement: Slayer II',
    message: 'You completed Slayer II: Defeat 10,000 monsters.',
    gold: 0,
    silver: 0,
    copper: 0,
    items: [],
    text: `${character.name} completed Slayer II: Defeat 10,000 monsters`,
    ...overrides,
  });

  /** Creates the tables and procedures inside tx, so the rollback removes them again. */
  async function withRepo(fn: (repo: SqlAchievementsRepository, tx: sql.Transaction) => Promise<void>) {
    await inRolledBackTransaction(db, async (tx) => {
      for (const batch of setupSql) {
        await new sql.Request(tx).input('sql', sql.NVarChar(sql.MAX), batch).query(`EXEC [${gameName}].sys.sp_executesql @sql`);
      }
      await fn(new SqlAchievementsRepository(db).withTransaction(tx), tx);
    });
  }

  const count = async (tx: sql.Transaction, table: string, where: string) =>
    (await new sql.Request(tx).query<{ n: number }>(`SELECT COUNT(*) AS n FROM [${gameName}].dbo.${table} WHERE ${where}`)).recordset[0].n;

  it('sends the letter with its reward and records the award together', async () => {
    await withRepo(async (repo, tx) => {
      const id = await repo.award(input({ gold: 12, silver: 340, copper: 5, items: [{ itemId: stackable.itemId, count: 3 }] }));
      expect(id).toBeGreaterThan(0);

      const award = (
        await new sql.Request(tx).input('id', sql.Int, id).query<{
          dwUserID: number;
          szAchievement: string;
          bLevel: number;
          dwCharID: number;
          dwPostID: number;
          dwGold: number;
          dwSilver: number;
          dwCooper: number;
          szItems: string;
          szText: string;
          bAnnounced: number;
        }>(`SELECT * FROM [${gameName}].dbo.TPORTALACHIEVEMENTTABLE WHERE dwID = @id`)
      ).recordset[0];
      expect(award).toMatchObject({
        dwUserID: character.userId,
        szAchievement: 'kills',
        bLevel: 2,
        dwCharID: character.charId,
        dwGold: 12,
        dwSilver: 340,
        dwCooper: 5,
        szItems: `${stackable.itemId}x3`,
        szText: `${character.name} completed Slayer II: Defeat 10,000 monsters`,
        bAnnounced: ANNOUNCE_WAITING,
      });

      const post = (
        await new sql.Request(tx)
          .input('id', sql.Int, award.dwPostID)
          .query<{ dwCharID: number; szSender: string; szTitle: string; bType: number; dwGold: number; dwSilver: number; dwCooper: number }>(
            `SELECT dwCharID, szSender, szTitle, bType, dwGold, dwSilver, dwCooper FROM [${gameName}].dbo.TPOSTTABLE WHERE dwPostID = @id`,
          )
      ).recordset[0];
      // Title behind the game's 8 hex digit length prefix.
      expect(post).toMatchObject({ dwCharID: character.charId, szSender: 'Achievements', bType: 6, dwGold: 12, dwSilver: 340, dwCooper: 5 });
      expect(post.szTitle.slice(8)).toBe('Achievement: Slayer II');

      expect(await count(tx, 'TITEMTABLE', `bStorageType = 2 AND dwStorageID = ${award.dwPostID} AND wItemID = ${stackable.itemId} AND bCount = 3`)).toBe(1);
      expect(await count(tx, 'TPORTALPOSTNOTIFY', `dwPostID = ${award.dwPostID}`)).toBe(1);
    });
  });

  it('lists three items in the award', async () => {
    await withRepo(async (repo, tx) => {
      const item = { itemId: stackable.itemId, count: 1 };
      const id = await repo.award(input({ items: [item, { ...item, count: 2 }, { ...item, count: 3 }] }));
      const row = (await new sql.Request(tx).query<{ szItems: string }>(`SELECT szItems FROM [${gameName}].dbo.TPORTALACHIEVEMENTTABLE WHERE dwID = ${id}`)).recordset[0];
      expect(row.szItems).toBe(`${stackable.itemId}x1,${stackable.itemId}x2,${stackable.itemId}x3`);
    });
  });

  it('awards a level once: the second call sends no letter', async () => {
    await withRepo(async (repo, tx) => {
      const first = await repo.award(input());
      expect(first).toBeGreaterThan(0);
      expect(await repo.award(input({ gold: 50 }))).toBe(AWARD_ALREADY_GIVEN);

      expect(await count(tx, 'TPORTALACHIEVEMENTTABLE', `dwUserID = ${character.userId}`)).toBe(1);
      expect(await count(tx, 'TPOSTTABLE', `dwCharID = ${character.charId} AND szSender = 'Achievements'`)).toBe(1);
    });
  });

  it('treats another level, and another account, as separate awards', async () => {
    await withRepo(async (repo) => {
      await repo.award(input());
      expect(await repo.award(input({ level: 3 }))).toBeGreaterThan(0);
      expect(await repo.award(input({ userId: character.userId + 1_000_000 }))).toBeGreaterThan(0);
      expect(await repo.awards()).toHaveLength(3);
    });
  });

  it('writes nothing for a character that does not exist', async () => {
    await withRepo(async (repo, tx) => {
      expect(await repo.award(input({ charId: 2_000_000_000 }))).toBe(AWARD_NO_CHARACTER);
      expect(await repo.awards()).toEqual([]);
      expect(await count(tx, 'TPOSTTABLE', `szSender = 'Achievements'`)).toBe(0);
      // The level can still be awarded once the account has a character again.
      expect(await repo.award(input())).toBeGreaterThan(0);
    });
  });

  it('reads the awards back oldest first, and marks them announced', async () => {
    await withRepo(async (repo) => {
      const first = await repo.award(input({ level: 1, text: 'first' }));
      const second = await repo.award(input({ level: 2, text: 'second' }));
      await repo.markAnnounced(first, ANNOUNCE_SENT);

      const awards = await repo.awards();
      expect(awards.map(({ id, level, text, announced }) => ({ id, level, text, announced }))).toEqual([
        { id: first, level: 1, text: 'first', announced: ANNOUNCE_SENT },
        { id: second, level: 2, text: 'second', announced: ANNOUNCE_WAITING },
      ]);
      expect(awards[0]).toMatchObject({ userId: character.userId, achievementId: 'kills' });
      expect(awards[0].earnedAt).toBeInstanceOf(Date);
    });
  });

  it('picks one recipient for each account with a live character', async () => {
    await withRepo(async (repo, tx) => {
      const recipients = await repo.recipients();
      const accounts = (await new sql.Request(tx).query<{ n: number }>(`SELECT COUNT(DISTINCT dwUserID) AS n FROM ${db.tables.characters} WHERE bDelete = 0`)).recordset[0].n;
      expect(recipients).toHaveLength(accounts);
      expect(new Set(recipients.map((recipient) => recipient.userId)).size).toBe(accounts);
      const mine = recipients.find((recipient) => recipient.userId === character.userId)!;
      expect(await count(tx, 'TCHARTABLE', `dwCharID = ${mine.charId} AND dwUserID = ${character.userId} AND bDelete = 0`)).toBe(1);
      expect(mine.name.length).toBeGreaterThan(0);
    });
  });

  it('prefers the character that is online', async () => {
    await withRepo(async (repo, tx) => {
      const online = (
        await new sql.Request(tx).query<{ charId: number; userId: number }>(
          `SELECT TOP 1 u.dwCharID AS charId, c.dwUserID AS userId FROM ${db.tables.currentUsers} u
           JOIN ${db.tables.characters} c ON c.dwCharID = u.dwCharID AND c.bDelete = 0`,
        )
      ).recordset[0];
      // Nobody is logged in to the copy most of the time.
      if (!online) return;
      expect((await repo.recipients()).find((recipient) => recipient.userId === online.userId)!.charId).toBe(online.charId);
    });
  });

  it('answers whether anyone has played lately', async () => {
    await withRepo(async (repo) => {
      expect(typeof (await repo.recentlyActive(10))).toBe('boolean');
      // Far enough back to include every logout there has ever been.
      expect(await repo.recentlyActive(50 * 365 * 24 * 60)).toBe(true);
    });
  });

  it('finds reward items by ID', async () => {
    await withRepo(async (repo) => {
      expect(await repo.findItems([])).toEqual([]);
      const found = await repo.findItems([stackable.itemId, 32767]);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ itemId: stackable.itemId, stack: stackable.stack });
    });
  });
});
