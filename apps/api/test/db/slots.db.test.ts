import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Wallet } from '@4story-portal/shared';
import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/config.js';
import type { DbService } from '../../src/db/db.service.js';
import { BET_CLOSED, BET_OK, BET_ONLINE } from '../../src/games/wallet-bet.js';
import { type SlotBetInput, SLOTS_LIVE_KEY, SqlSlotsRepository } from '../../src/slots/slots.repository.js';
import { connectTestDb, inRolledBackTransaction } from './db-test-helpers.js';

const setupSql = ['TPORTALSETTING.sql', 'TPORTALSLOTSPIN.sql'].map((file) => readFileSync(path.resolve(process.cwd(), 'sql', file), 'utf8'));

type Character = { charId: number; userId: number; name: string };
type Ctx = { repo: SqlSlotsRepository; tx: sql.Transaction; character: Character };

type SpinTableRow = {
  dwID: number;
  dwUserID: number;
  dwCharID: number;
  szCharName: string;
  dSpun: Date;
  szMachine: string;
  bStop1: number;
  bStop2: number;
  bStop3: number;
  llStake: string;
  llPayout: string;
  llWallet: string;
  wMultiple: number;
  llAdded: string;
  llJackpot: string;
};

const START: Wallet = { gold: 5, silver: 250, copper: 999 };

/** What every machine holds before a GM saves anything. */
const STARTING_MACHINES = {
  shelf: { live: true, stakes: [10, 25, 50] },
  armoury: { live: true, stakes: [25, 50, 100] },
  hoard: { live: true, stakes: [50, 100, 200] },
};

