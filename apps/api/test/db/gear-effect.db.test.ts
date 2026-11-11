import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SqlCharactersRepository } from '../../src/characters/characters.repository.js';
import type { DbService } from '../../src/db/db.service.js';
import { connectTestDb, inRolledBackTransaction } from './db-test-helpers.js';

let db: DbService;

beforeAll(async () => {
  db = await connectTestDb();
});
afterAll(() => db.onModuleDestroy());

type ItemRow = { id: string; storage: number; level: number; effect: number };

// Everything runs in a rolled-back transaction: the repository is handed the transaction as its pool.
async function withCharacter(
  fn: (ctx: { repo: SqlCharactersRepository; tx: sql.Transaction; userId: number; charId: number; worn: ItemRow[]; bag: ItemRow | null }) => Promise<void>,
) {
  await inRolledBackTransaction(db, async (tx) => {
    const { characters, characterItems, items } = db.tables;
    // A character wearing at least two items of a kind that can carry an effect.
    const picked = await new sql.Request(tx).query<{ charId: number; userId: number }>(
      `SELECT TOP 1 c.dwCharID AS charId, c.dwUserID AS userId
       FROM ${characters} c
       JOIN ${characterItems} i ON i.dwOwnerID = c.dwCharID AND i.bOwnerType = 0 AND i.bStorageType = 0 AND i.dwStorageID = 254
       JOIN ${items} chart ON chart.wItemID = i.wItemID AND chart.bKind NOT IN (19, 90)
       WHERE c.bDelete = 0
       GROUP BY c.dwCharID, c.dwUserID
       HAVING COUNT(*) >= 2
       ORDER BY c.dwCharID`,
    );
    const { charId, userId } = picked.recordset[0];
    const all = async () =>
      (
        await new sql.Request(tx).input('charId', sql.Int, charId).query<ItemRow>(
          `SELECT CAST(i.dlID AS varchar(30)) AS id, i.dwStorageID AS storage, i.bLevel AS level, i.bGradeEffect AS effect
           FROM ${characterItems} i
           JOIN ${items} chart ON chart.wItemID = i.wItemID AND chart.bKind NOT IN (19, 90)
           WHERE i.dwOwnerID = @charId AND i.bOwnerType = 0 AND i.bStorageType = 0
           ORDER BY i.dlID`,
        )
      ).recordset;
    const before = await all();
    const worn = before.filter((row) => row.storage === 254).slice(0, 2);
    const bag = before.find((row) => row.storage !== 254) ?? null;

    // One worn item at +20, one at +16, and a bag item at +20; all without an effect.
    const setLevel = (row: ItemRow, level: number) =>
      new sql.Request(tx)
        .input('id', sql.BigInt, row.id)
        .input('level', sql.TinyInt, level)
        .query(`UPDATE ${characterItems} SET bLevel = @level, bGradeEffect = 0 WHERE dlID = @id`);
    await setLevel(worn[0], 20);
    await setLevel(worn[1], 16);
    if (bag) await setLevel(bag, 20);

    const repo = new SqlCharactersRepository({ pool: tx, tables: db.tables } as unknown as DbService);
    await fn({ repo, tx, userId, charId, worn, bag });
  });
}

const effectOf = async (tx: sql.Transaction, id: string) =>
  (
    await new sql.Request(tx)
      .input('id', sql.BigInt, id)
      .query<{ effect: number }>(`SELECT bGradeEffect AS effect FROM ${db.tables.characterItems} WHERE dlID = @id`)
  ).recordset[0].effect;

describe('gear effect', () => {
  it('lists worn items at +17 or higher and none below', () =>
    withCharacter(async ({ repo, userId, charId }) => {
      const found = await repo.findGearEffect(userId, charId);

      expect(found?.online).toBe(false);
      expect(found?.items.every((item) => item.upgrade >= 17)).toBe(true);
      expect(found?.items.some((item) => item.upgrade === 20 && item.effect === 0)).toBe(true);
    }));

  it('sets the effect on worn +17 items only, leaving lower and unworn items alone', () =>
    withCharacter(async ({ repo, tx, charId, worn, bag }) => {
      const changed = await repo.saveGearEffect(charId, 12);

      expect(changed).toBeGreaterThanOrEqual(1);
      expect(await effectOf(tx, worn[0].id)).toBe(12);
      expect(await effectOf(tx, worn[1].id)).toBe(0);
      if (bag) expect(await effectOf(tx, bag.id)).toBe(0);
    }));

  it('changes nothing while the character is online', () =>
    withCharacter(async ({ repo, tx, userId, charId, worn }) => {
      await new sql.Request(tx)
        .input('id', sql.Int, charId)
        .query(
          `INSERT INTO ${db.tables.currentUsers} (dwUserID, dwCharID, bGroupID, bChannel, wPort, bLocked, szLoginIP)
           VALUES (999999, @id, 1, 1, 0, 0, '127.0.0.1')`,
        );

      expect(await repo.saveGearEffect(charId, 12)).toBe(0);
      expect(await effectOf(tx, worn[0].id)).toBe(0);
      expect((await repo.findGearEffect(userId, charId))?.online).toBe(true);
    }));

  it("finds nothing through another account's ID", () =>
    withCharacter(async ({ repo, userId, charId }) => expect(await repo.findGearEffect(userId + 1000000, charId)).toBeNull()));
});
