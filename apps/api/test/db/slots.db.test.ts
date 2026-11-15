import { readFileSync } from 'node:fs';
import path from 'node:path';
import { SLOT_MACHINES, slotFreeText, slotJackpotAdds, type SlotPot, type SlotStops, type Wallet } from '@4story-portal/shared';
import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/config.js';
import type { DbService } from '../../src/db/db.service.js';
import { BET_CLOSED, BET_OK, BET_ONLINE, walletBetSql } from '../../src/games/wallet-bet.js';
import {
  SLOT_DAILY_REFUSED,
  SLOT_METER_REFUSED,
  type SlotBetInput,
  SLOTS_DAILY_KEY,
  SLOTS_LIVE_KEY,
  SLOTS_POT_KEYS,
  SqlSlotsRepository,
} from '../../src/slots/slots.repository.js';
import { connectTestDb, inRolledBackTransaction } from './db-test-helpers.js';

const script = (file: string) => readFileSync(path.resolve(process.cwd(), 'sql', file), 'utf8');
const SPIN_SQL = script('TPORTALSLOTSPIN.sql');
const JACKPOT_SQL = script('TPORTALSLOTJACKPOT.sql');
const setupSql = [script('TPORTALSETTING.sql'), SPIN_SQL, JACKPOT_SQL, script('TPORTALSLOTMETER.sql')];

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
  bStop4: number;
  bStop5: number;
  bRules: number;
  szFree: string;
  szMeterFree: string;
  llStake: string;
  llPayout: string;
  llWallet: string;
  wMultiple: number;
  llAdded: string;
  llJackpot: string;
  llAddMini: string;
  llAddMajor: string;
  llAddGiga: string;
  llWonMini: string;
  llWonMajor: string;
  llWonGiga: string;
};

/** The columns this change adds to the spin table, each with its DF_ default. */
const NEW_COLUMNS = ['szMeterFree', 'llAddMini', 'llAddMajor', 'llAddGiga', 'llWonMini', 'llWonMajor', 'llWonGiga'];
/** The columns the five-reel change added. */
const FIVE_REEL_COLUMNS = ['bStop4', 'bStop5', 'bRules', 'szFree'];

const START: Wallet = { gold: 5, silver: 250, copper: 999 };

/** What one lost round adds to the Giga in the single-pot cases below, in Bronze; the arithmetic in them rests on it. */
const ADD = 2510;

const NO_POTS: Record<SlotPot, number> = { mini: 0, major: 0, giga: 0 };
const HIGH_ROLLS: Record<SlotPot, number> = { mini: 999_999_999, major: 999_999_999, giga: 999_999_999 };
const STARTING_CAPS: Record<SlotPot, number> = { mini: 1, major: 10, giga: 50 };

/** A lost 40 Silver round that feeds only the Giga, as the one pot before this change did. */
const lost = (giga: { add?: number; cap?: number; roll?: number } = {}): Partial<SlotBetInput> => ({
  stake: 40,
  payout: 0,
  multiple: 0,
  adds: { ...NO_POTS, giga: giga.add ?? ADD },
  caps: { ...STARTING_CAPS, giga: giga.cap ?? STARTING_CAPS.giga },
  rolls: { ...HIGH_ROLLS, giga: giga.roll ?? HIGH_ROLLS.giga },
});

/** The pots before a GM saves anything. */
const STARTING_POTS = { mini: { live: true, cap: 1 }, major: { live: true, cap: 10 }, giga: { live: true, cap: 50 } };

/** What every machine holds before a GM saves anything. */
const STARTING_MACHINES = {
  shelf: { live: true, stakes: [20, 40, 60] },
  armoury: { live: true, stakes: [40, 60, 100] },
  hoard: { live: true, stakes: [60, 100, 200] },
};

/** `n` different free spins' stops, every stop two digits where it can be, so the text is as long as such a round's. */
const spins = (n: number, from = 0): SlotStops[] =>
  Array.from({ length: n }, (_, i) => [(from + i) % 32, (from + i + 10) % 32, (from + i + 20) % 32, 31, 30] as SlotStops);

