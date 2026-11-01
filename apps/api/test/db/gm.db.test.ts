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
      await repo.withTransaction(tx).writeAudit({ ip: '::ffff:127.0.0.1', gmId: 'a'.repeat(20), log: 'x'.repeat(2000) });

      const rows = await new sql.Request(tx).query(
        `SELECT TOP 1 szIP, szGMID, szCommand, LEN(szLog) AS logLength FROM [TGLOBAL_GSP_TEST].dbo.TMANAGERLOG ORDER BY dDate DESC`,
      );
      expect(rows.recordset[0]).toEqual({ szIP: '127.0.0.1', szGMID: 'a'.repeat(15), szCommand: 'TELEPORT', logLength: 1024 });
    }));
});
