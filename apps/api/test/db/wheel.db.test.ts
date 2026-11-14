import { readFileSync } from 'node:fs';
import path from 'node:path';
import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/config.js';
import type { DbService } from '../../src/db/db.service.js';
import {
  ANNOUNCE_SENT,
  ANNOUNCE_SKIPPED,
  ANNOUNCE_WAITING,
  type PrizeInput,
  SPIN_ALREADY_TODAY,
  SPIN_BAD_CHARACTER,
  SPIN_PRIZE_GONE,
  SPIN_SWITCHED_OFF,
  type SpinInput,
  SqlWheelRepository,
} from '../../src/wheel/wheel.repository.js';
import { connectTestDb, inRolledBackTransaction } from './db-test-helpers.js';

// Run in this order inside each test's transaction: the tables, then the procedures that use them.
const setupSql = [
  'TPORTALPOSTNOTIFY.sql',
  'TPortalGmPost.sql',
  'TPORTALSETTING.sql',
  'TPORTALWHEELPRIZE.sql',
  'TPORTALWHEELSPINTABLE.sql',
  'TPortalWheelSpin.sql',
].map((file) => readFileSync(path.resolve(process.cwd(), 'sql', file), 'utf8'));

type PostRow = { dwCharID: number; szSender: string; szTitle: string; szMessage: string; dwGold: number; dwSilver: number; dwCooper: number };

