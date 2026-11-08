import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { SqlAccountsRepository } from '../../src/auth/accounts.repository.js';
import { SqlCharactersRepository } from '../../src/characters/characters.repository.js';
import type { DbService } from '../../src/db/db.service.js';
import { connectTestDb } from './db-test-helpers.js';

let db: DbService;
let repo: SqlCharactersRepository;
let userId: number;
let charId: number;

beforeAll(async () => {
  db = await connectTestDb();
  repo = new SqlCharactersRepository(db);
  userId = (await new SqlAccountsRepository(db).findByUsername('moose'))!.userId;
  charId = (await repo.listByUser(userId))[0].dwCharID;
});

afterEach(() => repo.saveLevelFreeze(charId, null));
afterAll(() => db.onModuleDestroy());

it('adds, changes and removes a freeze', async () => {
  await repo.saveLevelFreeze(charId, 50);
  expect((await repo.findLevelFreeze(userId, charId))?.freezeLevel).toBe(50);

  await repo.saveLevelFreeze(charId, 60);
  expect((await repo.findLevelFreeze(userId, charId))?.freezeLevel).toBe(60);

  await repo.saveLevelFreeze(charId, null);
  expect((await repo.findLevelFreeze(userId, charId))?.freezeLevel).toBeNull();
});

it('reports the online flag as a boolean', async () =>
  expect(typeof (await repo.findLevelFreeze(userId, charId))?.online).toBe('boolean'));

it("finds nothing through another account's ID", async () =>
  expect(await repo.findLevelFreeze(userId + 1000000, charId)).toBeNull());