describe('SqlSlotsRepository against the _TEST copy', () => {
  let db: DbService;
  let gameName: string;

  beforeAll(async () => {
    db = await connectTestDb();
    gameName = loadConfig(process.env).db.gameName;
  });

  afterAll(() => db.onModuleDestroy());

  /** Creates the tables inside tx, so the rollback removes them again, and gives a character a known wallet, offline. */
  async function withRepo(fn: (ctx: Ctx) => Promise<void>) {
    await inRolledBackTransaction(db, async (tx) => {
      for (const batch of setupSql) {
        await new sql.Request(tx).input('sql', sql.NVarChar(sql.MAX), batch).query(`EXEC [${gameName}].sys.sp_executesql @sql`);
      }
      // A table or settings already there keep what was made of them; these tests start from nothing.
      await new sql.Request(tx).query(`DELETE FROM ${db.tables.slotSpins}`);
      await new sql.Request(tx).query(`DELETE FROM ${db.tables.portalSettings} WHERE szKey LIKE 'slots[_]%'`);

      const picked = await new sql.Request(tx).query<Character>(
        `SELECT TOP 1 dwCharID AS charId, dwUserID AS userId, szNAME AS name FROM ${db.tables.characters} WHERE bDelete = 0 ORDER BY dwCharID`,
      );
      const character = picked.recordset[0];
      await new sql.Request(tx)
        .input('userId', sql.Int, character.userId)
        .input('charId', sql.Int, character.charId)
        .query(`DELETE FROM ${db.tables.currentUsers} WHERE dwUserID = @userId OR dwCharID = @charId`);
      await setWallet(tx, character.charId, START);

      await fn({ repo: new SqlSlotsRepository(db).withTransaction(tx), tx, character });
    });
  }

  /** The same, with the floor open. */
  const withLiveRepo = (fn: (ctx: Ctx) => Promise<void>) =>
    withRepo(async (ctx) => {
      await ctx.repo.saveFloor(true, 'moose');
      await fn(ctx);
    });

  const setWallet = (tx: sql.Transaction, charId: number, wallet: Wallet) =>
    new sql.Request(tx)
      .input('charId', sql.Int, charId)
      .input('gold', sql.Int, wallet.gold)
      .input('silver', sql.Int, wallet.silver)
      .input('copper', sql.Int, wallet.copper)
      .query(`UPDATE ${db.tables.characters} SET dwGold = @gold, dwSilver = @silver, dwCooper = @copper WHERE dwCharID = @charId`);

  const walletOf = async (tx: sql.Transaction, charId: number): Promise<Wallet> =>
    (
      await new sql.Request(tx)
        .input('charId', sql.Int, charId)
        .query<Wallet>(`SELECT dwGold AS gold, dwSilver AS silver, dwCooper AS copper FROM ${db.tables.characters} WHERE dwCharID = @charId`)
    ).recordset[0];

  const spinRows = async (tx: sql.Transaction) =>
    (await new sql.Request(tx).query<SpinTableRow>(`SELECT * FROM ${db.tables.slotSpins} ORDER BY dwID`)).recordset;

  const setRawSetting = (tx: sql.Transaction, key: string, value: string) =>
    new sql.Request(tx)
      .input('key', sql.VarChar(40), key)
      .input('value', sql.VarChar(200), value)
      .query(`UPDATE ${db.tables.portalSettings} SET szValue = @value WHERE szKey = @key`);

  const goOnline = (tx: sql.Transaction, userId: number, charId: number) =>
    new sql.Request(tx)
      .input('userId', sql.Int, userId)
      .input('charId', sql.Int, charId)
      .query(
        `INSERT INTO ${db.tables.currentUsers} (dwUserID, dwCharID, bGroupID, bChannel, wPort, bLocked, szLoginIP)
         VALUES (@userId, @charId, 1, 1, 0, 0, '127.0.0.1')`,
      );

  const bet = (character: Character, overrides: Partial<SlotBetInput> = {}): SlotBetInput => ({
    userId: character.userId,
    charId: character.charId,
    machine: 'shelf',
    stops: [3, 17, 30],
    stake: 50,
    payout: 2500,
    multiple: 50,
    ...overrides,
  });

  /** Bets and returns the new spin's id, or fails the test. */
  const placed = async (repo: SqlSlotsRepository, input: SlotBetInput): Promise<number> => {
    const outcome = await repo.bet(input);
    if (outcome.code !== BET_OK) throw new Error(`bet refused with ${outcome.code}`);
    return outcome.id;
  };

  it('has the floor closed, every machine open and the starting stakes before anything is saved', () =>
    withRepo(async ({ repo }) => {
      expect(await repo.settings()).toEqual({ live: false, machines: STARTING_MACHINES });
    }));

  it('saves and reads back the floor switch, a machine switch and its stakes', () =>
    withRepo(async ({ repo, tx }) => {
      await repo.saveFloor(true, 'moose');
      await repo.saveMachine('hoard', { live: false, stakes: [100, 250, 1000] }, 'otter');

      expect(await repo.settings()).toEqual({
        live: true,
        machines: { ...STARTING_MACHINES, hoard: { live: false, stakes: [100, 250, 1000] } },
      });
      const rows = await new sql.Request(tx).query<{ szKey: string; szValue: string; szUpdatedBy: string }>(
        `SELECT szKey, szValue, szUpdatedBy FROM ${db.tables.portalSettings} WHERE szKey LIKE 'slots[_]%' ORDER BY szKey`,
      );
      expect(rows.recordset).toEqual([
        { szKey: 'slots_hoard_live', szValue: 'false', szUpdatedBy: 'otter' },
        { szKey: 'slots_hoard_stakes', szValue: '100,250,1000', szUpdatedBy: 'otter' },
        { szKey: SLOTS_LIVE_KEY, szValue: 'true', szUpdatedBy: 'moose' },
      ]);

      // Saving again changes the rows already there.
      await repo.saveFloor(false, 'otter');
      await repo.saveMachine('hoard', { live: true, stakes: [5, 6, 7] }, 'moose');
      expect(await repo.settings()).toEqual({
        live: false,
        machines: { ...STARTING_MACHINES, hoard: { live: true, stakes: [5, 6, 7] } },
      });
    }));

  it.each(['abc', '50,10,25', '10,10,25', '0,5,10'])('falls back to the starting stakes when a machine holds %s', (value) =>
    withRepo(async ({ repo, tx }) => {
      await repo.saveMachine('armoury', { live: false, stakes: [30, 60, 90] }, 'moose');
      await setRawSetting(tx, 'slots_armoury_stakes', value);

      // The switch next to it still reads as saved.
      expect((await repo.settings()).machines.armoury).toEqual({ live: false, stakes: [25, 50, 100] });
    }));

  it('reads a hand-edited TRUE with a trailing space as on, for the floor and for a machine', () =>
    withRepo(async ({ repo, tx, character }) => {
      await repo.saveFloor(true, 'moose');
      await repo.saveMachine('armoury', { live: false, stakes: [25, 50, 100] }, 'moose');
      await setRawSetting(tx, SLOTS_LIVE_KEY, 'TRUE ');
      await setRawSetting(tx, 'slots_armoury_live', 'TRUE ');

      const settings = await repo.settings();
      expect(settings.live).toBe(true);
      expect(settings.machines.armoury.live).toBe(true);
      // The bet's SQL reads the floor the same way.
      expect(await repo.bet(bet(character))).toMatchObject({ code: BET_OK });
    }));

  it('a win adds the payout less the stake and keeps the loose Bronze', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      const outcome = await repo.bet(bet(character, { stake: 50, payout: 2500, multiple: 50 }));

      const wallet = await walletOf(tx, character.charId);
      expect(wallet).toEqual({ gold: 7, silver: 700, copper: 999 });
      expect(outcome).toEqual({ code: BET_OK, id: expect.any(Number), wallet });
    }));

  it('a loss takes exactly the stake', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      const outcome = await repo.bet(bet(character, { stake: 50, payout: 0, multiple: 0 }));

      expect(await walletOf(tx, character.charId)).toEqual({ gold: 5, silver: 200, copper: 999 });
      expect(outcome).toMatchObject({ code: BET_OK, wallet: { gold: 5, silver: 200, copper: 999 } });
    }));

  it('records the spin with its machine, stops, money and multiple', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      const id = await placed(repo, bet(character, { machine: 'hoard', stops: [0, 17, 31], stake: 50, payout: 2500, multiple: 50 }));

      const rows = await spinRows(tx);
      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect({ ...row, llStake: Number(row.llStake), llPayout: Number(row.llPayout), llWallet: Number(row.llWallet), llAdded: Number(row.llAdded), llJackpot: Number(row.llJackpot) }).toEqual({
        dwID: id,
        dwUserID: character.userId,
        dwCharID: character.charId,
        szCharName: character.name,
        dSpun: expect.any(Date),
        szMachine: 'hoard',
        bStop1: 0,
        bStop2: 17,
        bStop3: 31,
        llStake: 50_000,
        llPayout: 2_500_000,
        llWallet: 7_700_999,
        wMultiple: 50,
        llAdded: 0,
        llJackpot: 0,
      });

      expect(await repo.spinsOf(character.userId, 10)).toEqual([
        { id, userId: character.userId, character: character.name, spunAt: expect.any(Date), machine: 'hoard', stops: [0, 17, 31], stake: 50, payout: 2500 },
      ]);
      expect(await repo.spinsOf(character.userId + 1, 10)).toEqual([]);
    }));

  it('refuses while the floor is closed and writes nothing', () =>
    withRepo(async ({ repo, tx, character }) => {
      await repo.saveFloor(false, 'moose');

      expect(await repo.bet(bet(character))).toEqual({ code: BET_CLOSED, name: null });
      expect(await walletOf(tx, character.charId)).toEqual(START);
      expect(await spinRows(tx)).toEqual([]);
    }));

  it('refuses a character that is in the game, with its name', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      await goOnline(tx, character.userId, character.charId);

      expect(await repo.bet(bet(character))).toEqual({ code: BET_ONLINE, name: character.name });
      expect(await walletOf(tx, character.charId)).toEqual(START);
      expect(await spinRows(tx)).toEqual([]);
    }));

  it('lists big wins only from 50 times the stake, newest first', () =>
    withLiveRepo(async ({ repo, character }) => {
      const ids: number[] = [];
      for (const multiple of [50, 49, 0, 100]) {
        ids.push(await placed(repo, bet(character, { stake: 10, payout: 10 * multiple, multiple })));
      }

      expect((await repo.bigWins(10)).map((row) => row.id)).toEqual([ids[3], ids[0]]);
      expect((await repo.bigWins(1)).map((row) => row.id)).toEqual([ids[3]]);
      expect((await repo.latest(10)).map((row) => row.id)).toEqual([ids[3], ids[2], ids[1], ids[0]]);
      expect((await repo.latest(2)).map((row) => row.id)).toEqual([ids[3], ids[2]]);
    }));

  it('returns a row for a machine the code no longer has, untouched', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      await new sql.Request(tx)
        .input('userId', sql.Int, character.userId)
        .input('charId', sql.Int, character.charId)
        .input('name', sql.VarChar(50), character.name)
        .query(
          `INSERT INTO ${db.tables.slotSpins}
             (dwUserID, dwCharID, szCharName, szMachine, bStop1, bStop2, bStop3, llStake, llPayout, llWallet, wMultiple)
           VALUES (@userId, @charId, @name, 'retired', 1, 2, 3, 40000, 80000, 5290999, 2)`,
        );

      expect(await repo.latest(10)).toEqual([
        { id: expect.any(Number), userId: character.userId, character: character.name, spunAt: expect.any(Date), machine: 'retired', stops: [1, 2, 3], stake: 40, payout: 80 },
      ]);
    }));

  it('adds up today and all time per machine', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      expect(await repo.totals()).toEqual({});

      const yesterday = [
        await placed(repo, bet(character, { machine: 'shelf', stake: 30, payout: 0, multiple: 0 })),
        await placed(repo, bet(character, { machine: 'armoury', stake: 25, payout: 50, multiple: 2 })),
      ];
      await placed(repo, bet(character, { machine: 'shelf', stake: 10, payout: 0, multiple: 0 }));
      await placed(repo, bet(character, { machine: 'shelf', stake: 20, payout: 700, multiple: 35 }));
      await placed(repo, bet(character, { machine: 'hoard', stake: 50, payout: 0, multiple: 0 }));
      for (const id of yesterday) {
        await new sql.Request(tx).input('id', sql.Int, id).query(`UPDATE ${db.tables.slotSpins} SET dSpun = DATEADD(day, -1, dSpun) WHERE dwID = @id`);
      }

      expect(await repo.totals()).toEqual({
        shelf: { today: { spins: 2, staked: 30, paid: 700 }, allTime: { spins: 3, staked: 60, paid: 700 } },
        armoury: { today: { spins: 0, staked: 0, paid: 0 }, allTime: { spins: 1, staked: 25, paid: 50 } },
        hoard: { today: { spins: 1, staked: 50, paid: 0 }, allTime: { spins: 1, staked: 50, paid: 0 } },
      });
    }));
});
