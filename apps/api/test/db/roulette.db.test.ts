import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROULETTE_DEFAULT_LIMITS, type Wallet } from '@4story-portal/shared';
import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/config.js';
import type { DbService } from '../../src/db/db.service.js';
import { BET_CLOSED, BET_NOT_YOURS, BET_OK, BET_ONLINE, BET_POOR } from '../../src/games/wallet-bet.js';
import { type BetInput, ROULETTE_LIVE_KEY, SqlRouletteRepository } from '../../src/roulette/roulette.repository.js';
import { connectTestDb, inRolledBackTransaction } from './db-test-helpers.js';

const setupSql = ['TPORTALSETTING.sql', 'TPORTALROULETTESPIN.sql'].map((file) => readFileSync(path.resolve(process.cwd(), 'sql', file), 'utf8'));

type Character = { charId: number; userId: number; name: string };
type Ctx = { repo: SqlRouletteRepository; tx: sql.Transaction; character: Character };

type SpinTableRow = {
  dwUserID: number;
  dwCharID: number;
  szCharName: string;
  bPocket: number;
  llStake: string;
  llPayout: string;
  llWallet: string;
  szBets: string;
  bNumberHit: number;
};

const START: Wallet = { gold: 5, silver: 250, copper: 999 };

describe('SqlRouletteRepository against the _TEST copy', () => {
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
      await new sql.Request(tx).query(`DELETE FROM ${db.tables.rouletteSpins}`);
      await new sql.Request(tx).query(`DELETE FROM ${db.tables.portalSettings} WHERE szKey LIKE 'roulette[_]%'`);

      const picked = await new sql.Request(tx).query<Character>(
        `SELECT TOP 1 dwCharID AS charId, dwUserID AS userId, szNAME AS name FROM ${db.tables.characters} WHERE bDelete = 0 ORDER BY dwCharID`,
      );
      const character = picked.recordset[0];
      await new sql.Request(tx)
        .input('userId', sql.Int, character.userId)
        .input('charId', sql.Int, character.charId)
        .query(`DELETE FROM ${db.tables.currentUsers} WHERE dwUserID = @userId OR dwCharID = @charId`);
      await setWallet(tx, character.charId, START);

      await fn({ repo: new SqlRouletteRepository(db).withTransaction(tx), tx, character });
    });
  }

  /** The same, with the table open at the starting limits. */
  const withLiveRepo = (fn: (ctx: Ctx) => Promise<void>) =>
    withRepo(async (ctx) => {
      await ctx.repo.saveSettings({ live: true, ...ROULETTE_DEFAULT_LIMITS }, 'moose');
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
    (await new sql.Request(tx).query<SpinTableRow & { dwID: number }>(`SELECT * FROM ${db.tables.rouletteSpins} ORDER BY dwID`)).recordset;

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

  const bet = (character: Character, overrides: Partial<BetInput> = {}): BetInput => ({
    userId: character.userId,
    charId: character.charId,
    pocket: 17,
    stake: 1200,
    payout: 3600,
    bets: 'n17:100,red:1100',
    numberHit: true,
    ...overrides,
  });

  it('is closed with the starting limits before anything is saved', () =>
    withRepo(async ({ repo }) => {
      expect(await repo.settings()).toEqual({ live: false, ...ROULETTE_DEFAULT_LIMITS });
    }));

  it('saves and reads back the switch and limits', () =>
    withRepo(async ({ repo, tx }) => {
      await repo.saveSettings({ live: true, minBet: 50, maxNumber: 2000, maxOutside: 20_000 }, 'moose');
      expect(await repo.settings()).toEqual({ live: true, minBet: 50, maxNumber: 2000, maxOutside: 20_000 });

      await repo.saveSettings({ live: false, minBet: 25, maxNumber: 500, maxOutside: 7000 }, 'otter');
      expect(await repo.settings()).toEqual({ live: false, minBet: 25, maxNumber: 500, maxOutside: 7000 });

      const rows = await new sql.Request(tx).query<{ szKey: string; szUpdatedBy: string }>(
        `SELECT szKey, szUpdatedBy FROM ${db.tables.portalSettings} WHERE szKey LIKE 'roulette[_]%' ORDER BY szKey`,
      );
      expect(rows.recordset).toEqual([
        { szKey: ROULETTE_LIVE_KEY, szUpdatedBy: 'otter' },
        { szKey: 'roulette_max_number', szUpdatedBy: 'otter' },
        { szKey: 'roulette_max_outside', szUpdatedBy: 'otter' },
        { szKey: 'roulette_min_bet', szUpdatedBy: 'otter' },
      ]);
    }));

  it.each([['abc'], ['-5'], ['0'], ['1.5'], ['2000000']])('falls back to the starting limit when roulette_min_bet is %s', (value) =>
    withRepo(async ({ repo, tx }) => {
      await repo.saveSettings({ live: true, minBet: 20, maxNumber: 3000, maxOutside: 30_000 }, 'moose');
      await setRawSetting(tx, 'roulette_min_bet', value);

      expect(await repo.settings()).toEqual({ live: true, minBet: ROULETTE_DEFAULT_LIMITS.minBet, maxNumber: 3000, maxOutside: 30_000 });
    }));

  it('falls back to all starting limits when the smallest bet is above a largest', () =>
    withRepo(async ({ repo }) => {
      await repo.saveSettings({ live: true, minBet: 5000, maxNumber: 1000, maxOutside: 30_000 }, 'moose');

      expect(await repo.settings()).toEqual({ live: true, ...ROULETTE_DEFAULT_LIMITS });
    }));

  it("lists the account's characters with wallet and online flag, and nobody else's", () =>
    withRepo(async ({ repo, tx, character }) => {
      await goOnline(tx, character.userId, character.charId);
      const expected = await new sql.Request(tx)
        .input('userId', sql.Int, character.userId)
        .query<{ charId: number }>(`SELECT dwCharID AS charId FROM ${db.tables.characters} WHERE dwUserID = @userId AND bDelete = 0 ORDER BY bSlot`);

      const rows = await repo.characters(character.userId);

      expect(rows.map((row) => row.charId)).toEqual(expected.recordset.map((row) => row.charId));
      expect(rows.find((row) => row.charId === character.charId)).toEqual({
        charId: character.charId,
        name: character.name,
        level: expect.any(Number),
        classCode: expect.any(Number),
        ...START,
        online: true,
      });
      expect(rows.filter((row) => row.charId !== character.charId).every((row) => row.online === false)).toBe(true);

      await new sql.Request(tx).input('charId', sql.Int, character.charId).query(`UPDATE ${db.tables.characters} SET bDelete = 1 WHERE dwCharID = @charId`);
      expect((await repo.characters(character.userId)).some((row) => row.charId === character.charId)).toBe(false);
      expect(await repo.characters(-1)).toEqual([]);
    }));

  it('a win adds the payout less the stake and keeps the loose Bronze', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      const outcome = await repo.bet(bet(character, { stake: 1200, payout: 3600 }));

      const wallet = await walletOf(tx, character.charId);
      expect(wallet).toEqual({ gold: 7, silver: 650, copper: 999 });
      expect(outcome).toEqual({ code: BET_OK, id: expect.any(Number), wallet });
    }));

  it('a loss takes exactly the stake', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      const outcome = await repo.bet(bet(character, { stake: 1250, payout: 0, numberHit: false }));

      expect(await walletOf(tx, character.charId)).toEqual({ gold: 4, silver: 0, copper: 999 });
      expect(outcome).toMatchObject({ code: BET_OK, wallet: { gold: 4, silver: 0, copper: 999 } });
    }));

  it('records the spin with what moved', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      const outcome = await repo.bet(bet(character));
      if (outcome.code !== BET_OK) throw new Error(`bet refused with ${outcome.code}`);

      const rows = await spinRows(tx);
      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(row.dwID).toBe(outcome.id);
      expect({ ...row, llStake: Number(row.llStake), llPayout: Number(row.llPayout), llWallet: Number(row.llWallet) }).toMatchObject({
        dwUserID: character.userId,
        dwCharID: character.charId,
        szCharName: character.name,
        bPocket: 17,
        llStake: 1_200_000,
        llPayout: 3_600_000,
        llWallet: 7_650_999,
        szBets: 'n17:100,red:1100',
        bNumberHit: 1,
      });

      const spins = await repo.spinsOf(character.userId, 10);
      expect(spins).toEqual([
        { id: outcome.id, userId: character.userId, character: character.name, spunAt: expect.any(Date), pocket: 17, stake: 1200, payout: 3600 },
      ]);
      expect(await repo.spinsOf(character.userId + 1, 10)).toEqual([]);
    }));

  it('refuses while the table is closed and writes nothing', () =>
    withRepo(async ({ repo, tx, character }) => {
      await repo.saveSettings({ live: false, ...ROULETTE_DEFAULT_LIMITS }, 'moose');

      expect(await repo.bet(bet(character))).toEqual({ code: BET_CLOSED, name: null });
      expect(await walletOf(tx, character.charId)).toEqual(START);
      expect(await spinRows(tx)).toEqual([]);
    }));

  it("refuses another account's character", () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      expect(await repo.bet(bet(character, { userId: character.userId + 1 }))).toEqual({ code: BET_NOT_YOURS, name: null });
      expect(await walletOf(tx, character.charId)).toEqual(START);
      expect(await spinRows(tx)).toEqual([]);
    }));

  it('refuses a deleted character', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      await new sql.Request(tx).input('charId', sql.Int, character.charId).query(`UPDATE ${db.tables.characters} SET bDelete = 1 WHERE dwCharID = @charId`);

      expect(await repo.bet(bet(character))).toEqual({ code: BET_NOT_YOURS, name: null });
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

  it('allows a bet while the account sits at the character list', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      await goOnline(tx, character.userId, 0);

      expect(await repo.bet(bet(character))).toMatchObject({ code: BET_OK, wallet: { gold: 7, silver: 650, copper: 999 } });
      expect(await spinRows(tx)).toHaveLength(1);
    }));

  it('allows a bet while another character of the account is in the game', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      await goOnline(tx, character.userId, character.charId + 1_000_000);

      expect(await repo.bet(bet(character))).toMatchObject({ code: BET_OK, wallet: { gold: 7, silver: 650, copper: 999 } });
      expect(await spinRows(tx)).toHaveLength(1);
    }));

  it("holds the account's place in the online list, so a login waits for the bet", () =>
    withLiveRepo(async ({ repo, character }) => {
      // What TLogin does, from another connection, in a transaction of its own that is rolled back.
      const login = () =>
        inRolledBackTransaction(db, (other) =>
          new sql.Request(other)
            .input('userId', sql.Int, character.userId)
            .query(
              `SET LOCK_TIMEOUT 1000;
               INSERT INTO ${db.tables.currentUsers} (dwUserID, dwCharID, bGroupID, bChannel, wPort, bLocked, szLoginIP)
               VALUES (@userId, 0, 1, 1, 0, 0, '127.0.0.1')`,
            )
            .then(() => undefined),
        );
      await expect(login()).resolves.toBeUndefined();

      // The test's own transaction is still open, so the lock the bet took is still held.
      expect(await repo.bet(bet(character))).toMatchObject({ code: BET_OK });

      await expect(login()).rejects.toThrow(/Lock request time out/);
    }));

  it('refuses a stake one Silver above the wallet, and takes one that empties it', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      expect(await repo.bet(bet(character, { stake: 5251, payout: 0, numberHit: false }))).toEqual({ code: BET_POOR, name: character.name });
      expect(await walletOf(tx, character.charId)).toEqual(START);
      expect(await spinRows(tx)).toEqual([]);

      const outcome = await repo.bet(bet(character, { stake: 5250, payout: 0, numberHit: false }));
      expect(outcome).toEqual({ code: BET_OK, id: expect.any(Number), wallet: { gold: 0, silver: 0, copper: 999 } });
      expect(await walletOf(tx, character.charId)).toEqual({ gold: 0, silver: 0, copper: 999 });
    }));

  it('rejects a negative stake or payout before touching anything', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      await expect(repo.bet(bet(character, { stake: -100, payout: 0, numberHit: false }))).rejects.toThrow('Stake and payout cannot be negative');
      await expect(repo.bet(bet(character, { stake: 100, payout: -100, numberHit: false }))).rejects.toThrow('Stake and payout cannot be negative');

      expect(await walletOf(tx, character.charId)).toEqual(START);
      expect(await spinRows(tx)).toEqual([]);
    }));

  it('lists big wins only when a number bet won, newest first', () =>
    withLiveRepo(async ({ repo, character }) => {
      const ids: number[] = [];
      for (const numberHit of [true, false, true]) {
        const outcome = await repo.bet(bet(character, { stake: 100, payout: numberHit ? 3600 : 200, numberHit }));
        if (outcome.code !== BET_OK) throw new Error(`bet refused with ${outcome.code}`);
        ids.push(outcome.id);
      }

      expect((await repo.bigWins(10)).map((row) => row.id)).toEqual([ids[2], ids[0]]);
      expect((await repo.bigWins(1)).map((row) => row.id)).toEqual([ids[2]]);
      expect((await repo.latest(10)).map((row) => row.id)).toEqual([ids[2], ids[1], ids[0]]);
      expect((await repo.latest(2)).map((row) => row.id)).toEqual([ids[2], ids[1]]);
    }));

  it('adds up today and all time', () =>
    withLiveRepo(async ({ repo, tx, character }) => {
      expect(await repo.totals()).toEqual({ today: { spins: 0, staked: 0, paid: 0 }, allTime: { spins: 0, staked: 0, paid: 0 } });

      const old = await repo.bet(bet(character, { stake: 300, payout: 0, numberHit: false }));
      await repo.bet(bet(character, { stake: 100, payout: 0, numberHit: false }));
      await repo.bet(bet(character, { stake: 200, payout: 700, numberHit: false }));
      if (old.code !== BET_OK) throw new Error(`bet refused with ${old.code}`);
      await new sql.Request(tx).input('id', sql.Int, old.id).query(`UPDATE ${db.tables.rouletteSpins} SET dSpun = DATEADD(day, -1, dSpun) WHERE dwID = @id`);

      expect(await repo.totals()).toEqual({ today: { spins: 2, staked: 300, paid: 700 }, allTime: { spins: 3, staked: 600, paid: 700 } });
    }));
});
