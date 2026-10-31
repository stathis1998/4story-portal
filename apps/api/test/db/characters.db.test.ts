import { afterAll, beforeAll, expect, it } from 'vitest';
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
