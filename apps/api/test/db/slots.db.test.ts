import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Wallet } from '@4story-portal/shared';
import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/config.js';
import type { DbService } from '../../src/db/db.service.js';
import { BET_CLOSED, BET_OK, BET_ONLINE } from '../../src/games/wallet-bet.js';
import {
  type SlotBetInput,
  SLOTS_JACKPOT_CAP_KEY,
  SLOTS_JACKPOT_LIVE_KEY,
  SLOTS_LIVE_KEY,
  type SlotPotRow,
  SqlSlotsRepository,
} from '../../src/slots/slots.repository.js';
import { connectTestDb, inRolledBackTransaction } from './db-test-helpers.js';

const setupSql = ['TPORTALSETTING.sql', 'TPORTALSLOTSPIN.sql', 'TPORTALSLOTJACKPOT.sql'].map((file) => readFileSync(path.resolve(process.cwd(), 'sql', file), 'utf8'));

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

/** A lost 50 Silver round on Tranus's Shelf, with what it adds to the pot. */
const LOST: Partial<SlotBetInput> = { stake: 50, payout: 0, multiple: 0, add: 2784 };

/** The jackpot before a GM saves anything. */
const STARTING_JACKPOT = { live: true, cap: 50 };

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
      await new sql.Request(tx).query(`UPDATE ${db.tables.slotJackpot} SET llPot = 0, llCap = NULL WHERE bID = 1`);

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

  const potOf = async (tx: sql.Transaction): Promise<SlotPotRow> => {
    const row = (await new sql.Request(tx).query<{ llPot: string; llCap: string | null }>(`SELECT llPot, llCap FROM ${db.tables.slotJackpot} WHERE bID = 1`))
      .recordset[0];
    return { pot: Number(row.llPot), cap: row.llCap === null ? null : Number(row.llCap) };
  };

  const setPot = (tx: sql.Transaction, pot: number, cap: number | null) =>
    new sql.Request(tx).input('pot', sql.BigInt, pot).input('cap', sql.BigInt, cap).query(`UPDATE ${db.tables.slotJackpot} SET llPot = @pot, llCap = @cap WHERE bID = 1`);

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
    add: 0,
    cap: 50,
    roll: 999_999_999,
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
      expect(await repo.settings()).toEqual({ live: false, machines: STARTING_MACHINES, jackpot: STARTING_JACKPOT });
    }));

  it('saves and reads back the floor switch, a machine switch and its stakes', () =>
    withRepo(async ({ repo, tx }) => {
      await repo.saveFloor(true, 'moose');
      await repo.saveMachine('hoard', { live: false, stakes: [100, 250, 1000] }, 'otter');

      expect(await repo.settings()).toEqual({
        live: true,
        machines: { ...STARTING_MACHINES, hoard: { live: false, stakes: [100, 250, 1000] } },
        jackpot: STARTING_JACKPOT,
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
        jackpot: STARTING_JACKPOT,
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
      expect(outcome).toEqual({ code: BET_OK, id: expect.any(Number), wallet, jackpot: 0 });
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
        { id, userId: character.userId, character: character.name, spunAt: expect.any(Date), machine: 'hoard', stops: [0, 17, 31], stake: 50, payout: 2500, jackpot: 0 },
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
        { id: expect.any(Number), userId: character.userId, character: character.name, spunAt: expect.any(Date), machine: 'retired', stops: [1, 2, 3], stake: 40, payout: 80, jackpot: 0 },
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
        shelf: { today: { spins: 2, staked: 30, paid: 700, added: 0 }, allTime: { spins: 3, staked: 60, paid: 700, added: 0 } },
        armoury: { today: { spins: 0, staked: 0, paid: 0, added: 0 }, allTime: { spins: 1, staked: 25, paid: 50, added: 0 } },
        hoard: { today: { spins: 1, staked: 50, paid: 0, added: 0 }, allTime: { spins: 1, staked: 50, paid: 0, added: 0 } },
      });
    }));

  it('a lost round adds to the pot and fixes its cap', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      const outcome = await repo.bet(bet(character, LOST));

      expect(await potOf(tx)).toEqual({ pot: 2784, cap: 50_000_000 });
      expect(await repo.pot()).toEqual({ pot: 2784, cap: 50_000_000 });
      const wallet = { gold: 5, silver: 200, copper: 999 };
      expect(await walletOf(tx, character.charId)).toEqual(wallet);
      expect(outcome).toEqual({ code: BET_OK, id: expect.any(Number), wallet, jackpot: 0 });
      const [row] = await spinRows(tx);
      expect({ llAdded: Number(row.llAdded), llJackpot: Number(row.llJackpot) }).toEqual({ llAdded: 2784, llJackpot: 0 });
    }));

  it('a round that pays leaves the pot alone', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      const outcome = await repo.bet(bet(character, { payout: 2500, multiple: 50, add: 0 }));

      expect(outcome).toMatchObject({ code: BET_OK, jackpot: 0 });
      expect(await potOf(tx)).toEqual({ pot: 0, cap: null });
      const [row] = await spinRows(tx);
      expect(Number(row.llAdded)).toBe(0);
    }));

  it('a round that reaches the cap wins the whole Silver and leaves the odd Bronze', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      await setPot(tx, 49_999_500, 50_000_000);

      const outcome = await repo.bet(bet(character, LOST));

      const wallet = { gold: 55, silver: 202, copper: 999 };
      expect(outcome).toEqual({ code: BET_OK, id: expect.any(Number), wallet, jackpot: 50_002 });
      expect(await walletOf(tx, character.charId)).toEqual(wallet);
      expect(await potOf(tx)).toEqual({ pot: 284, cap: null });
      const [row] = await spinRows(tx);
      expect({
        llPayout: Number(row.llPayout),
        llJackpot: Number(row.llJackpot),
        llAdded: Number(row.llAdded),
        llWallet: Number(row.llWallet),
        wMultiple: row.wMultiple,
      }).toEqual({ llPayout: 0, llJackpot: 50_002_000, llAdded: 2784, llWallet: 55_202_999, wMultiple: 0 });
    }));

  it('the roll decides between floor and cap', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      // 2784 of the 22,500,000 Bronze left to the cap: the round drops for a roll below 123,733.33.
      await setPot(tx, 27_500_000, 50_000_000);
      expect(await repo.bet(bet(character, { ...LOST, roll: 123_734 }))).toMatchObject({ code: BET_OK, jackpot: 0 });
      expect(await potOf(tx)).toEqual({ pot: 27_502_784, cap: 50_000_000 });

      await setPot(tx, 27_500_000, 50_000_000);
      await setWallet(tx, character.charId, START);
      expect(await repo.bet(bet(character, { ...LOST, roll: 123_733 }))).toMatchObject({ code: BET_OK, jackpot: 27_502 });
      expect(await potOf(tx)).toEqual({ pot: 784, cap: null });
    }));

  it('below the floor even a roll of 0 does not drop', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      await setPot(tx, 1_000_000, 50_000_000);
      expect(await repo.bet(bet(character, { ...LOST, roll: 0 }))).toMatchObject({ code: BET_OK, jackpot: 0 });
      expect(await potOf(tx)).toEqual({ pot: 1_002_784, cap: 50_000_000 });
    }));

  it('across the floor only the part past it counts', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      // 1784 of the 45,000,000 Bronze from the floor to the cap: the round drops for a roll below 39,644.44.
      await setPot(tx, 4_999_000, 50_000_000);
      expect(await repo.bet(bet(character, { ...LOST, roll: 39_645 }))).toMatchObject({ code: BET_OK, jackpot: 0 });
      expect(await potOf(tx)).toEqual({ pot: 5_001_784, cap: 50_000_000 });

      await setPot(tx, 4_999_000, 50_000_000);
      await setWallet(tx, character.charId, START);
      expect(await repo.bet(bet(character, { ...LOST, roll: 39_644 }))).toMatchObject({ code: BET_OK, jackpot: 5001 });
      expect(await potOf(tx)).toEqual({ pot: 784, cap: null });
    }));

  it('a pot keeps its cap when the cap set changes, and the next pot takes the new one', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      await setPot(tx, 10_000_000, 50_000_000);
      await placed(repo, bet(character, { ...LOST, cap: 20, roll: 999_999_999 }));
      expect(await potOf(tx)).toEqual({ pot: 10_002_784, cap: 50_000_000 });

      await setPot(tx, 49_999_500, 50_000_000);
      expect(await repo.bet(bet(character, { ...LOST, cap: 20 }))).toMatchObject({ code: BET_OK, jackpot: 50_002 });
      await placed(repo, bet(character, { ...LOST, cap: 20 }));
      expect(await potOf(tx)).toEqual({ pot: 284 + 2784, cap: 20_000_000 });
    }));

  it('does not overflow at a 10,000 Gold cap', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      // On the floor: the roll's side is just under what a BIGINT holds, so this one only guards the rule.
      await setPot(tx, 1_000_000_000, 10_000_000_000);
      expect(await repo.bet(bet(character, { ...LOST, roll: 999_999_999 }))).toMatchObject({ code: BET_OK, jackpot: 0 });
      expect(await potOf(tx)).toEqual({ pot: 1_000_002_784, cap: 10_000_000_000 });

      // An add far past any stake makes (to - from) x 10^9 pass the BIGINT limit; only the DECIMAL sum gets here.
      expect(await repo.bet(bet(character, { ...LOST, add: 9_500_000_000, roll: 999_999_999 }))).toMatchObject({ code: BET_OK, jackpot: 10_500_002 });
      expect(await potOf(tx)).toEqual({ pot: 784, cap: null });
    }));

  // A pot table that is not there is only found when the pot step runs, after the checks. The error (208) rolls
  // back the whole transaction, the caller's included, so nothing is left open on the connection; the wallet and
  // spins are read again through the pool, outside it.
  it('rolls everything back when the pot table is missing', async () => {
    // The same character withRepo picks. The spin table may exist only inside the tests' transactions.
    const outside = async () => ({
      wallet: (
        await db.pool
          .request()
          .query<Wallet>(`SELECT TOP 1 dwGold AS gold, dwSilver AS silver, dwCooper AS copper FROM ${db.tables.characters} WHERE bDelete = 0 ORDER BY dwCharID`)
      ).recordset[0],
      spins: (
        await db.pool
          .request()
          .query<{ n: number }>(`IF OBJECT_ID('${db.tables.slotSpins}', 'U') IS NULL SELECT -1 AS n ELSE SELECT COUNT(*) AS n FROM ${db.tables.slotSpins}`)
      ).recordset[0].n,
    });
    const before = await outside();

    // The helper then fails to roll back a transaction that is already gone; that is the proof it was rolled back.
    let refused = false;
    await expect(
      withLiveRepo(async ({ repo, tx, character }) => {
        await new sql.Request(tx).query(`DROP TABLE ${db.tables.slotJackpot}`);
        await expect(repo.bet(bet(character, LOST))).rejects.toThrow(/Invalid object name/);
        refused = true;
      }),
    ).rejects.toThrow('Transaction has been aborted');
    expect(refused).toBe(true);

    expect(await outside()).toEqual(before);
  });

  it('a refused spin leaves the pot alone', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      await goOnline(tx, character.userId, character.charId);

      expect(await repo.bet(bet(character, LOST))).toEqual({ code: BET_ONLINE, name: character.name });
      expect(await potOf(tx)).toEqual({ pot: 0, cap: null });
    }));

  it('the pot is always what was added less what was paid', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      // A 1 Gold cap, so six rounds reach past its floor; the fourth round's roll of 0 drops it.
      const rounds: Partial<SlotBetInput>[] = [
        { machine: 'shelf', add: 2784 },
        { machine: 'armoury', add: 5151 },
        { machine: 'hoard', add: 98_000 },
        { machine: 'shelf', add: 40_000, roll: 0 },
        { machine: 'armoury', add: 5151 },
        { machine: 'hoard', add: 8673, roll: 500_000_000 },
      ];
      for (const round of rounds) await placed(repo, bet(character, { ...LOST, cap: 1, ...round }));

      const sums = await new sql.Request(tx).query<{ added: string; paid: string; drops: number }>(
        `SELECT SUM(llAdded) AS added, SUM(llJackpot) AS paid, COUNT(CASE WHEN llJackpot > 0 THEN 1 END) AS drops FROM ${db.tables.slotSpins}`,
      );
      const { added, paid, drops } = sums.recordset[0];
      expect(drops).toBe(1);
      expect(Number(paid)).toBe(145_000);
      expect(await potOf(tx)).toEqual({ pot: Number(added) - Number(paid), cap: 1_000_000 });
    }));

  it('reads the jackpot on with a 50 Gold cap before anything is saved, and saves it', () =>
    withRepo(async ({ repo, tx }) => {
      expect((await repo.settings()).jackpot).toEqual({ live: true, cap: 50 });

      await repo.saveJackpot({ live: false, cap: 80 }, 'otter');

      expect((await repo.settings()).jackpot).toEqual({ live: false, cap: 80 });
      const rows = await new sql.Request(tx).query<{ szKey: string; szValue: string; szUpdatedBy: string }>(
        `SELECT szKey, szValue, szUpdatedBy FROM ${db.tables.portalSettings} WHERE szKey LIKE 'slots[_]jackpot[_]%' ORDER BY szKey`,
      );
      expect(rows.recordset).toEqual([
        { szKey: SLOTS_JACKPOT_CAP_KEY, szValue: '80', szUpdatedBy: 'otter' },
        { szKey: SLOTS_JACKPOT_LIVE_KEY, szValue: 'false', szUpdatedBy: 'otter' },
      ]);
    }));

  it.each(['abc', '0', '10001', '12.5'])('falls back to a 50 Gold cap when the setting holds %s', (value) =>
    withRepo(async ({ repo, tx }) => {
      await repo.saveJackpot({ live: false, cap: 80 }, 'moose');
      await setRawSetting(tx, SLOTS_JACKPOT_CAP_KEY, value);

      // The switch beside it still reads as saved.
      expect((await repo.settings()).jackpot).toEqual({ live: false, cap: 50 });
    }));

  it('lists jackpot wins, and among the big wins', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      await setPot(tx, 49_999_500, 50_000_000);
      const drop = await placed(repo, bet(character, LOST));
      const win = await placed(repo, bet(character, { stake: 10, payout: 500, multiple: 50 }));
      await placed(repo, bet(character, { stake: 10, payout: 0, multiple: 0 }));

      expect(await repo.jackpotWins(10)).toEqual([
        { id: drop, userId: character.userId, character: character.name, spunAt: expect.any(Date), machine: 'shelf', stops: [3, 17, 30], stake: 50, payout: 0, jackpot: 50_002 },
      ]);
      expect((await repo.bigWins(10)).map((row) => [row.id, row.jackpot])).toEqual([
        [win, 0],
        [drop, 50_002],
      ]);
    }));

  it('adds up what went to the jackpot', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      expect(await repo.jackpotTotals()).toEqual({ added: 0, paid: 0, drops: 0 });

      await placed(repo, bet(character, { ...LOST, machine: 'shelf' }));
      await setPot(tx, 49_999_500, 50_000_000);
      await placed(repo, bet(character, { ...LOST, machine: 'armoury', add: 5151 }));

      const totals = await repo.totals();
      expect(totals.shelf.allTime).toEqual({ spins: 1, staked: 50, paid: 0, added: 2 });
      expect(totals.shelf.today).toEqual({ spins: 1, staked: 50, paid: 0, added: 2 });
      expect(totals.armoury.allTime).toEqual({ spins: 1, staked: 50, paid: 0, added: 5 });
      // 49,999,500 + 5151 drops as 50,004 Silver.
      expect(await repo.jackpotTotals()).toEqual({ added: 2784 + 5151, paid: 50_004, drops: 1 });
    }));
});
