import { readFileSync } from 'node:fs';
import path from 'node:path';
import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/config.js';
import type { DbService } from '../../src/db/db.service.js';
import { type MailLetter, SqlMailRepository } from '../../src/gm/mail.repository.js';
import { connectTestDb, inRolledBackTransaction } from './db-test-helpers.js';

// Run in this order inside each test's transaction: the table, then the procedures that use it.
const setupSql = ['TPORTALPOSTNOTIFY.sql', 'TPortalGmPost.sql', 'TGetReservedPost.sql'].map((file) =>
  readFileSync(path.resolve(process.cwd(), 'sql', file), 'utf8'),
);

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

  /** Creates the table and procedures inside tx, so the rollback removes them again. */
  async function withRepo(fn: (repo: SqlMailRepository, tx: sql.Transaction) => Promise<void>) {
    await inRolledBackTransaction(db, async (tx) => {
      for (const batch of setupSql) {
        await new sql.Request(tx)
          .input('sql', sql.NVarChar(sql.MAX), batch)
          .query(`EXEC [${gameName}].sys.sp_executesql @sql`);
      }
      await fn(new SqlMailRepository(db).withTransaction(tx), tx);
    });
  }

  type ReservedCall = { ret: number; postId: number | null; sender: string | null; recver: string | null; title: string | null };

  /** Calls TGetReservedPost the way the world server does, with every parameter as an output. */
  async function getReservedPost(tx: sql.Transaction): Promise<ReservedCall> {
    const params = await new sql.Request(tx).query<{ name: string; type: string; len: number }>(
      `SELECT name, TYPE_NAME(user_type_id) AS type, max_length AS len FROM [${gameName}].sys.parameters
       WHERE object_id = OBJECT_ID('[${gameName}].dbo.TGetReservedPost') ORDER BY parameter_id`,
    );
    const local = (name: string) => `@v_${name.slice(1)}`;
    const declare = params.recordset
      .map((p) => `DECLARE ${local(p.name)} ${p.type}${p.type === 'varchar' ? `(${p.len})` : ''};`)
      .join('\n');
    const args = params.recordset.map((p) => `${p.name} = ${local(p.name)} OUTPUT`).join(', ');
    const result = await new sql.Request(tx).query<ReservedCall>(
      `DECLARE @r INT;
       ${declare}
       EXEC @r = [${gameName}].dbo.TGetReservedPost ${args};
       SELECT @r AS ret, @v_dwPostID AS postId, @v_szSender AS sender, @v_szRecver AS recver, @v_szTitle AS title;`,
    );
    return result.recordset[0];
  }

  async function notifyRows(tx: sql.Transaction): Promise<{ dwPostID: number; dwCharID: number }[]> {
    const result = await new sql.Request(tx).query<{ dwPostID: number; dwCharID: number }>(
      `SELECT dwPostID, dwCharID FROM [${gameName}].dbo.TPORTALPOSTNOTIFY ORDER BY dwPostID`,
    );
    return result.recordset;
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

  it('listCharacters returns every live character, sorted, with an online flag', () =>
    withRepo(async (repo, tx) => {
      const live = await new sql.Request(tx).query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM ${db.tables.characters} WHERE bDelete = 0`,
      );
      const before = await repo.listCharacters();
      expect(before).toHaveLength(live.recordset[0].n);
      expect(before.some((r) => r.charId === deleted.charId)).toBe(false);
      expect(before.find((r) => r.charId === character.charId)).toEqual({
        charId: character.charId,
        name: character.name,
        level: expect.any(Number),
        classCode: expect.any(Number),
        online: false,
      });
      const names = before.map((r) => r.name.toLowerCase());
      expect(names).toEqual([...names].sort());

      // A TCURRENTUSER row for the character marks it online.
      await new sql.Request(tx)
        .input('id', sql.Int, character.charId)
        .query(
          `INSERT INTO ${db.tables.currentUsers} (dwUserID, dwCharID, bGroupID, bChannel, wPort, bLocked, szLoginIP)
           VALUES (999999, @id, 1, 1, 0, 0, '127.0.0.1')`,
        );
      expect((await repo.listCharacters()).find((r) => r.charId === character.charId)?.online).toBe(true);
    }));

  it('findItems returns stack and name', () =>
    withRepo(async (repo) => {
      const rows = await repo.findItems([stackable.itemId, 32767]);
      expect(rows).toEqual([{ itemId: stackable.itemId, name: expect.any(String), stack: stackable.stack }]);
    }));

  describe('new-mail notification for online recipients', () => {
    it('queues a notification with each letter', () =>
      withRepo(async (repo, tx) => {
        const postId = await repo.sendLetter(letter());
        expect(await notifyRows(tx)).toEqual([{ dwPostID: postId, dwCharID: character.charId }]);
      }));

    it('queues nothing when the character is missing', () =>
      withRepo(async (repo, tx) => {
        await repo.sendLetter(letter({ charId: deleted.charId }));
        expect(await notifyRows(tx)).toEqual([]);
      }));

    it('hands each notification to the world server once, without writing a letter', () =>
      withRepo(async (repo, tx) => {
        const postId = await repo.sendLetter(letter({ title: 'Hello' }));
        const before = await postCount(tx);
        expect(await getReservedPost(tx)).toEqual({
          ret: 0,
          postId,
          sender: '[GM]',
          recver: character.name,
          title: '00000005Hello',
        });
        expect(await notifyRows(tx)).toEqual([]);
        expect(await postCount(tx)).toBe(before);
        expect((await getReservedPost(tx)).ret).toBe(1);
      }));

    it('hands out notifications oldest letter first', () =>
      withRepo(async (repo, tx) => {
        const first = await repo.sendLetter(letter());
        const second = await repo.sendLetter(letter());
        expect((await getReservedPost(tx)).postId).toBe(first);
        expect((await getReservedPost(tx)).postId).toBe(second);
      }));

    it('drops a notification older than 10 minutes', () =>
      withRepo(async (repo, tx) => {
        await repo.sendLetter(letter());
        await new sql.Request(tx).query(
          `UPDATE [${gameName}].dbo.TPORTALPOSTNOTIFY SET dCreated = DATEADD(MINUTE, -11, GETDATE())`,
        );
        expect((await getReservedPost(tx)).ret).toBe(1);
        expect(await notifyRows(tx)).toEqual([]);
      }));

    it('drops a notification whose letter is gone and moves on to the next', () =>
      withRepo(async (repo, tx) => {
        const gone = await repo.sendLetter(letter());
        const kept = await repo.sendLetter(letter());
        await new sql.Request(tx)
          .input('id', sql.Int, gone)
          .query(`DELETE FROM [${gameName}].dbo.TPOSTTABLE WHERE dwPostID = @id`);
        expect((await getReservedPost(tx)).postId).toBe(kept);
      }));

    it('still delivers a reserved post as the game did before', () =>
      withRepo(async (_repo, tx) => {
        await new sql.Request(tx)
          .input('id', sql.Int, character.charId)
          .input('item', sql.SmallInt, single)
          .query(
            `INSERT INTO [${gameName}].dbo.TRESERVEDPOST
               (dwRecverID, szSender, szTitle, szMessage, bSend, wItemID, bLevel, bCount, bGLevel, dwDuraMax, dwDuraCur,
                bRefineCur, dEndTime, bGradeEffect, bMagic1, bMagic2, bMagic3, bMagic4, bMagic5, bMagic6,
                wValue1, wValue2, wValue3, wValue4, wValue5, wValue6, dwTime1, dwTime2, dwTime3, dwTime4, dwTime5, dwTime6,
                bGem, wMoggItemID)
             VALUES (@id, 'Team', '00000002Hi', '00000000', 0, @item, 0, 1, 0, 0, 0,
                0, '1900-01-01', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)`,
          );
        const call = await getReservedPost(tx);
        expect(call).toMatchObject({ ret: 0, sender: 'Team', recver: character.name, title: '00000002Hi' });
        expect(await post(tx, call.postId!)).toMatchObject({ bType: 1, szRecvName: character.name });
        expect(await attached(tx, call.postId!)).toHaveLength(1);
      }));
  });
});
