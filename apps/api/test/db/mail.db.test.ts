import { readFileSync } from 'node:fs';
import path from 'node:path';
import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/config.js';
import type { DbService } from '../../src/db/db.service.js';
import { type MailLetter, SqlMailRepository } from '../../src/gm/mail.repository.js';
import { connectTestDb, inRolledBackTransaction } from './db-test-helpers.js';

const procedureSql = readFileSync(path.resolve(process.cwd(), 'sql/TPortalGmPost.sql'), 'utf8');

type PostRow = {
  bType: number;
  bRead: number;
  dwGold: number;
  dwSilver: number;
  dwCooper: number;
  szRecvName: string;
  szTitle: string;
  szMessage: string;
};

type AttachedItem = {
  dlID: string;
  wItemID: number;
  bOwnerType: number;
  dwOwnerID: number;
  bCount: number;
  dEndTime: Date;
  dwTime2: number;
};

describe('SqlMailRepository against the _TEST copy', () => {
  let db: DbService;
  let gameName: string;
  let character: { charId: number; name: string };
  let deleted: { charId: number; name: string };
  let stackable: { itemId: number; stack: number };
  let single: number;

  beforeAll(async () => {
    db = await connectTestDb();
    gameName = loadConfig(process.env).db.gameName;
    const chars = await db.pool
      .request()
      .query<{ charId: number; name: string }>(
        `SELECT TOP 1 dwCharID AS charId, szName AS name FROM ${db.tables.characters} WHERE bDelete = 0 ORDER BY dwCharID`,
      );
    character = chars.recordset[0];
    const gone = await db.pool
      .request()
      .query<{ charId: number; name: string }>(
        `SELECT TOP 1 d.dwCharID AS charId, d.szName AS name FROM ${db.tables.characters} d
         WHERE d.bDelete <> 0
           AND NOT EXISTS (SELECT 1 FROM ${db.tables.characters} l WHERE l.szName = d.szName AND l.bDelete = 0)
         ORDER BY d.dwCharID`,
      );
    deleted = gone.recordset[0];
    const stacks = await db.pool
      .request()
      .query<{ itemId: number; stack: number }>(
        `SELECT TOP 1 wItemID AS itemId, bStack AS stack FROM ${db.tables.items} WHERE bStack >= 20 ORDER BY wItemID`,
      );
    stackable = stacks.recordset[0];
    const singles = await db.pool
      .request()
      .query<{ itemId: number }>(`SELECT TOP 1 wItemID AS itemId FROM ${db.tables.items} WHERE bStack = 1 ORDER BY wItemID`);
    single = singles.recordset[0].itemId;
  });

  afterAll(() => db.onModuleDestroy());

  const letter = (overrides: Partial<MailLetter> = {}): MailLetter => ({
    charId: character.charId,
    sender: '[GM]',
    title: 'Hello',
    message: 'Have fun',
    gold: 0,
    silver: 0,
    copper: 0,
    items: [],
    ...overrides,
  });

  /** Creates the procedure inside tx, so the rollback removes it again. */
  async function withRepo(fn: (repo: SqlMailRepository, tx: sql.Transaction) => Promise<void>) {
    await inRolledBackTransaction(db, async (tx) => {
      await new sql.Request(tx)
        .input('sql', sql.NVarChar(sql.MAX), procedureSql)
        .query(`EXEC [${gameName}].sys.sp_executesql @sql`);
      await fn(new SqlMailRepository(db).withTransaction(tx), tx);
    });
  }

  async function post(tx: sql.Transaction, postId: number): Promise<PostRow> {
    const result = await new sql.Request(tx)
      .input('id', sql.Int, postId)
      .query<PostRow>(
        `SELECT bType, bRead, dwGold, dwSilver, dwCooper, szRecvName, szTitle, szMessage
         FROM [${gameName}].dbo.TPOSTTABLE WHERE dwPostID = @id`,
      );
    return result.recordset[0];
  }

  async function attached(tx: sql.Transaction, postId: number): Promise<AttachedItem[]> {
    const result = await new sql.Request(tx)
      .input('id', sql.Int, postId)
      .query<AttachedItem>(
        `SELECT CAST(dlID AS VARCHAR(20)) AS dlID, wItemID, bOwnerType, dwOwnerID, bCount, dEndTime, dwTime2
         FROM ${db.tables.characterItems} WHERE bStorageType = 2 AND dwStorageID = @id ORDER BY dlID`,
      );
    return result.recordset;
  }

  async function postCount(tx: sql.Transaction): Promise<number> {
    const result = await new sql.Request(tx).query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM [${gameName}].dbo.TPOSTTABLE`,
    );
    return result.recordset[0].n;
  }

  it('sends a letter with no attachments', () =>
    withRepo(async (repo, tx) => {
      const postId = await repo.sendLetter(letter());
      expect(postId).toBeGreaterThan(0);
      expect(await post(tx, postId)).toMatchObject({
        bType: 6,
        bRead: 0,
        dwGold: 0,
        dwSilver: 0,
        dwCooper: 0,
        szRecvName: character.name,
      });
      expect(await attached(tx, postId)).toEqual([]);
    }));

  it('stores money as passed', () =>
    withRepo(async (repo, tx) => {
      const postId = await repo.sendLetter(letter({ gold: 12, silver: 345, copper: 678 }));
      expect(await post(tx, postId)).toMatchObject({ dwGold: 12, dwSilver: 345, dwCooper: 678 });
    }));

  it('attaches three items to the letter', () =>
    withRepo(async (repo, tx) => {
      const items = [
        { itemId: stackable.itemId, count: 20 },
        { itemId: single, count: 1 },
        { itemId: stackable.itemId, count: 5 },
      ];
      const postId = await repo.sendLetter(letter({ items }));
      const rows = await attached(tx, postId);
      expect(rows).toHaveLength(3);
      expect(new Set(rows.map((r) => r.dlID)).size).toBe(3);
      expect(rows.map((r) => [r.wItemID, r.bCount])).toEqual(items.map((i) => [i.itemId, i.count]));
      for (const row of rows) {
        expect(row).toMatchObject({ bOwnerType: 0, dwOwnerID: character.charId, dwTime2: 0 });
        expect(row.dEndTime.getUTCFullYear()).toBe(1900);
      }
    }));

  it('prefixes title and message like the game', () =>
    withRepo(async (repo, tx) => {
      const postId = await repo.sendLetter(letter({ title: 'Hello', message: '' }));
      expect(await post(tx, postId)).toMatchObject({ szTitle: '00000005Hello', szMessage: '00000000' });
    }));

  it('returns 0 and writes nothing for a deleted or missing character', () =>
    withRepo(async (repo, tx) => {
      const before = await postCount(tx);
      expect(await repo.sendLetter(letter({ charId: 2147483000, items: [{ itemId: single, count: 1 }] }))).toBe(0);
      expect(await repo.sendLetter(letter({ charId: deleted.charId }))).toBe(0);
      expect(await postCount(tx)).toBe(before);
    }));

  it('findCharacters matches case-insensitively and skips deleted', () =>
    withRepo(async (repo) => {
      expect(await repo.findCharacters([character.name.toUpperCase()])).toEqual([
        { charId: character.charId, name: character.name },
      ]);
      expect(await repo.findCharacters(['NoSuchCharacterXyz'])).toEqual([]);
      expect(await repo.findCharacters([deleted.name])).toEqual([]);
      expect(await repo.findCharacters([])).toEqual([]);
    }));

  it('findItems returns stack and name', () =>
    withRepo(async (repo) => {
      const rows = await repo.findItems([stackable.itemId, 32767]);
      expect(rows).toEqual([{ itemId: stackable.itemId, name: expect.any(String), stack: stackable.stack }]);
    }));
});
