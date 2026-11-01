import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SqlAccountsRepository } from '../../src/auth/accounts.repository.js';
import type { DbService } from '../../src/db/db.service.js';
import { SqlGmRepository } from '../../src/gm/gm.repository.js';
import { connectTestDb, inRolledBackTransaction } from './db-test-helpers.js';

describe('SqlGmRepository against the _TEST copy', () => {
  let db: DbService;
  let repo: SqlGmRepository;

  beforeAll(async () => {
    db = await connectTestDb();
    repo = new SqlGmRepository(db);
  });

  afterAll(() => db.onModuleDestroy());

  it('lists a character with a TCURRENTUSER row as online', () =>
    inRolledBackTransaction(db, async (tx) => {
      const account = await new SqlAccountsRepository(db).findByUsername('moose');
      const char = await new sql.Request(tx)
        .input('userId', sql.Int, account!.userId)
        .query(`SELECT TOP 1 dwCharID, szNAME FROM ${db.tables.characters} WHERE dwUserID = @userId AND bDelete = 0`);
      const { dwCharID, szNAME } = char.recordset[0];

      await new sql.Request(tx).input('charId', sql.Int, dwCharID).query(
        `SET IDENTITY_INSERT ${db.tables.currentUsers} ON;
         INSERT INTO ${db.tables.currentUsers}
           (dwKEY, dwUserID, dwCharID, bGroupID, bChannel, wPort, bLocked, dLoginDate, dEnterDate, dwPcBangID, bLuckyNumber, szLoginIP)
         VALUES (999999, ${account!.userId}, @charId, 1, 2, 0, 0, GETDATE(), GETDATE(), 0, 0, '127.0.0.1');
         SET IDENTITY_INSERT ${db.tables.currentUsers} OFF;`,
      );

      const online = await repo.withTransaction(tx).listOnlinePlayers();
      expect(online).toContainEqual(expect.objectContaining({ charId: dwCharID, name: szNAME, world: 1, channel: 2 }));
    }));

  describe('logins', () => {
    const KEY = 999999;

    async function insertLogin(tx: sql.Transaction, values: { key: number; userId: number; charId: number; locked: number }) {
      await new sql.Request(tx).query(
        `SET IDENTITY_INSERT ${db.tables.currentUsers} ON;
         INSERT INTO ${db.tables.currentUsers}
           (dwKEY, dwUserID, dwCharID, bGroupID, bChannel, wPort, bLocked, dLoginDate, dEnterDate, dwPcBangID, bLuckyNumber, szLoginIP)
         VALUES (${values.key}, ${values.userId}, ${values.charId}, 1, 2, 0, ${values.locked}, '2026-10-31T23:37:25.553', GETDATE(), 0, 0, '127.0.0.1');
         SET IDENTITY_INSERT ${db.tables.currentUsers} OFF;`,
      );
    }

    async function firstCharacter(tx: sql.Transaction, userId: number) {
      const char = await new sql.Request(tx)
        .input('userId', sql.Int, userId)
        .query(`SELECT TOP 1 dwCharID, szNAME FROM ${db.tables.characters} WHERE dwUserID = @userId AND bDelete = 0`);
      return char.recordset[0] as { dwCharID: number; szNAME: string };
    }

    it('lists a login with its account and character, blocked logins first', () =>
      inRolledBackTransaction(db, async (tx) => {
        const account = await new SqlAccountsRepository(db).findByUsername('moose');
        const { dwCharID, szNAME } = await firstCharacter(tx, account!.userId);
        await new sql.Request(tx).query(`DELETE ${db.tables.currentUsers}`);
        await insertLogin(tx, { key: KEY - 1, userId: 999001, charId: 0, locked: 0 });
        await insertLogin(tx, { key: KEY, userId: account!.userId, charId: dwCharID, locked: 1 });

        const logins = await repo.withTransaction(tx).listLogins();

        expect(logins).toEqual([
          {
            key: KEY,
            account: 'moose',
            character: szNAME,
            world: 1,
            channel: 2,
            blocked: true,
            loggedInAt: new Date('2026-10-31T23:37:25.553Z'),
          },
          expect.objectContaining({ key: KEY - 1, account: '#999001', character: null, blocked: false }),
        ]);
      }));

    it('finds a login by key, and null once it is gone', () =>
      inRolledBackTransaction(db, async (tx) => {
        await insertLogin(tx, { key: KEY, userId: 999001, charId: 0, locked: 0 });
        const scoped = repo.withTransaction(tx);

        expect(await scoped.findLogin(KEY)).toEqual(expect.objectContaining({ key: KEY }));
        expect(await scoped.findLogin(KEY - 1)).toBeNull();
      }));

    it('deletes only the login with that key and says whether it did', () =>
      inRolledBackTransaction(db, async (tx) => {
        await insertLogin(tx, { key: KEY, userId: 999001, charId: 0, locked: 0 });
        await insertLogin(tx, { key: KEY - 1, userId: 999002, charId: 0, locked: 0 });
        const scoped = repo.withTransaction(tx);

        expect(await scoped.deleteLogin(KEY)).toBe(true);
        expect(await scoped.deleteLogin(KEY)).toBe(false);
        expect(await scoped.findLogin(KEY)).toBeNull();
        expect(await scoped.findLogin(KEY - 1)).not.toBeNull();
      }));
  });

  it('lists the logical channels', async () => expect(await repo.listChannels()).toEqual([1, 2, 3, 50]));

  it('lists the hosted maps in order', async () => {
    const maps = await repo.listHostedMaps();

    expect(maps).toHaveLength(98);
    expect(maps.slice(0, 3)).toEqual([0, 3, 4]);
    expect(maps).toEqual([...maps].sort((a, b) => a - b));
  });

  it('finds a server hosting spawn point 1001', async () =>
    expect(await repo.isLocationHosted({ world: 1, channel: 1, mapId: 0, x: 2850.52, y: 68.36, z: 5004.94 })).toBe(true));

  it('finds no server for an unknown map', async () =>
    expect(await repo.isLocationHosted({ world: 1, channel: 1, mapId: 65000, x: 2850.52, y: 68.36, z: 5004.94 })).toBe(false));

  it('writes an audit row with the IP prefix stripped and long values cut', () =>
    inRolledBackTransaction(db, async (tx) => {
      await repo.withTransaction(tx).writeAudit({ ip: '::ffff:127.0.0.1', gmId: 'a'.repeat(20), command: 'CLEARLOGIN', log: 'x'.repeat(2000) });

      const rows = await new sql.Request(tx).query(
        `SELECT TOP 1 szIP, szGMID, szCommand, LEN(szLog) AS logLength FROM [TGLOBAL_GSP_TEST].dbo.TMANAGERLOG ORDER BY dDate DESC`,
      );
      expect(rows.recordset[0]).toEqual({ szIP: '127.0.0.1', szGMID: 'a'.repeat(15), szCommand: 'CLEARLOGIN', logLength: 1024 });
    }));
});