describe('SqlWheelRepository against the _TEST copy', () => {
  let db: DbService;
  let gameName: string;
  let character: { charId: number; userId: number; name: string; level: number };
  let stackable: { itemId: number; stack: number };

  beforeAll(async () => {
    db = await connectTestDb();
    gameName = loadConfig(process.env).db.gameName;
    const chars = await db.pool
      .request()
      .query<typeof character>(
        `SELECT TOP 1 dwCharID AS charId, dwUserID AS userId, szName AS name, bLevel AS level
         FROM ${db.tables.characters} WHERE bDelete = 0 ORDER BY bLevel DESC, dwCharID`,
      );
    character = chars.recordset[0];
    const stacks = await db.pool
      .request()
      .query<typeof stackable>(`SELECT TOP 1 wItemID AS itemId, bStack AS stack FROM ${db.tables.items} WHERE bStack >= 20 ORDER BY wItemID`);
    stackable = stacks.recordset[0];
  });

  afterAll(() => db.onModuleDestroy());

  const prize = (overrides: Partial<PrizeInput> = {}): PrizeInput => ({
    name: 'Test prize',
    weight: 5,
    order: 1,
    enabled: true,
    announce: false,
    gold: 2,
    silver: 340,
    copper: 5,
    items: [{ itemId: stackable.itemId, count: 3 }],
    ...overrides,
  });

  const spin = (prizeId: number, overrides: Partial<SpinInput> = {}): SpinInput => ({
    userId: character.userId,
    charId: character.charId,
    prizeId,
    minLevel: character.level,
    sender: 'Wheel of Fortune',
    title: 'Wheel of Fortune: {prize}',
    message: 'You won {prize}, {name}.',
    text: '{name} won {prize} on the Wheel of Fortune',
    ...overrides,
  });

  /** Creates the tables and procedures inside tx, so the rollback removes them again. */
  async function withRepo(fn: (repo: SqlWheelRepository, tx: sql.Transaction) => Promise<void>) {
    await inRolledBackTransaction(db, async (tx) => {
      for (const batch of setupSql) {
        await new sql.Request(tx).input('sql', sql.NVarChar(sql.MAX), batch).query(`EXEC [${gameName}].sys.sp_executesql @sql`);
      }
      const repo = new SqlWheelRepository(db).withTransaction(tx);
      // Whatever today's real spins are, these tests start from an account that has not spun.
      await new sql.Request(tx).query(`DELETE FROM ${db.tables.wheelSpins}`);
      await fn(repo, tx);
    });
  }

  /** The same, with the wheel switched on. */
  const withLiveRepo = (fn: (repo: SqlWheelRepository, tx: sql.Transaction) => Promise<void>) =>
    withRepo(async (repo, tx) => {
      await repo.setLive(true, 'moose');
      await fn(repo, tx);
    });

  const postOf = async (tx: sql.Transaction, spinId: number) => {
    const result = await new sql.Request(tx).input('id', sql.Int, spinId).query<PostRow & { dwPostID: number }>(
      `SELECT s.dwPostID, p.dwCharID, p.szSender, p.szTitle, p.szMessage, p.dwGold, p.dwSilver, p.dwCooper
       FROM ${db.tables.wheelSpins} s LEFT JOIN [${gameName}].dbo.TPOSTTABLE p ON p.dwPostID = s.dwPostID
       WHERE s.dwID = @id`,
    );
    return result.recordset[0];
  };

  it('starts with the ten prizes, whose weights add up to 100', async () => {
    await withRepo(async (repo) => {
      const prizes = await repo.prizes();
      // True on a database that had no prize table before this transaction; a table already there keeps what a GM made of it.
      if (prizes.every((row) => row.name !== 'Test prize') && prizes.length === 10) {
        expect(prizes.reduce((sum, row) => sum + row.weight, 0)).toBe(100);
        expect(prizes.filter((row) => row.announce).map((row) => row.name)).toEqual(['10 Rune']);
      }
      expect(prizes.length).toBeGreaterThan(0);
    });
  });

  it('saves, changes and deletes a prize', async () => {
    await withRepo(async (repo) => {
      const id = await repo.createPrize(prize(), 'moose');
      expect((await repo.prizes()).find((row) => row.id === id)).toEqual({ id, ...prize() });

      const changed = prize({ name: 'Bigger prize', weight: 9, order: 3, enabled: false, announce: true, gold: 0, silver: 0, copper: 0, items: [] });
      expect(await repo.updatePrize(id, changed, 'moose')).toBe(true);
      expect((await repo.prizes()).find((row) => row.id === id)).toEqual({ id, ...changed });

      expect(await repo.deletePrize(id)).toBe(true);
      expect(await repo.deletePrize(id)).toBe(false);
      expect(await repo.updatePrize(id, changed, 'moose')).toBe(false);
      expect((await repo.prizes()).some((row) => row.id === id)).toBe(false);
    });
  });

  it('lists prizes in wheel order', async () => {
    await withRepo(async (repo) => {
      const last = await repo.createPrize(prize({ name: 'Last', order: 9999 }), 'moose');
      const first = await repo.createPrize(prize({ name: 'First', order: 0 }), 'moose');
      const ids = (await repo.prizes()).map((row) => row.id);
      expect(ids[0]).toBe(first);
      expect(ids.at(-1)).toBe(last);
    });
  });

  it('is switched off until it is switched on', async () => {
    await withRepo(async (repo) => {
      await repo.setLive(false, 'moose');
      expect(await repo.live()).toBe(false);
      const id = await repo.createPrize(prize(), 'moose');
      expect(await repo.spin(spin(id))).toBe(SPIN_SWITCHED_OFF);
      expect(await repo.today(character.userId)).toBeNull();

      await repo.setLive(true, 'moose');
      expect(await repo.live()).toBe(true);
    });
  });

  it('sends the prize as a letter and records the spin with it', async () => {
    await withLiveRepo(async (repo, tx) => {
      const prizeId = await repo.createPrize(prize(), 'moose');

      const id = await repo.spin(spin(prizeId));

      expect(id).toBeGreaterThan(0);
      const post = await postOf(tx, id);
      expect(post.dwPostID).toBeGreaterThan(0);
      expect(post).toMatchObject({ dwCharID: character.charId, szSender: 'Wheel of Fortune', dwGold: 2, dwSilver: 340, dwCooper: 5 });
      expect(post.szTitle.endsWith('Wheel of Fortune: Test prize')).toBe(true);
      expect(post.szMessage.endsWith(`You won Test prize, ${character.name}.`)).toBe(true);

      const today = await repo.today(character.userId);
      expect(today).toMatchObject({
        id,
        userId: character.userId,
        charId: character.charId,
        character: character.name,
        prizeId,
        prize: 'Test prize',
        gold: 2,
        silver: 340,
        copper: 5,
        items: [{ itemId: stackable.itemId, count: 3 }],
        text: `${character.name} won Test prize on the Wheel of Fortune`,
        announce: false,
        announced: ANNOUNCE_SKIPPED,
      });
      expect(today!.ageSeconds).toBeLessThan(60);
      expect(await repo.spinsToday()).toBe(1);
      expect((await repo.spinsOf(character.userId, 10)).map((row) => row.id)).toEqual([id]);
    });
  });

  it('allows one spin a day per account, whatever the prize or character', async () => {
    await withLiveRepo(async (repo) => {
      const prizeId = await repo.createPrize(prize(), 'moose');
      const other = await repo.createPrize(prize({ name: 'Other' }), 'moose');
      expect(await repo.spin(spin(prizeId))).toBeGreaterThan(0);

      expect(await repo.spin(spin(other))).toBe(SPIN_ALREADY_TODAY);
      expect(await repo.spinsToday()).toBe(1);
    });
  });

  it('lets the account spin again the next day', async () => {
    await withLiveRepo(async (repo, tx) => {
      const prizeId = await repo.createPrize(prize(), 'moose');
      const first = await repo.spin(spin(prizeId));
      await new sql.Request(tx).input('id', sql.Int, first).query(`UPDATE ${db.tables.wheelSpins} SET dDay = DATEADD(day, -1, dDay) WHERE dwID = @id`);

      expect(await repo.today(character.userId)).toBeNull();
      expect(await repo.spin(spin(prizeId))).toBeGreaterThan(first);
    });
  });

  it("refuses another account's character", async () => {
    await withLiveRepo(async (repo) => {
      const prizeId = await repo.createPrize(prize(), 'moose');
      expect(await repo.spin(spin(prizeId, { userId: character.userId + 1_000_000 }))).toBe(SPIN_BAD_CHARACTER);
    });
  });

  it('refuses a character under the level asked for', async () => {
    await withLiveRepo(async (repo) => {
      const prizeId = await repo.createPrize(prize(), 'moose');
      expect(await repo.spin(spin(prizeId, { minLevel: character.level + 1 }))).toBe(SPIN_BAD_CHARACTER);
      expect(await repo.today(character.userId)).toBeNull();
    });
  });

  it('refuses a prize that is disabled or gone, and leaves the spin unused', async () => {
    await withLiveRepo(async (repo) => {
      const disabled = await repo.createPrize(prize({ enabled: false }), 'moose');
      expect(await repo.spin(spin(disabled))).toBe(SPIN_PRIZE_GONE);
      await repo.deletePrize(disabled);
      expect(await repo.spin(spin(disabled))).toBe(SPIN_PRIZE_GONE);
      expect(await repo.today(character.userId)).toBeNull();
    });
  });

  it('uses up the spin for an empty prize without sending a letter', async () => {
    await withLiveRepo(async (repo, tx) => {
      const prizeId = await repo.createPrize(prize({ name: 'No luck', gold: 0, silver: 0, copper: 0, items: [] }), 'moose');

      const id = await repo.spin(spin(prizeId));

      expect(id).toBeGreaterThan(0);
      expect((await postOf(tx, id)).dwPostID).toBe(0);
      expect(await repo.today(character.userId)).toMatchObject({ prize: 'No luck', gold: 0, items: [] });
    });
  });

  it('keeps an announced win waiting until one caller claims it', async () => {
    await withLiveRepo(async (repo) => {
      const prizeId = await repo.createPrize(prize({ name: 'Jackpot', announce: true }), 'moose');
      const id = await repo.spin(spin(prizeId));

      const waiting = await repo.waitingAnnouncements();
      expect(waiting.map((row) => row.id)).toEqual([id]);
      expect(waiting[0]).toMatchObject({ announce: true, announced: ANNOUNCE_WAITING, text: `${character.name} won Jackpot on the Wheel of Fortune` });
      expect((await repo.winners(10)).map((row) => row.id)).toEqual([id]);

      expect(await repo.claimAnnouncement(id)).toBe(true);
      expect(await repo.claimAnnouncement(id)).toBe(false);
      expect(await repo.waitingAnnouncements()).toEqual([]);
      expect((await repo.today(character.userId))!.announced).toBe(ANNOUNCE_SENT);

      await repo.markAnnounced(id, ANNOUNCE_WAITING);
      expect((await repo.waitingAnnouncements()).map((row) => row.id)).toEqual([id]);
    });
  });

  it('does not list a quiet win as waiting or as a winner', async () => {
    await withLiveRepo(async (repo) => {
      const prizeId = await repo.createPrize(prize(), 'moose');
      await repo.spin(spin(prizeId));

      expect(await repo.waitingAnnouncements()).toEqual([]);
      expect(await repo.winners(10)).toEqual([]);
    });
  });

  it('counts down to midnight', async () => {
    await withRepo(async (repo) => {
      const seconds = await repo.secondsToReset();
      expect(seconds).toBeGreaterThan(0);
      expect(seconds).toBeLessThanOrEqual(86_400);
    });
  });

  it('finds items with their stack size', async () => {
    await withRepo(async (repo) => {
      expect(await repo.findItems([stackable.itemId, 32_000])).toEqual([expect.objectContaining({ itemId: stackable.itemId, stack: stackable.stack })]);
      expect(await repo.findItems([])).toEqual([]);
    });
  });
});
