import sql from 'mssql';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { SqlAccountsRepository } from '../../src/auth/accounts.repository.js';
import { SqlCharactersRepository } from '../../src/characters/characters.repository.js';
import type { DbService } from '../../src/db/db.service.js';
import { connectTestDb } from './db-test-helpers.js';

let db: DbService;

beforeAll(async () => {
  db = await connectTestDb();
});

afterAll(() => db.onModuleDestroy());

it("lists moose's live characters in slot order", async () => {
  const moose = await new SqlAccountsRepository(db).findByUsername('moose');
  const rows = await new SqlCharactersRepository(db).listByUser(moose!.userId);

  const slots = rows.map((r) => r.bSlot);
  expect(rows).toHaveLength(3);
  expect(slots).toEqual(rows.map((r) => r.bSlot).sort((a, b) => a - b));
});

let reborn: number | null = null;

afterEach(async () => {
  if (reborn === null) return;
  await db.pool.request().input('charId', sql.Int, reborn).query(`DELETE FROM ${db.tables.rebirths} WHERE dwCharID = @charId`);
  reborn = null;
});

it('lists the rebirth number of each character, 0 in the first life', async () => {
  const moose = await new SqlAccountsRepository(db).findByUsername('moose');
  const repo = new SqlCharactersRepository(db);
  const before = await repo.listByUser(moose!.userId);
  expect(before.every((row) => row.rebirth === 0)).toBe(true);

  reborn = before[0].dwCharID;
  await db.pool.request().input('charId', sql.Int, reborn).query(`INSERT INTO ${db.tables.rebirths} (dwCharID, bRebirth, bStatBonus) VALUES (@charId, 2, 4)`);
  const after = await repo.listByUser(moose!.userId);
  expect(after.map((row) => [row.dwCharID, row.rebirth])).toEqual(before.map((row) => [row.dwCharID, row.dwCharID === reborn ? 2 : 0]));
});