describe('SqlSlotsRepository against the _TEST copy', () => {
  let db: DbService;
  let gameName: string;

  beforeAll(async () => {
    db = await connectTestDb();
    gameName = loadConfig(process.env).db.gameName;
  });

  afterAll(() => db.onModuleDestroy());

  const runScript = (tx: sql.Transaction, batch: string) =>
    new sql.Request(tx).input('sql', sql.NVarChar(sql.MAX), batch).query(`EXEC [${gameName}].sys.sp_executesql @sql`);

  /** Creates the tables inside tx, so the rollback removes them again, and gives a character a known wallet, offline. */
  async function withRepo(fn: (ctx: Ctx) => Promise<void>) {
    await inRolledBackTransaction(db, async (tx) => {
      for (const batch of setupSql) await runScript(tx, batch);
      // A table or settings already there keep what was made of them; these tests start from nothing.
      await new sql.Request(tx).query(`DELETE FROM ${db.tables.slotSpins}`);
      await new sql.Request(tx).query(`DELETE FROM ${db.tables.slotMeters}`);
      await new sql.Request(tx).query(`DELETE FROM ${db.tables.portalSettings} WHERE szKey LIKE 'slots[_]%'`);
      await new sql.Request(tx).query(`UPDATE ${db.tables.slotJackpot} SET llPot = 0, llCap = NULL`);

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

  const spinCount = async (tx: sql.Transaction) =>
    (await new sql.Request(tx).query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${db.tables.slotSpins}`)).recordset[0].n;

  /** The money columns of a spin row, as numbers. */
  const moneyOf = (row: SpinTableRow) => ({
    llAdded: Number(row.llAdded),
    llJackpot: Number(row.llJackpot),
    llAddMini: Number(row.llAddMini),
    llAddMajor: Number(row.llAddMajor),
    llAddGiga: Number(row.llAddGiga),
    llWonMini: Number(row.llWonMini),
    llWonMajor: Number(row.llWonMajor),
    llWonGiga: Number(row.llWonGiga),
  });

  const ROW: Record<SlotPot, number> = { giga: 1, mini: 2, major: 3 };

  /** One pot's row, in Bronze. */
  const potOf = async (tx: sql.Transaction, pot: SlotPot = 'giga'): Promise<{ amount: number; cap: number | null }> => {
    const row = (
      await new sql.Request(tx).input('id', sql.TinyInt, ROW[pot]).query<{ llPot: string; llCap: string | null }>(`SELECT llPot, llCap FROM ${db.tables.slotJackpot} WHERE bID = @id`)
    ).recordset[0];
    return { amount: Number(row.llPot), cap: row.llCap === null ? null : Number(row.llCap) };
  };

  const allPots = async (tx: sql.Transaction) => ({ mini: await potOf(tx, 'mini'), major: await potOf(tx, 'major'), giga: await potOf(tx, 'giga') });

  const EMPTY_POTS = { mini: { amount: 0, cap: null }, major: { amount: 0, cap: null }, giga: { amount: 0, cap: null } };

  const setPot = (tx: sql.Transaction, amount: number, cap: number | null, pot: SlotPot = 'giga') =>
    new sql.Request(tx)
      .input('id', sql.TinyInt, ROW[pot])
      .input('pot', sql.BigInt, amount)
      .input('cap', sql.BigInt, cap)
      .query(`UPDATE ${db.tables.slotJackpot} SET llPot = @pot, llCap = @cap WHERE bID = @id`);

  const setRawSetting = (tx: sql.Transaction, key: string, value: string) =>
    new sql.Request(tx)
      .input('key', sql.VarChar(40), key)
      .input('value', sql.VarChar(200), value)
      .query(`MERGE ${db.tables.portalSettings} AS target USING (VALUES (@key, @value)) AS source (szKey, szValue) ON target.szKey = source.szKey
              WHEN MATCHED THEN UPDATE SET szValue = source.szValue
              WHEN NOT MATCHED THEN INSERT (szKey, szValue, szUpdatedBy) VALUES (source.szKey, source.szValue, 'hand');`);

  const meterRows = async (tx: sql.Transaction) =>
    (
      await new sql.Request(tx).query<{ dwUserID: number; szMachine: string; dwStake: number; bPoints: number }>(
        `SELECT dwUserID, szMachine, dwStake, bPoints FROM ${db.tables.slotMeters} ORDER BY szMachine, dwStake`,
      )
    ).recordset;

  const setMeter = (tx: sql.Transaction, userId: number, machine: string, stake: number, points: number) =>
    new sql.Request(tx)
      .input('userId', sql.Int, userId)
      .input('machine', sql.VarChar(20), machine)
      .input('stake', sql.Int, stake)
      .input('points', sql.TinyInt, points)
      .query(`INSERT INTO ${db.tables.slotMeters} (dwUserID, szMachine, dwStake, bPoints) VALUES (@userId, @machine, @stake, @points)`);

  const goOnline = (tx: sql.Transaction, userId: number, charId: number) =>
    new sql.Request(tx)
      .input('userId', sql.Int, userId)
      .input('charId', sql.Int, charId)
      .query(
        `INSERT INTO ${db.tables.currentUsers} (dwUserID, dwCharID, bGroupID, bChannel, wPort, bLocked, szLoginIP)
         VALUES (@userId, @charId, 1, 1, 0, 0, '127.0.0.1')`,
      );

  /** `count` rows planted by hand for the account, `days` days ago (0: now), of the given rules number. */
  const plantRows = (tx: sql.Transaction, character: Character, count: number, { rules = 3, days = 0 } = {}) =>
    new sql.Request(tx)
      .input('userId', sql.Int, character.userId)
      .input('charId', sql.Int, character.charId)
      .input('name', sql.VarChar(50), character.name)
      .input('count', sql.Int, count)
      .input('rules', sql.TinyInt, rules)
      .input('days', sql.Int, days)
      .query(
        `INSERT INTO ${db.tables.slotSpins} (dwUserID, dwCharID, szCharName, dSpun, szMachine, bStop1, bStop2, bStop3, llStake, llPayout, llWallet, wMultiple, bRules)
         SELECT TOP (@count) @userId, @charId, @name, DATEADD(day, -@days, GETDATE()), 'shelf', 1, 2, 3, 20000, 0, 0, 0, @rules
         FROM sys.all_objects a CROSS JOIN sys.all_objects b`,
      );

  const bet = (character: Character, overrides: Partial<SlotBetInput> = {}): SlotBetInput => ({
    userId: character.userId,
    charId: character.charId,
    machine: 'shelf',
    stops: [3, 17, 30, 8, 21],
    free: [],
    meterFree: [],
    stake: 40,
    payout: 2000,
    multiple: 50,
    meterBefore: 0,
    meterAfter: 0,
    daily: 1500,
    adds: NO_POTS,
    caps: STARTING_CAPS,
    rolls: HIGH_ROLLS,
    ...overrides,
  });

  /** Bets and returns the new spin's id, or fails the test. */
  const placed = async (repo: SqlSlotsRepository, input: SlotBetInput): Promise<number> => {
    const outcome = await repo.bet(input);
    if (outcome.code !== BET_OK) throw new Error(`bet refused with ${outcome.code}`);
    return outcome.id;
  };

  it('has the floor closed, every machine open, the starting stakes, pots and daily limit before anything is saved', () =>
    withRepo(async ({ repo }) => {
      expect(await repo.settings()).toEqual({ live: false, machines: STARTING_MACHINES, pots: STARTING_POTS, daily: 1500 });
    }));

  it('saves and reads back the floor switch, a machine switch and its stakes', () =>
    withRepo(async ({ repo, tx }) => {
      await repo.saveFloor(true, 'moose');
      await repo.saveMachine('hoard', { live: false, stakes: [100, 200, 1000] }, 'otter');

      expect(await repo.settings()).toEqual({
        live: true,
        machines: { ...STARTING_MACHINES, hoard: { live: false, stakes: [100, 200, 1000] } },
        pots: STARTING_POTS,
        daily: 1500,
      });
      const rows = await new sql.Request(tx).query<{ szKey: string; szValue: string; szUpdatedBy: string }>(
        `SELECT szKey, szValue, szUpdatedBy FROM ${db.tables.portalSettings} WHERE szKey LIKE 'slots[_]%' ORDER BY szKey`,
      );
      expect(rows.recordset).toEqual([
        { szKey: 'slots_hoard_live', szValue: 'false', szUpdatedBy: 'otter' },
        { szKey: 'slots_hoard_stakes', szValue: '100,200,1000', szUpdatedBy: 'otter' },
        { szKey: SLOTS_LIVE_KEY, szValue: 'true', szUpdatedBy: 'moose' },
      ]);

      // Saving again changes the rows already there.
      await repo.saveFloor(false, 'otter');
      await repo.saveMachine('hoard', { live: true, stakes: [20, 60, 100] }, 'moose');
      expect(await repo.settings()).toEqual({
        live: false,
        machines: { ...STARTING_MACHINES, hoard: { live: true, stakes: [20, 60, 100] } },
        pots: STARTING_POTS,
        daily: 1500,
      });
    }));

  it.each(['abc', '100,60,40', '40,40,60', '0,20,40', '30,60,100', '1000,2000,5020'])('falls back to the starting stakes when a machine holds %s', (value) =>
    withRepo(async ({ repo, tx }) => {
      await repo.saveMachine('armoury', { live: false, stakes: [20, 80, 100] }, 'moose');
      await setRawSetting(tx, 'slots_armoury_stakes', value);

      // The switch next to it still reads as saved.
      expect((await repo.settings()).machines.armoury).toEqual({ live: false, stakes: [40, 60, 100] });
    }));

  it('reads settings back to starting values when a row is out of order or above 5 Gold', () =>
    withRepo(async ({ repo, tx }) => {
      const saved = { mini: { live: false, cap: 5 }, major: { live: true, cap: 30 }, giga: { live: false, cap: 90 } };
      await repo.savePots(saved, 'otter');
      await repo.saveMachine('hoard', { live: true, stakes: [1000, 2000, 5000] }, 'otter');
      expect((await repo.settings()).pots).toEqual(saved);
      // 5 Gold is the most a stake may be.
      expect((await repo.settings()).machines.hoard.stakes).toEqual([1000, 2000, 5000]);

      // A Mini above the Major: all three caps go back to theirs; the switches still read as saved.
      await setRawSetting(tx, SLOTS_POT_KEYS.mini.cap, '40');
      const fallen = { mini: { live: false, cap: 1 }, major: { live: true, cap: 10 }, giga: { live: false, cap: 50 } };
      expect((await repo.settings()).pots).toEqual(fallen);
      // Two caps the same are out of order too.
      await setRawSetting(tx, SLOTS_POT_KEYS.mini.cap, '30');
      expect((await repo.settings()).pots).toEqual(fallen);
      // A Major missing reads as its 10 Gold, which a 5 Gold Mini and a 90 Gold Giga stay in order around.
      await setRawSetting(tx, SLOTS_POT_KEYS.mini.cap, '5');
      await new sql.Request(tx).query(`DELETE FROM ${db.tables.portalSettings} WHERE szKey = '${SLOTS_POT_KEYS.major.cap}'`);
      expect((await repo.settings()).pots).toEqual({ ...saved, major: { live: true, cap: 10 } });

      // A stake above 5 Gold: the machine's starting stakes.
      await setRawSetting(tx, 'slots_hoard_stakes', '1000,2000,6000');
      expect((await repo.settings()).machines.hoard).toEqual({ live: true, stakes: [60, 100, 200] });
    }));

  it('reads a hand-edited TRUE with a trailing space as on, for the floor and for a machine', () =>
    withRepo(async ({ repo, tx, character }) => {
      await repo.saveFloor(true, 'moose');
      await repo.saveMachine('armoury', { live: false, stakes: [40, 60, 100] }, 'moose');
      await setRawSetting(tx, SLOTS_LIVE_KEY, 'TRUE ');
      await setRawSetting(tx, 'slots_armoury_live', 'TRUE ');

      const settings = await repo.settings();
      expect(settings.live).toBe(true);
      expect(settings.machines.armoury.live).toBe(true);
      // The bet's SQL reads the floor the same way.
      expect(await repo.bet(bet(character))).toMatchObject({ code: BET_OK });
    }));

  it('saves and reads back the daily limit', () =>
    withRepo(async ({ repo, tx }) => {
      await repo.saveDaily(100, 'otter');
      expect((await repo.settings()).daily).toBe(100);
      await repo.saveDaily(10_000, 'moose');
      expect((await repo.settings()).daily).toBe(10_000);
      const rows = await new sql.Request(tx).query(`SELECT szValue, szUpdatedBy FROM ${db.tables.portalSettings} WHERE szKey = '${SLOTS_DAILY_KEY}'`);
      expect(rows.recordset).toEqual([{ szValue: '10000', szUpdatedBy: 'moose' }]);
    }));

  it.each(['abc', '99', '10001', '1500.5', '', ' 200'])('falls back to 1,500 rounds when the daily limit holds %j', (value) =>
    withRepo(async ({ repo, tx }) => {
      await setRawSetting(tx, SLOTS_DAILY_KEY, value);
      expect((await repo.settings()).daily).toBe(1500);
    }));

  it('a win adds the payout less the stake and keeps the loose Bronze', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      const outcome = await repo.bet(bet(character, { stake: 40, payout: 2000, multiple: 50 }));

      const wallet = await walletOf(tx, character.charId);
      expect(wallet).toEqual({ gold: 7, silver: 210, copper: 999 });
      expect(outcome).toEqual({ code: BET_OK, id: expect.any(Number), wallet, pots: NO_POTS });
    }));

  it('a loss takes exactly the stake', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      const outcome = await repo.bet(bet(character, { stake: 40, payout: 0, multiple: 0 }));

      expect(await walletOf(tx, character.charId)).toEqual({ gold: 5, silver: 210, copper: 999 });
      expect(outcome).toMatchObject({ code: BET_OK, wallet: { gold: 5, silver: 210, copper: 999 } });
    }));

  it('records the spin with its machine, stops, money and multiple', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      const id = await placed(repo, bet(character, { machine: 'hoard', stops: [0, 17, 31, 4, 9], stake: 40, payout: 2000, multiple: 50 }));

      const rows = await spinRows(tx);
      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect({ ...row, llStake: Number(row.llStake), llPayout: Number(row.llPayout), llWallet: Number(row.llWallet), ...moneyOf(row) }).toEqual({
        dwID: id,
        dwUserID: character.userId,
        dwCharID: character.charId,
        szCharName: character.name,
        dSpun: expect.any(Date),
        szMachine: 'hoard',
        bStop1: 0,
        bStop2: 17,
        bStop3: 31,
        bStop4: 4,
        bStop5: 9,
        bRules: 3,
        szFree: '',
        szMeterFree: '',
        llStake: 40_000,
        llPayout: 2_000_000,
        llWallet: 7_210_999,
        wMultiple: 50,
        llAdded: 0,
        llJackpot: 0,
        llAddMini: 0,
        llAddMajor: 0,
        llAddGiga: 0,
        llWonMini: 0,
        llWonMajor: 0,
        llWonGiga: 0,
      });

      expect(await repo.spinsOf(character.userId, 10)).toEqual([
        {
          id,
          userId: character.userId,
          character: character.name,
          spunAt: expect.any(Date),
          machine: 'hoard',
          stops: [0, 17, 31, 4, 9],
          free: [],
          meterFree: [],
          stake: 40,
          payout: 2000,
          jackpot: 0,
          pots: NO_POTS,
        },
      ]);
      expect(await repo.spinsOf(character.userId + 1, 10)).toEqual([]);
    }));

  it('records all five stops, the free spins and rules 3', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      const free: SlotStops[] = [
        [6, 7, 8, 9, 10],
        [11, 12, 13, 14, 15],
      ];
      const id = await placed(repo, bet(character, { stops: [1, 2, 3, 4, 5], free }));

      const [row] = await spinRows(tx);
      expect([row.bStop1, row.bStop2, row.bStop3, row.bStop4, row.bStop5, row.bRules, row.szFree]).toEqual([1, 2, 3, 4, 5, 3, '6,7,8,9,10;11,12,13,14,15']);
      expect((await repo.spinsOf(character.userId, 10))[0]).toMatchObject({ id, stops: [1, 2, 3, 4, 5], free, meterFree: [] });
    }));

  it('records every stop of a 50-spin free round and 8 meter free spins', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      const free = spins(50);
      const meterFree = spins(8, 7);
      // The longest free text a round can make is past the old 400 characters.
      expect(slotFreeText(free).length).toBeGreaterThan(400);
      await setMeter(tx, character.userId, 'shelf', 40, 29);
      const id = await placed(repo, bet(character, { stops: [31, 30, 29, 28, 27], free, meterFree, meterBefore: 29, meterAfter: 1 }));

      const [row] = await spinRows(tx);
      expect({ free: row.szFree, meterFree: row.szMeterFree }).toEqual({ free: slotFreeText(free), meterFree: slotFreeText(meterFree) });
      const listed = { id, stops: [31, 30, 29, 28, 27], free, meterFree };
      expect((await repo.spinsOf(character.userId, 10))[0]).toMatchObject(listed);
      expect((await repo.latest(10))[0]).toMatchObject(listed);
      expect((await repo.bigWins(10))[0]).toMatchObject(listed);
    }));

  it('moves the wallet by exactly the round: payout less stake', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      // 40 Silver staked, 130 paid for the whole round, free spins included.
      await placed(repo, bet(character, { stake: 40, payout: 130, multiple: 3, free: [[1, 2, 3, 4, 5]] }));

      expect(await walletOf(tx, character.charId)).toEqual({ gold: 5, silver: 340, copper: 999 });
      const [row] = await spinRows(tx);
      expect(Number(row.llWallet)).toBe(5_340_999);
    }));

  /** A row planted by hand. Without `rules` it is an old three-reel row: bRules, bStop4, bStop5 and the texts take their defaults. */
  const insertRow = (tx: sql.Transaction, character: Character, rules?: { bRules: number; szFree?: string; szMeterFree?: string }) =>
    new sql.Request(tx)
      .input('userId', sql.Int, character.userId)
      .input('charId', sql.Int, character.charId)
      .input('name', sql.VarChar(50), character.name)
      .input('rules', sql.TinyInt, rules?.bRules)
      .input('free', sql.VarChar(800), rules?.szFree ?? '')
      .input('meterFree', sql.VarChar(800), rules?.szMeterFree ?? '')
      .query(
        `INSERT INTO ${db.tables.slotSpins}
           (dwUserID, dwCharID, szCharName, szMachine, bStop1, bStop2, bStop3, llStake, llPayout, llWallet, wMultiple, llAdded, llJackpot${rules ? ', bRules, szFree, szMeterFree' : ''})
         VALUES (@userId, @charId, @name, 'shelf', 1, 2, 3, 50000, 0, 5200999, 0, 1234, 5000${rules ? ', @rules, @free, @meterFree' : ''})`,
      );

  it('leaves an old three-reel row out of every list and keeps it in the totals', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      await insertRow(tx, character);

      const [row] = await spinRows(tx);
      expect({ rules: row.bRules, stop4: row.bStop4, free: row.szFree, meterFree: row.szMeterFree }).toEqual({ rules: 1, stop4: 0, free: '', meterFree: '' });
      expect(await repo.spinsOf(character.userId, 10)).toEqual([]);
      expect(await repo.latest(10)).toEqual([]);
      expect(await repo.bigWins(10)).toEqual([]);
      for (const pot of ['mini', 'major', 'giga'] as const) expect(await repo.jackpotWins(pot, 10)).toEqual([]);
      expect((await repo.totals()).shelf.allTime.spins).toBe(1);
      // What the one pot took and paid before this change is the Giga's.
      expect(await repo.jackpotTotals()).toEqual({
        mini: { added: 0, paid: 0, drops: 0 },
        major: { added: 0, paid: 0, drops: 0 },
        giga: { added: 1234, paid: 5, drops: 1 },
      });
    }));

  it('leaves a five-reel row out of every list and keeps it in the totals', () =>
    withLiveRepo(async ({ repo, character, tx }) => {
      await insertRow(tx, character, { bRules: 2 });

      expect(await repo.latest(10)).toEqual([]);
      expect(await repo.spinsOf(character.userId, 10)).toEqual([]);
      expect(await repo.bigWins(10)).toEqual([]);
      expect(await repo.jackpotWins('giga', 10)).toEqual([]);
      expect((await repo.totals()).shelf.allTime).toEqual({ spins: 1, staked: 50, paid: 0, added: 1 });
      expect((await repo.jackpotTotals()).giga).toEqual({ added: 1234, paid: 5, drops: 1 });
    }));

  it.each([
    ['free spins', { szFree: 'x' }],
    ['meter free spins', { szMeterFree: '1,2,3' }],
  ])('leaves out a row whose %s cannot be read', (_, texts) =>
    withLiveRepo(async ({ repo, tx, character }) => {
      await insertRow(tx, character, { bRules: 3, ...texts });
      const good = await placed(repo, bet(character, {}));

      expect((await repo.latest(10)).map((row) => row.id)).toEqual([good]);
      expect((await repo.spinsOf(character.userId, 10)).map((row) => row.id)).toEqual([good]);
      expect((await repo.bigWins(10)).map((row) => row.id)).toEqual([good]);
      expect((await repo.jackpotWins('giga', 10)).map((row) => row.id)).toEqual([]);
    }));

  /** The spin table's columns among `names`, sorted. */
  const columnsOf = async (tx: sql.Transaction, names: string[]) =>
    (
      await new sql.Request(tx).query<{ name: string; max_length: number }>(
        `SELECT name, max_length FROM ${gameName}.sys.columns WHERE object_id = OBJECT_ID('${db.tables.slotSpins}') AND name IN ('${names.join("','")}')`,
      )
    ).recordset
      .map((r) => r.name)
      .sort();

  const dropColumns = async (tx: sql.Transaction, columns: string[]) => {
    for (const column of columns) {
      await new sql.Request(tx).query(`ALTER TABLE ${db.tables.slotSpins} DROP CONSTRAINT DF_TPORTALSLOTSPIN_${column}`);
      await new sql.Request(tx).query(`ALTER TABLE ${db.tables.slotSpins} DROP COLUMN ${column}`);
    }
  };

  const freeLength = async (tx: sql.Transaction) =>
    (
      await new sql.Request(tx).query<{ n: number }>(
        `SELECT max_length AS n FROM ${gameName}.sys.columns WHERE object_id = OBJECT_ID('${db.tables.slotSpins}') AND name = 'szFree'`,
      )
    ).recordset[0].n;

  const hasDailyIndex = async (tx: sql.Transaction) =>
    (
      await new sql.Request(tx).query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM ${gameName}.sys.indexes WHERE object_id = OBJECT_ID('${db.tables.slotSpins}') AND name = 'IX_TPORTALSLOTSPIN_USER_TIME'`,
      )
    ).recordset[0].n === 1;

  it('a table from before the five reels gets every column, the wide free text and the index', () =>
    withRepo(async ({ tx }) => {
      const columns = [...FIVE_REEL_COLUMNS, ...NEW_COLUMNS];
      // The script has run once already; take the columns away as an older table would not have them.
      await new sql.Request(tx).query(`DROP INDEX IX_TPORTALSLOTSPIN_USER_TIME ON ${db.tables.slotSpins}`);
      await dropColumns(tx, columns);
      expect(await columnsOf(tx, columns)).toEqual([]);
      expect(await hasDailyIndex(tx)).toBe(false);

      for (let run = 0; run < 2; run++) await runScript(tx, SPIN_SQL);
      expect(await columnsOf(tx, columns)).toEqual([...columns].sort());
      expect(await freeLength(tx)).toBe(800);
      expect(await hasDailyIndex(tx)).toBe(true);
    }));

  it('a five-reel table gets the new columns and its free text widened, keeping its rows', () =>
    withRepo(async ({ tx, character }) => {
      await dropColumns(tx, NEW_COLUMNS);
      await new sql.Request(tx).query(`ALTER TABLE ${db.tables.slotSpins} ALTER COLUMN szFree VARCHAR(400) NOT NULL`);
      await new sql.Request(tx)
        .input('userId', sql.Int, character.userId)
        .input('charId', sql.Int, character.charId)
        .input('name', sql.VarChar(50), character.name)
        .query(
          `INSERT INTO ${db.tables.slotSpins} (dwUserID, dwCharID, szCharName, szMachine, bStop1, bStop2, bStop3, bStop4, bStop5, bRules, szFree, llStake, llPayout, llWallet, wMultiple, llAdded, llJackpot)
           VALUES (@userId, @charId, @name, 'shelf', 1, 2, 3, 4, 5, 2, '1,2,3,4,5', 40000, 0, 0, 0, 77, 0)`,
        );
      expect(await freeLength(tx)).toBe(400);

      for (let run = 0; run < 2; run++) await runScript(tx, SPIN_SQL);
      expect(await freeLength(tx)).toBe(800);
      const [row] = await spinRows(tx);
      expect({ rules: row.bRules, free: row.szFree, meterFree: row.szMeterFree, ...moneyOf(row) }).toEqual({
        rules: 2,
        free: '1,2,3,4,5',
        meterFree: '',
        llAdded: 77,
        llJackpot: 0,
        llAddMini: 0,
        llAddMajor: 0,
        llAddGiga: 0,
        llWonMini: 0,
        llWonMajor: 0,
        llWonGiga: 0,
      });
    }));

  it('refuses while the floor is closed and writes nothing', () =>
    withRepo(async ({ repo, tx, character }) => {
      await repo.saveFloor(false, 'moose');

      expect(await repo.bet(bet(character, { meterAfter: 2 }))).toEqual({ code: BET_CLOSED, name: null });
      expect(await walletOf(tx, character.charId)).toEqual(START);
      expect(await spinRows(tx)).toEqual([]);
      expect(await meterRows(tx)).toEqual([]);
    }));

  it('refuses a character that is in the game, with its name', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      await goOnline(tx, character.userId, character.charId);

      expect(await repo.bet(bet(character))).toEqual({ code: BET_ONLINE, name: character.name });
      expect(await walletOf(tx, character.charId)).toEqual(START);
      expect(await spinRows(tx)).toEqual([]);
    }));

  it('moves the meter with the spin, and only then', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      const { userId } = character;
      expect(await repo.meter(userId, 'shelf', 40)).toBe(0);
      expect(await repo.meters(userId)).toEqual([]);

      await placed(repo, bet(character, { meterBefore: 0, meterAfter: 2 }));
      expect(await meterRows(tx)).toEqual([{ dwUserID: userId, szMachine: 'shelf', dwStake: 40, bPoints: 2 }]);
      expect(await repo.meter(userId, 'shelf', 40)).toBe(2);
      // Another stake and another machine have their own meters.
      expect(await repo.meter(userId, 'shelf', 20)).toBe(0);
      expect(await repo.meter(userId, 'armoury', 40)).toBe(0);
      expect(await repo.meter(userId + 1, 'shelf', 40)).toBe(0);

      // A refused spin moves no meter.
      await goOnline(tx, userId, character.charId);
      expect(await repo.bet(bet(character, { meterBefore: 2, meterAfter: 4 }))).toMatchObject({ code: BET_ONLINE });
      expect(await repo.meter(userId, 'shelf', 40)).toBe(2);
      await new sql.Request(tx).input('userId', sql.Int, userId).query(`DELETE FROM ${db.tables.currentUsers} WHERE dwUserID = @userId`);

      // A round that leaves an absent meter at 0 writes no row.
      await placed(repo, bet(character, { machine: 'armoury', stake: 60, meterBefore: 0, meterAfter: 0 }));
      expect(await meterRows(tx)).toHaveLength(1);

      // A row that is there is written, even back to 0 by a meter that filled.
      await placed(repo, bet(character, { stake: 40, meterBefore: 2, meterAfter: 0, meterFree: spins(8) }));
      await placed(repo, bet(character, { machine: 'hoard', stake: 200, meterBefore: 0, meterAfter: 1 }));
      expect(await meterRows(tx)).toEqual([
        { dwUserID: userId, szMachine: 'hoard', dwStake: 200, bPoints: 1 },
        { dwUserID: userId, szMachine: 'shelf', dwStake: 40, bPoints: 0 },
      ]);
      expect(await repo.meters(userId)).toEqual([
        { machine: 'hoard', stake: 200, points: 1 },
        { machine: 'shelf', stake: 40, points: 0 },
      ]);
    }));

  it('reads only the meters of machines the code has', () =>
    withRepo(async ({ repo, tx, character }) => {
      await setMeter(tx, character.userId, 'retired', 40, 7);
      await setMeter(tx, character.userId, 'armoury', 100, 12);
      await setMeter(tx, character.userId + 1, 'armoury', 100, 3);

      expect(await repo.meters(character.userId)).toEqual([{ machine: 'armoury', stake: 100, points: 12 }]);
    }));

  it('refuses a spin whose meter changed, with nothing moved', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      await setMeter(tx, character.userId, 'shelf', 40, 5);
      await setPot(tx, 49_999_500, 50_000_000);

      // A lost round that would have dropped the Giga, read with 3 points where the row holds 5.
      expect(await repo.bet(bet(character, { ...lost({ roll: 0 }), meterBefore: 3, meterAfter: 4 }))).toEqual({ code: SLOT_METER_REFUSED, name: character.name });
      expect(await walletOf(tx, character.charId)).toEqual(START);
      expect(await spinCount(tx)).toBe(0);
      expect(await repo.meter(character.userId, 'shelf', 40)).toBe(5);
      expect(await allPots(tx)).toEqual({ ...EMPTY_POTS, giga: { amount: 49_999_500, cap: 50_000_000 } });

      // Points read where there is no row are refused too.
      expect(await repo.bet(bet(character, { stake: 60, meterBefore: 1, meterAfter: 2 }))).toEqual({ code: SLOT_METER_REFUSED, name: character.name });
      expect(await meterRows(tx)).toHaveLength(1);

      // Read again, it plays.
      expect(await repo.bet(bet(character, { meterBefore: 5, meterAfter: 6 }))).toMatchObject({ code: BET_OK });
      expect(await repo.meter(character.userId, 'shelf', 40)).toBe(6);
    }));

  it('refuses round 1,501 of the day, with nothing moved', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      await plantRows(tx, character, 1500);
      await plantRows(tx, character, 3, { days: 1 });
      await setPot(tx, 49_999_500, 50_000_000);
      expect(await repo.roundsToday(character.userId)).toBe(1500);
      expect(await repo.roundsToday(character.userId + 1)).toBe(0);

      expect(await repo.bet(bet(character, { ...lost({ roll: 0 }), meterAfter: 2 }))).toEqual({ code: SLOT_DAILY_REFUSED, name: character.name });
      expect(await walletOf(tx, character.charId)).toEqual(START);
      expect(await spinCount(tx)).toBe(1503);
      expect(await meterRows(tx)).toEqual([]);
      expect(await allPots(tx)).toEqual({ ...EMPTY_POTS, giga: { amount: 49_999_500, cap: 50_000_000 } });

      // A higher limit lets the round play, and it counts.
      expect(await repo.bet(bet(character, { daily: 1501, meterAfter: 2 }))).toMatchObject({ code: BET_OK });
      expect(await repo.roundsToday(character.userId)).toBe(1501);
      expect(await repo.bet(bet(character, { daily: 1501 }))).toMatchObject({ code: SLOT_DAILY_REFUSED });
    }));

  it('counts rows of every rules number toward the daily limit', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      for (const rules of [1, 2, 3]) await plantRows(tx, character, 1, { rules });
      expect(await repo.roundsToday(character.userId)).toBe(3);

      expect(await repo.bet(bet(character, { daily: 3 }))).toEqual({ code: SLOT_DAILY_REFUSED, name: character.name });
      expect(await repo.bet(bet(character, { daily: 4 }))).toMatchObject({ code: BET_OK });
    }));

  it("a game's check step that refuses writes nothing, and a code outside 10 to 99 is a bug", async () => {
    await withLiveRepo(async ({ tx, character }) => {
      const result = await new sql.Request(tx)
        .input('userId', sql.Int, character.userId)
        .input('charId', sql.Int, character.charId)
        .input('stake', sql.BigInt, 40_000)
        .input('payout', sql.BigInt, 0)
        .query<Record<string, unknown>>(walletBetSql(db.tables, SLOTS_LIVE_KEY, "THROW 50001, 'recorded', 1", "THROW 50001, 'ran', 1", 'SET @code = 42'));
      expect(result.recordset[0]).toMatchObject({ code: 42, id: 0, name: character.name, ...START });
      expect(await walletOf(tx, character.charId)).toEqual(START);
    });

    const before = await outside();
    let refused = false;
    await expect(
      withLiveRepo(async ({ tx, character }) => {
        const run = new sql.Request(tx)
          .input('userId', sql.Int, character.userId)
          .input('charId', sql.Int, character.charId)
          .input('stake', sql.BigInt, 40_000)
          .input('payout', sql.BigInt, 0)
          .query(walletBetSql(db.tables, SLOTS_LIVE_KEY, "THROW 50001, 'recorded', 1", '', 'SET @code = 4'));
        await expect(run).rejects.toThrow('A game code must be from 10 to 99');
        refused = true;
      }),
    ).rejects.toThrow('Transaction has been aborted');
    expect(refused).toBe(true);
    expect(await outside()).toEqual(before);
  });

  it('lists big wins only from 50 times the stake, newest first', () =>
    withLiveRepo(async ({ repo, character }) => {
      const ids: number[] = [];
      for (const multiple of [50, 49, 0, 100]) {
        ids.push(await placed(repo, bet(character, { stake: 20, payout: 20 * multiple, multiple })));
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
             (dwUserID, dwCharID, szCharName, szMachine, bStop1, bStop2, bStop3, bStop4, bStop5, bRules, llStake, llPayout, llWallet, wMultiple)
           VALUES (@userId, @charId, @name, 'retired', 1, 2, 3, 4, 5, 3, 40000, 80000, 5290999, 2)`,
        );

      expect(await repo.latest(10)).toEqual([
        {
          id: expect.any(Number),
          userId: character.userId,
          character: character.name,
          spunAt: expect.any(Date),
          machine: 'retired',
          stops: [1, 2, 3, 4, 5],
          free: [],
          meterFree: [],
          stake: 40,
          payout: 80,
          jackpot: 0,
          pots: NO_POTS,
        },
      ]);
    }));

  it('adds up today and all time per machine', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      expect(await repo.totals()).toEqual({});

      const yesterday = [
        await placed(repo, bet(character, { machine: 'shelf', stake: 20, payout: 0, multiple: 0 })),
        await placed(repo, bet(character, { machine: 'armoury', stake: 40, payout: 80, multiple: 2 })),
      ];
      await placed(repo, bet(character, { machine: 'shelf', stake: 20, payout: 0, multiple: 0 }));
      await placed(repo, bet(character, { machine: 'shelf', stake: 40, payout: 680, multiple: 17 }));
      await placed(repo, bet(character, { machine: 'hoard', stake: 60, payout: 0, multiple: 0 }));
      for (const id of yesterday) {
        await new sql.Request(tx).input('id', sql.Int, id).query(`UPDATE ${db.tables.slotSpins} SET dSpun = DATEADD(day, -1, dSpun) WHERE dwID = @id`);
      }

      expect(await repo.totals()).toEqual({
        shelf: { today: { spins: 2, staked: 60, paid: 680, added: 0 }, allTime: { spins: 3, staked: 80, paid: 680, added: 0 } },
        armoury: { today: { spins: 0, staked: 0, paid: 0, added: 0 }, allTime: { spins: 1, staked: 40, paid: 80, added: 0 } },
        hoard: { today: { spins: 1, staked: 60, paid: 0, added: 0 }, allTime: { spins: 1, staked: 60, paid: 0, added: 0 } },
      });
      expect(await repo.roundsToday(character.userId)).toBe(3);
    }));

  it('a lost round adds to the Giga and fixes its cap', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      const outcome = await repo.bet(bet(character, lost()));

      expect(await allPots(tx)).toEqual({ ...EMPTY_POTS, giga: { amount: ADD, cap: 50_000_000 } });
      expect((await repo.pots()).find((row) => row.pot === 'giga')).toEqual({ pot: 'giga', amount: ADD, cap: 50_000_000 });
      const wallet = { gold: 5, silver: 210, copper: 999 };
      expect(await walletOf(tx, character.charId)).toEqual(wallet);
      expect(outcome).toEqual({ code: BET_OK, id: expect.any(Number), wallet, pots: NO_POTS });
      const [row] = await spinRows(tx);
      expect(moneyOf(row)).toEqual({ llAdded: ADD, llJackpot: 0, llAddMini: 0, llAddMajor: 0, llAddGiga: ADD, llWonMini: 0, llWonMajor: 0, llWonGiga: 0 });
    }));

  it('feeds three pots from one lost round, each by its own add', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      const adds = slotJackpotAdds(SLOT_MACHINES[0], 40);
      expect(Object.values(adds).every((add) => add > 0)).toBe(true);

      const outcome = await repo.bet(bet(character, { ...lost(), adds, caps: { mini: 2, major: 20, giga: 80 } }));

      expect(outcome).toMatchObject({ code: BET_OK, pots: NO_POTS });
      expect(await allPots(tx)).toEqual({
        mini: { amount: adds.mini, cap: 2_000_000 },
        major: { amount: adds.major, cap: 20_000_000 },
        giga: { amount: adds.giga, cap: 80_000_000 },
      });
      expect(await repo.pots()).toEqual([
        { pot: 'mini', amount: adds.mini, cap: 2_000_000 },
        { pot: 'major', amount: adds.major, cap: 20_000_000 },
        { pot: 'giga', amount: adds.giga, cap: 80_000_000 },
      ]);
      const [row] = await spinRows(tx);
      expect(moneyOf(row)).toEqual({
        llAdded: adds.mini + adds.major + adds.giga,
        llJackpot: 0,
        llAddMini: adds.mini,
        llAddMajor: adds.major,
        llAddGiga: adds.giga,
        llWonMini: 0,
        llWonMajor: 0,
        llWonGiga: 0,
      });
      expect(await repo.jackpotTotals()).toEqual({
        mini: { added: adds.mini, paid: 0, drops: 0 },
        major: { added: adds.major, paid: 0, drops: 0 },
        giga: { added: adds.giga, paid: 0, drops: 0 },
      });
      // The Silver totals take the round's whole add.
      expect((await repo.totals()).shelf.allTime.added).toBe(Math.floor((adds.mini + adds.major + adds.giga) / 1000));
    }));

  it('a pot whose add is 0 is left alone, cap and all', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      await placed(repo, bet(character, { ...lost(), adds: { mini: 900, major: 0, giga: 1200 } }));

      expect(await allPots(tx)).toEqual({ mini: { amount: 900, cap: 1_000_000 }, major: { amount: 0, cap: null }, giga: { amount: 1200, cap: 50_000_000 } });
    }));

  it('pays two pots in one round and records each', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      const adds = { mini: 1150, major: 1150, giga: 1534 };
      await setPot(tx, 999_000, 1_000_000, 'mini');
      await setPot(tx, 49_999_500, 50_000_000, 'giga');

      // Rolls of 0: the Mini and the Giga reach their caps; the Major is below its floor, where even 0 does not drop.
      const outcome = await repo.bet(bet(character, { ...lost(), adds, rolls: { mini: 0, major: 0, giga: 0 } }));

      // The Mini pays 1,000,150 Bronze as 1000 Silver, the Giga 50,001,034 as 50,001.
      const wallet = { gold: 56, silver: 211, copper: 999 };
      expect(outcome).toEqual({ code: BET_OK, id: expect.any(Number), wallet, pots: { mini: 1000, major: 0, giga: 50_001 } });
      expect(await walletOf(tx, character.charId)).toEqual(wallet);
      expect(await allPots(tx)).toEqual({ mini: { amount: 150, cap: null }, major: { amount: 1150, cap: 10_000_000 }, giga: { amount: 34, cap: null } });
      const [row] = await spinRows(tx);
      expect({ ...moneyOf(row), llWallet: Number(row.llWallet), llPayout: Number(row.llPayout) }).toEqual({
        llAdded: 3834,
        llJackpot: 51_001_000,
        llAddMini: 1150,
        llAddMajor: 1150,
        llAddGiga: 1534,
        llWonMini: 1_000_000,
        llWonMajor: 0,
        llWonGiga: 50_001_000,
        llWallet: 56_211_999,
        llPayout: 0,
      });

      const listed = { id: outcome.code === BET_OK ? outcome.id : 0, jackpot: 51_001, pots: { mini: 1000, major: 0, giga: 50_001 } };
      expect(await repo.jackpotWins('mini', 10)).toEqual([expect.objectContaining(listed)]);
      expect(await repo.jackpotWins('giga', 10)).toEqual([expect.objectContaining(listed)]);
      expect(await repo.jackpotWins('major', 10)).toEqual([]);
      expect(await repo.bigWins(10)).toEqual([expect.objectContaining(listed)]);
      expect(await repo.jackpotTotals()).toEqual({
        mini: { added: 1150, paid: 1000, drops: 1 },
        major: { added: 1150, paid: 0, drops: 0 },
        giga: { added: 1534, paid: 50_001, drops: 1 },
      });
    }));

  it('keeps the Giga in row 1 with the pot that was there', () =>
    withRepo(async ({ repo, tx }) => {
      // A pot table from before this change: only row 1, and a check that allows only it.
      await setPot(tx, 12_345_678, 40_000_000);
      await new sql.Request(tx).query(`DELETE FROM ${db.tables.slotJackpot} WHERE bID <> 1`);
      await new sql.Request(tx).query(`ALTER TABLE ${db.tables.slotJackpot} DROP CONSTRAINT CK_TPORTALSLOTJACKPOT_ID`);
      await new sql.Request(tx).query(`ALTER TABLE ${db.tables.slotJackpot} ADD CONSTRAINT CK_TPORTALSLOTJACKPOT_ID CHECK (bID = 1)`);
      await expect(repo.pots()).rejects.toThrow('The jackpot rows are missing: mini, major');

      for (let run = 0; run < 2; run++) await runScript(tx, JACKPOT_SQL);

      expect(await repo.pots()).toEqual([
        { pot: 'mini', amount: 0, cap: null },
        { pot: 'major', amount: 0, cap: null },
        { pot: 'giga', amount: 12_345_678, cap: 40_000_000 },
      ]);
      const check = await new sql.Request(tx).query<{ definition: string }>(
        `SELECT definition FROM ${gameName}.sys.check_constraints WHERE parent_object_id = OBJECT_ID('${db.tables.slotJackpot}')`,
      );
      expect(check.recordset).toEqual([{ definition: '([bID]>=(1) AND [bID]<=(3))' }]);
    }));

  it('a round that pays leaves the pots alone', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      const outcome = await repo.bet(bet(character, { payout: 2000, multiple: 50 }));

      expect(outcome).toMatchObject({ code: BET_OK, pots: NO_POTS });
      expect(await allPots(tx)).toEqual(EMPTY_POTS);
      const [row] = await spinRows(tx);
      expect(Number(row.llAdded)).toBe(0);
    }));

  it('a round that reaches the cap wins the whole Silver and leaves the odd Bronze', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      await setPot(tx, 49_999_500, 50_000_000);

      const outcome = await repo.bet(bet(character, lost()));

      // 49,999,500 + ADD is 50,002,010 Bronze: 50,002 Silver go out and 10 Bronze stay.
      const wallet = { gold: 55, silver: 212, copper: 999 };
      expect(outcome).toEqual({ code: BET_OK, id: expect.any(Number), wallet, pots: { ...NO_POTS, giga: 50_002 } });
      expect(await walletOf(tx, character.charId)).toEqual(wallet);
      expect(await potOf(tx)).toEqual({ amount: 10, cap: null });
      const [row] = await spinRows(tx);
      expect({
        llPayout: Number(row.llPayout),
        llJackpot: Number(row.llJackpot),
        llWonGiga: Number(row.llWonGiga),
        llAdded: Number(row.llAdded),
        llWallet: Number(row.llWallet),
        wMultiple: row.wMultiple,
      }).toEqual({ llPayout: 0, llJackpot: 50_002_000, llWonGiga: 50_002_000, llAdded: ADD, llWallet: 55_212_999, wMultiple: 0 });
    }));

  it('the roll decides between floor and cap', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      // 2510 of the 22,500,000 Bronze left to the cap: the round drops for a roll below 111,555.55.
      await setPot(tx, 27_500_000, 50_000_000);
      expect(await repo.bet(bet(character, lost({ roll: 111_556 })))).toMatchObject({ code: BET_OK, pots: NO_POTS });
      expect(await potOf(tx)).toEqual({ amount: 27_500_000 + ADD, cap: 50_000_000 });

      await setPot(tx, 27_500_000, 50_000_000);
      await setWallet(tx, character.charId, START);
      expect(await repo.bet(bet(character, lost({ roll: 111_555 })))).toMatchObject({ code: BET_OK, pots: { ...NO_POTS, giga: 27_502 } });
      expect(await potOf(tx)).toEqual({ amount: 510, cap: null });
    }));

  it('each pot draws with its own roll and cap', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      // The same pot and add under each pot's cap, so each roll is the only difference.
      for (const pot of ['mini', 'major', 'giga'] as const) await setPot(tx, 27_500_000, 50_000_000, pot);
      const adds = { mini: ADD, major: ADD, giga: ADD };
      const outcome = await repo.bet(bet(character, { ...lost(), adds, rolls: { mini: 111_555, major: 111_556, giga: 111_555 } }));

      expect(outcome).toMatchObject({ code: BET_OK, pots: { mini: 27_502, major: 0, giga: 27_502 } });
      expect(await allPots(tx)).toEqual({ mini: { amount: 510, cap: null }, major: { amount: 27_500_000 + ADD, cap: 50_000_000 }, giga: { amount: 510, cap: null } });
    }));

  it('below the floor even a roll of 0 does not drop', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      await setPot(tx, 1_000_000, 50_000_000);
      expect(await repo.bet(bet(character, lost({ roll: 0 })))).toMatchObject({ code: BET_OK, pots: NO_POTS });
      expect(await potOf(tx)).toEqual({ amount: 1_000_000 + ADD, cap: 50_000_000 });
    }));

  it('across the floor only the part past it counts', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      // 1510 of the 45,000,000 Bronze from the floor to the cap: the round drops for a roll below 33,555.55.
      await setPot(tx, 4_999_000, 50_000_000);
      expect(await repo.bet(bet(character, lost({ roll: 33_556 })))).toMatchObject({ code: BET_OK, pots: NO_POTS });
      expect(await potOf(tx)).toEqual({ amount: 4_999_000 + ADD, cap: 50_000_000 });

      await setPot(tx, 4_999_000, 50_000_000);
      await setWallet(tx, character.charId, START);
      expect(await repo.bet(bet(character, lost({ roll: 33_555 })))).toMatchObject({ code: BET_OK, pots: { ...NO_POTS, giga: 5001 } });
      expect(await potOf(tx)).toEqual({ amount: 510, cap: null });
    }));

  it('a pot keeps its cap when the cap set changes, and the next pot takes the new one', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      await setPot(tx, 10_000_000, 50_000_000);
      await placed(repo, bet(character, lost({ cap: 20, roll: 999_999_999 })));
      expect(await potOf(tx)).toEqual({ amount: 10_000_000 + ADD, cap: 50_000_000 });

      await setPot(tx, 49_999_500, 50_000_000);
      expect(await repo.bet(bet(character, lost({ cap: 20 })))).toMatchObject({ code: BET_OK, pots: { ...NO_POTS, giga: 50_002 } });
      await placed(repo, bet(character, lost({ cap: 20 })));
      expect(await potOf(tx)).toEqual({ amount: 10 + ADD, cap: 20_000_000 });
    }));

  it('does not overflow at a 10,000 Gold cap', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      // On the floor: the roll's side is just under what a BIGINT holds, so this one only guards the rule.
      await setPot(tx, 1_000_000_000, 10_000_000_000);
      expect(await repo.bet(bet(character, lost({ roll: 999_999_999 })))).toMatchObject({ code: BET_OK, pots: NO_POTS });
      expect(await potOf(tx)).toEqual({ amount: 1_000_000_000 + ADD, cap: 10_000_000_000 });

      // An add can be at most the stake, so only a 9,500 Gold stake makes (to - from) x 10^9 pass the BIGINT limit;
      // no machine takes one, but the repository does not limit the stake. Only the DECIMAL sum gets here.
      await setWallet(tx, character.charId, { gold: 10_000, silver: 0, copper: 0 });
      expect(await repo.bet(bet(character, { ...lost({ add: 9_500_000_000, roll: 999_999_999 }), stake: 9_500_000 }))).toMatchObject({
        code: BET_OK,
        pots: { ...NO_POTS, giga: 10_500_002 },
        wallet: { gold: 11_000, silver: 2, copper: 0 },
      });
      expect(await potOf(tx)).toEqual({ amount: 510, cap: null });
    }));

  /** The wallet of the character withRepo picks and the spin count, read through the pool, outside any test's transaction. */
  const outside = async () => ({
    wallet: (
      await db.pool
        .request()
        .query<Wallet>(`SELECT TOP 1 dwGold AS gold, dwSilver AS silver, dwCooper AS copper FROM ${db.tables.characters} WHERE bDelete = 0 ORDER BY dwCharID`)
    ).recordset[0],
    // The spin table may exist only inside the tests' transactions.
    spins: (
      await db.pool
        .request()
        .query<{ n: number }>(`IF OBJECT_ID('${db.tables.slotSpins}', 'U') IS NULL SELECT -1 AS n ELSE SELECT COUNT(*) AS n FROM ${db.tables.slotSpins}`)
    ).recordset[0].n,
  });

  // A pot table that is not there is only found when the pot step runs, after the checks. The error (208) rolls
  // back the whole transaction, the caller's included, so nothing is left open on the connection; the wallet and
  // spins are read again through the pool, outside it.
  it.each<[string, string, RegExp | string]>([
    ['the pot table is missing', `DROP TABLE {slotJackpot}`, /Invalid object name/],
    ['the meter table is missing', `DROP TABLE {slotMeters}`, /Invalid object name/],
    ['a pot row is missing', `DELETE FROM {slotJackpot} WHERE bID = 2`, 'The jackpot row is missing'],
  ])('rolls everything back when %s', async (_, change, error) => {
    const before = await outside();

    // The helper then fails to roll back a transaction that is already gone; that is the proof it was rolled back.
    let refused = false;
    await expect(
      withLiveRepo(async ({ repo, tx, character }) => {
        await new sql.Request(tx).query(change.replace('{slotJackpot}', db.tables.slotJackpot).replace('{slotMeters}', db.tables.slotMeters));
        await expect(repo.bet(bet(character, { ...lost(), adds: { mini: 900, major: 900, giga: 1200 }, meterAfter: 1 }))).rejects.toThrow(error);
        refused = true;
      }),
    ).rejects.toThrow('Transaction has been aborted');
    expect(refused).toBe(true);

    expect(await outside()).toEqual(before);
  });

  it('refuses to read the pots without all three rows, or without the table', () =>
    withRepo(async ({ repo, tx }) => {
      await new sql.Request(tx).query('SET XACT_ABORT OFF');
      await new sql.Request(tx).query(`DELETE FROM ${db.tables.slotJackpot} WHERE bID = 3`);
      await expect(repo.pots()).rejects.toThrow('The jackpot rows are missing: major');
      await new sql.Request(tx).query(`DROP TABLE ${db.tables.slotJackpot}`);
      await expect(repo.pots()).rejects.toThrow(/Invalid object name/);
    }));

  // The new API on a spin table from before a change. What needs the new columns refuses, the bet included.
  // A batch compiled afresh is refused before any of it runs. One whose plan the server kept from before the columns
  // went has its INSERT compiled again as it is reached, and under the batch's XACT_ABORT that error rolls back the
  // whole transaction, the caller's included, as for the missing pot table above. Which of the two the server does is
  // not the caller's to choose, so the test holds for both: nothing moves either way.
  it.each([
    ['from before the five reels', [...FIVE_REEL_COLUMNS, ...NEW_COLUMNS]],
    ['without this change', NEW_COLUMNS],
  ])('refuses the bet and moves nothing on a table %s, and still reads the rest', async (_, columns) => {
    const before = await outside();
    let refused = false;
    let kept = false;

    const outcome = await withLiveRepo(async ({ repo, tx, character }) => {
      await dropColumns(tx, columns);
      // A pooled connection can still have XACT_ABORT on from an earlier test's bet; then even a refused read would
      // end the transaction.
      await new sql.Request(tx).query('SET XACT_ABORT OFF');
      await expect(repo.spinsOf(character.userId, 10)).rejects.toThrow(/Invalid column name/);
      await expect(repo.latest(10)).rejects.toThrow(/Invalid column name/);
      await expect(repo.jackpotWins('giga', 1)).rejects.toThrow(/Invalid column name/);
      // What does not read the new columns still reads, so the page can open.
      expect((await repo.settings()).live).toBe(true);
      expect(await repo.pots()).toHaveLength(3);
      expect(await repo.totals()).toEqual({});
      expect(await repo.roundsToday(character.userId)).toBe(0);
      expect(await repo.meter(character.userId, 'shelf', 40)).toBe(0);

      await expect(repo.bet(bet(character, { ...lost(), meterAfter: 1 }))).rejects.toThrow(/Invalid column name/);
      refused = true;
      let wallet: Wallet;
      try {
        wallet = await walletOf(tx, character.charId);
      } catch {
        // The transaction is gone: what is left is read outside it, below.
        return;
      }
      kept = true;
      expect(wallet).toEqual(START);
      expect(await allPots(tx)).toEqual(EMPTY_POTS);
      expect(await meterRows(tx)).toEqual([]);
      expect(await spinCount(tx)).toBe(0);
    }).then(
      () => null,
      (error: unknown) => error,
    );

    expect(refused).toBe(true);
    if (kept) expect(outcome).toBeNull();
    // The helper then fails to roll back a transaction that is already gone; that is the proof it was rolled back.
    else expect(String(outcome)).toMatch('Transaction has been aborted');
    expect(await outside()).toEqual(before);
  });

  // No real round has these: a lost round adds a share of its stake and pays nothing, and the roll is randomInt(1e9).
  // The THROW rolls back the whole transaction like the missing table above, so each input gets its own.
  it.each<[string, Partial<SlotBetInput>]>([
    ['a round that pays and adds', { ...lost(), payout: 2000, multiple: 50 }],
    ['an add past the stake', lost({ add: 40_001 })],
    ['adds past the stake together', { ...lost(), adds: { mini: 20_000, major: 20_000, giga: 1 } }],
    ['a negative roll', lost({ roll: -1 })],
    ['a roll of 1,000,000,000', lost({ roll: 1_000_000_000 })],
    ['no roll', { ...lost(), rolls: { ...HIGH_ROLLS, giga: null as unknown as number } }],
    ['a Mini roll out of range', { ...lost(), adds: { mini: 900, major: 0, giga: 0 }, rolls: { ...HIGH_ROLLS, mini: 1_000_000_000 } }],
  ])('refuses %s and writes nothing', async (_, input) => {
    const before = await outside();

    let refused = false;
    await expect(
      withLiveRepo(async ({ repo, character }) => {
        await expect(repo.bet(bet(character, input))).rejects.toThrow('A round cannot add that to the jackpot');
        refused = true;
      }),
    ).rejects.toThrow('Transaction has been aborted');
    expect(refused).toBe(true);

    expect(await outside()).toEqual(before);
  });

  it('a refused spin leaves the pots alone', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      await goOnline(tx, character.userId, character.charId);

      expect(await repo.bet(bet(character, { ...lost(), adds: { mini: 900, major: 900, giga: 1200 } }))).toEqual({ code: BET_ONLINE, name: character.name });
      expect(await allPots(tx)).toEqual(EMPTY_POTS);
    }));

  it('the pot is always what was added less what was paid', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      // A 1 Gold cap, so six rounds reach past its floor; the fourth round's roll of 0 drops it.
      const rounds: Partial<SlotBetInput>[] = [
        { machine: 'shelf', ...lost({ cap: 1 }) },
        { machine: 'armoury', ...lost({ cap: 1, add: 5151 }) },
        { machine: 'hoard', ...lost({ cap: 1, add: 98_000 }), stake: 100 },
        { machine: 'shelf', ...lost({ cap: 1, add: 40_000, roll: 0 }) },
        { machine: 'armoury', ...lost({ cap: 1, add: 5151 }) },
        { machine: 'hoard', ...lost({ cap: 1, add: 8673, roll: 500_000_000 }) },
      ];
      for (const round of rounds) await placed(repo, bet(character, round));

      const sums = await new sql.Request(tx).query<{ added: string; paid: string; drops: number }>(
        `SELECT SUM(llAddGiga) AS added, SUM(llWonGiga) AS paid, COUNT(CASE WHEN llWonGiga > 0 THEN 1 END) AS drops FROM ${db.tables.slotSpins}`,
      );
      const { added, paid, drops } = sums.recordset[0];
      expect(drops).toBe(1);
      expect(Number(paid)).toBe(145_000);
      expect(await potOf(tx)).toEqual({ amount: Number(added) - Number(paid), cap: 1_000_000 });
    }));

  it('reads the pots on with their starting caps before anything is saved, and saves them', () =>
    withRepo(async ({ repo, tx }) => {
      expect((await repo.settings()).pots).toEqual(STARTING_POTS);

      await repo.savePots({ mini: { live: true, cap: 3 }, major: { live: false, cap: 30 }, giga: { live: false, cap: 80 } }, 'otter');

      expect((await repo.settings()).pots).toEqual({ mini: { live: true, cap: 3 }, major: { live: false, cap: 30 }, giga: { live: false, cap: 80 } });
      const rows = await new sql.Request(tx).query<{ szKey: string; szValue: string; szUpdatedBy: string }>(
        `SELECT szKey, szValue, szUpdatedBy FROM ${db.tables.portalSettings} WHERE szKey LIKE 'slots[_]jackpot[_]%' ORDER BY szKey`,
      );
      expect(rows.recordset).toEqual([
        { szKey: 'slots_jackpot_cap', szValue: '80', szUpdatedBy: 'otter' },
        { szKey: 'slots_jackpot_live', szValue: 'false', szUpdatedBy: 'otter' },
        { szKey: 'slots_jackpot_major_cap', szValue: '30', szUpdatedBy: 'otter' },
        { szKey: 'slots_jackpot_major_live', szValue: 'false', szUpdatedBy: 'otter' },
        { szKey: 'slots_jackpot_mini_cap', szValue: '3', szUpdatedBy: 'otter' },
        { szKey: 'slots_jackpot_mini_live', szValue: 'true', szUpdatedBy: 'otter' },
      ]);
      // The Giga keeps the keys the one pot had.
      expect(SLOTS_POT_KEYS.giga).toEqual({ live: 'slots_jackpot_live', cap: 'slots_jackpot_cap' });
    }));

  it.each(['abc', '0', '10001', '12.5'])('falls back to a 50 Gold Giga cap when its setting holds %s', (value) =>
    withRepo(async ({ repo, tx }) => {
      await repo.savePots({ mini: { live: false, cap: 2 }, major: { live: false, cap: 20 }, giga: { live: false, cap: 80 } }, 'moose');
      await setRawSetting(tx, SLOTS_POT_KEYS.giga.cap, value);

      // The switch beside it, and the other two pots, still read as saved.
      expect((await repo.settings()).pots).toEqual({ mini: { live: false, cap: 2 }, major: { live: false, cap: 20 }, giga: { live: false, cap: 50 } });
    }));

  it('lists jackpot wins, and among the big wins', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      await setPot(tx, 49_999_500, 50_000_000);
      const drop = await placed(repo, bet(character, lost()));
      const win = await placed(repo, bet(character, { stake: 20, payout: 1000, multiple: 50 }));
      await placed(repo, bet(character, { stake: 20, payout: 0, multiple: 0 }));

      expect(await repo.jackpotWins('giga', 10)).toEqual([
        {
          id: drop,
          userId: character.userId,
          character: character.name,
          spunAt: expect.any(Date),
          machine: 'shelf',
          stops: [3, 17, 30, 8, 21],
          free: [],
          meterFree: [],
          stake: 40,
          payout: 0,
          jackpot: 50_002,
          pots: { ...NO_POTS, giga: 50_002 },
        },
      ]);
      expect(await repo.jackpotWins('mini', 10)).toEqual([]);
      expect((await repo.bigWins(10)).map((row) => [row.id, row.jackpot])).toEqual([
        [win, 0],
        [drop, 50_002],
      ]);
    }));

  it('adds up what went to the jackpots', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      const none = { added: 0, paid: 0, drops: 0 };
      expect(await repo.jackpotTotals()).toEqual({ mini: none, major: none, giga: none });

      await placed(repo, bet(character, { ...lost(), machine: 'shelf' }));
      await setPot(tx, 49_999_500, 50_000_000);
      await placed(repo, bet(character, { ...lost({ add: 5151 }), machine: 'armoury' }));

      const totals = await repo.totals();
      expect(totals.shelf.allTime).toEqual({ spins: 1, staked: 40, paid: 0, added: 2 });
      expect(totals.shelf.today).toEqual({ spins: 1, staked: 40, paid: 0, added: 2 });
      expect(totals.armoury.allTime).toEqual({ spins: 1, staked: 40, paid: 0, added: 5 });
      // 49,999,500 + 5151 drops as 50,004 Silver.
      expect(await repo.jackpotTotals()).toEqual({ mini: none, major: none, giga: { added: ADD + 5151, paid: 50_004, drops: 1 } });
    }));
});
