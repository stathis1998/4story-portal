import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SqlAccountsRepository } from '../../src/auth/accounts.repository.js';
import { sha1Hex } from '../../src/auth/sha1.js';
import type { DbService } from '../../src/db/db.service.js';
import { connectTestDb, inRolledBackTransaction } from './db-test-helpers.js';

describe('SqlAccountsRepository against the _TEST copy', () => {
  let db: DbService;
  let repo: SqlAccountsRepository;

  beforeAll(async () => {
    db = await connectTestDb();
    repo = new SqlAccountsRepository(db);
  });

  afterAll(() => db.onModuleDestroy());

  it('creates an account row and its agreement row like the existing accounts', () =>
    inRolledBackTransaction(db, async (tx) => {
      const userId = await repo.createAccountIn(tx, 'PortalTest1', sha1Hex('secret1'));
      expect(userId).toEqual(expect.any(Number));

      const account = await new sql.Request(tx)
        .input('id', sql.Int, userId)
        .query(`SELECT szPasswd, bCheck FROM ${db.tables.accounts} WHERE dwUserID = @id`);
      expect(account.recordset[0]).toEqual({ szPasswd: sha1Hex('secret1'), bCheck: 0 });
      expect(account.recordset[0].szPasswd).toMatch(/^[0-9a-f]{40}$/);

      const info = await new sql.Request(tx)
        .input('id', sql.Int, userId)
        .query(`SELECT bAgreement, bCanCreateCharCount FROM ${db.tables.userInfo} WHERE dwUserID = @id`);
      expect(info.recordset[0]).toEqual({ bAgreement: 1, bCanCreateCharCount: 6 });
    }));

  it('rejects the same name in different case', () =>
    inRolledBackTransaction(db, async (tx) => {
      expect(await repo.createAccountIn(tx, 'PortalTest1', sha1Hex('secret1'))).toEqual(expect.any(Number));
      expect(await repo.createAccountIn(tx, 'portaltest1', sha1Hex('secret1'))).toBeNull();
    }));

  it('leaves nothing behind after rollback', async () =>
    expect(await repo.findByUsername('PortalTest1')).toBeNull());

  it('finds an account case-insensitively and returns the stored spelling', async () =>
    expect(await repo.findByUsername('MOOSE')).toMatchObject({ username: 'moose' }));
});
