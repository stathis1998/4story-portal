import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Wallet } from '@4story-portal/shared';
import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/config.js';
import type { DbService } from '../../src/db/db.service.js';
import {
  REBIRTH_AT_LIMIT,
  REBIRTH_CLOSED,
  REBIRTH_KEYS,
  REBIRTH_LOW_LEVEL,
  REBIRTH_NOT_YOURS,
  REBIRTH_OK,
  REBIRTH_ONLINE,
  REBIRTH_POOR,
  REBIRTH_PRICE_CHANGED,
  REBIRTH_WEARING,
  type RebirthCode,
  START_SKILL_POINTS,
} from '../../src/rebirth/rebirth-sql.js';
import { ANNOUNCE_SKIPPED, ANNOUNCE_WAITING, type RebirthInput, SqlRebirthRepository } from '../../src/rebirth/rebirth.repository.js';
import { connectTestDb, inRolledBackTransaction } from './db-test-helpers.js';

const setupSql = ['TPORTALSETTING.sql'].map((file) => readFileSync(path.resolve(process.cwd(), 'sql', file), 'utf8'));

type Character = { charId: number; userId: number; name: string; classId: number; raceId: number; country: number };
/** The four setting rows as stored; null leaves the row out. */
type Settings = Record<'live' | 'priceGold' | 'percent' | 'limit', string | null>;
type ReadyOptions = { settings?: Partial<Settings>; wallet?: Wallet };
type Ctx = { repo: SqlRebirthRepository; tx: sql.Transaction; character: Character };
type StartSkill = { wSkillID: number; bLevel: number; bKind: number };

const START: Wallet = { gold: 5000, silver: 250, copper: 999 };
const BASELINE = '{"kills":7}';
const TEXT = '{name} was reborn (rebirth {rebirth})';
const NO_CHART_SKILL = 32000; // above every TSKILLCHART wID
const ITEM_ID = 7921;

describe('SqlRebirthRepository against the _TEST copy', () => {
  let db: DbService;
  let t: DbService['tables'];
  let gameName: string;

  beforeAll(async () => {
    db = await connectTestDb();
    t = db.tables;
    gameName = loadConfig(process.env).db.gameName;
  });

  afterAll(() => db.onModuleDestroy());

  /** Runs a statement on tx; numbers bind as INT, strings as VARCHAR. */
  async function exec<T = Record<string, unknown>>(tx: sql.Transaction, query: string, inputs: Record<string, number | string> = {}): Promise<T[]> {
    const request = new sql.Request(tx);
    for (const [name, value] of Object.entries(inputs)) request.input(name, typeof value === 'number' ? sql.Int : sql.VarChar(2000), value);
    return (await request.query<T>(query)).recordset ?? [];
  }

  const ids = (c: Character) => ({ charId: c.charId, userId: c.userId });

  /**
   * Inside tx: the highest-level character at level 90 with a known wallet, nothing worn, never reborn and
   * offline, and rebirth open at price 2000, 2 percent, limit 10.
   */
  async function ready(tx: sql.Transaction, options: ReadyOptions = {}): Promise<Character> {
    for (const batch of setupSql) {
      await new sql.Request(tx).input('sql', sql.NVarChar(sql.MAX), batch).query(`EXEC [${gameName}].sys.sp_executesql @sql`);
    }
    const [character] = await exec<Character>(
      tx,
      `SELECT TOP 1 dwCharID AS charId, dwUserID AS userId, szNAME AS name, bClass AS classId, bRace AS raceId, bCountry AS country
       FROM ${t.characters} WHERE bDelete = 0 ORDER BY bLevel DESC, dwCharID`,
    );
    const wallet = options.wallet ?? START;
    await exec(
      tx,
      `UPDATE ${t.characters} SET bLevel = 90, dwGold = @gold, dwSilver = @silver, dwCooper = @copper WHERE dwCharID = @charId;
       UPDATE ${t.allCharacters} SET bLevel = 90 WHERE dwCharID = @charId;
       DELETE FROM ${t.characterItems} WHERE dwOwnerID = @charId AND bOwnerType = 0 AND bStorageType = 0 AND dwStorageID = 254;
       DELETE FROM ${t.rebirths} WHERE dwCharID = @charId;
       DELETE FROM ${t.rebirthLog} WHERE dwCharID = @charId;
       DELETE FROM ${t.currentUsers} WHERE dwUserID = @userId OR dwCharID = @charId;
       DELETE FROM ${t.portalSettings} WHERE szKey LIKE 'rebirth[_]%';`,
      { ...ids(character), ...wallet },
    );
    const settings: Settings = { live: 'true', priceGold: '2000', percent: '2', limit: '10', ...options.settings };
    for (const [name, value] of Object.entries(settings)) {
      if (value === null) continue;
      await exec(tx, `INSERT INTO ${t.portalSettings} (szKey, szValue, szUpdatedBy) VALUES (@key, @value, 'test')`, {
        key: REBIRTH_KEYS[name as keyof Settings],
        value,
      });
    }
    return character;
  }

  const withReady = (fn: (ctx: Ctx) => Promise<void>, options: ReadyOptions = {}) =>
    inRolledBackTransaction(db, async (tx) => {
      const character = await ready(tx, options);
      await fn({ repo: new SqlRebirthRepository(db).withTransaction(tx), tx, character });
    });

  const go = ({ repo, character }: Ctx, overrides: Partial<RebirthInput> = {}) =>
    repo.rebirth({ ...ids(character), expectedPriceGold: 2000, baseline: BASELINE, text: TEXT, ...overrides });

  const walletOf = async (tx: sql.Transaction, charId: number): Promise<Wallet> =>
    (await exec<Wallet>(tx, `SELECT dwGold AS gold, dwSilver AS silver, dwCooper AS copper FROM ${t.characters} WHERE dwCharID = @charId`, { charId }))[0];

  const setLevel = (tx: sql.Transaction, charId: number, level: number) =>
    exec(tx, `UPDATE ${t.characters} SET bLevel = @level WHERE dwCharID = @charId`, { charId, level });

  const goOnline = (tx: sql.Transaction, c: Character) =>
    exec(
      tx,
      `INSERT INTO ${t.currentUsers} (dwUserID, dwCharID, bGroupID, bChannel, wPort, bLocked, szLoginIP)
       VALUES (@userId, @charId, 1, 1, 0, 0, '127.0.0.1')`,
      ids(c),
    );

  /** Puts a copy of some item in the character's equipment bag. */
  const wear = (tx: sql.Transaction, charId: number) =>
    exec(
      tx,
      `SELECT TOP 1 * INTO #worn FROM ${t.characterItems} ORDER BY dlID;
       UPDATE #worn SET dlID = (SELECT MAX(dlID) + 1 FROM ${t.characterItems}), bStorageType = 0, dwStorageID = 254,
                        bOwnerType = 0, dwOwnerID = @charId, bItemID = 0;
       INSERT INTO ${t.characterItems} SELECT * FROM #worn;
       DROP TABLE #worn;`,
      { charId },
    );

  const setSkill = (tx: sql.Transaction, charId: number, wSkillID: number, bLevel: number) =>
    exec(
      tx,
      `DELETE FROM ${t.skills} WHERE dwCharID = @charId AND wSkillID = @wSkillID;
       INSERT INTO ${t.skills} (dwCharID, wSkillID, bLevel, dwRemainTick) VALUES (@charId, @wSkillID, @bLevel, 0);`,
      { charId, wSkillID, bLevel },
    );

  const skillLevel = async (tx: sql.Transaction, charId: number, wSkillID: number) =>
    (await exec<{ bLevel: number }>(tx, `SELECT bLevel FROM ${t.skills} WHERE dwCharID = @charId AND wSkillID = @wSkillID`, { charId, wSkillID })).map(
      (row) => row.bLevel,
    );

  /** The class's start skills with their chart kind, by skill ID. */
  const startSkillsOf = (tx: sql.Transaction, classId: number) =>
    exec<StartSkill>(
      tx,
      `SELECT st.wSkillID, st.bLevel, c.bKind FROM ${t.startSkills} st JOIN ${t.skillChart} c ON c.wID = st.wSkillID
       WHERE st.bClassID = @classId ORDER BY st.wSkillID`,
      { classId },
    );

  const logRows = (tx: sql.Transaction, charId: number) => exec(tx, `SELECT * FROM ${t.rebirthLog} WHERE dwCharID = @charId ORDER BY dwID`, { charId });
  const rebirthRows = (tx: sql.Transaction, charId: number) =>
    exec(tx, `SELECT dwCharID, bRebirth, bStatBonus FROM ${t.rebirths} WHERE dwCharID = @charId`, { charId });

  /** The character's rows in each table, one query at a time (a transaction runs one request at once). */
  const countRows = async (tx: sql.Transaction, tables: string[], charId: number) => {
    const counts: number[] = [];
    for (const table of tables) counts.push((await exec<{ n: number }>(tx, `SELECT COUNT(*) AS n FROM ${table} WHERE dwCharID = @charId`, { charId }))[0].n);
    return counts;
  };

  /** Everything the batch may write for this character. */
  const snapshot = async (tx: sql.Transaction, c: Character) => ({
    character: await exec(tx, `SELECT * FROM ${t.characters} WHERE dwCharID = @charId`, ids(c)),
    allCharacter: await exec(tx, `SELECT bLevel, dwEXP FROM ${t.allCharacters} WHERE dwCharID = @charId`, ids(c)),
    skills: await exec(tx, `SELECT wSkillID, bLevel, dwRemainTick FROM ${t.skills} WHERE dwCharID = @charId ORDER BY wSkillID`, ids(c)),
    hotkeys: await exec(tx, `SELECT * FROM ${t.hotkeys} WHERE dwCharID = @charId ORDER BY bInvenID`, ids(c)),
    counts: await countRows(tx, [t.skillMaintains, t.quests, t.questTerms, t.levelFreezes], c.charId),
    rebirths: await rebirthRows(tx, c.charId),
    log: await logRows(tx, c.charId),
  });

  it('resets the character and takes the price to the coin', () =>
    withReady(async (ctx) => {
      const { tx, character } = ctx;
      await exec(
        tx,
        `UPDATE ${t.characters} SET dwEXP = 123456, wSkillPoint = 77, wSpawnID = 1, wMapID = 99, fPosX = 1, fPosY = 2, fPosZ = 3,
                wLastSpawnID = 5, dwLastDestination = 7, dwRegion = 9, bAftermath = 1 WHERE dwCharID = @charId;
         UPDATE ${t.allCharacters} SET dwEXP = 123456 WHERE dwCharID = @charId;`,
        ids(character),
      );

      const outcome = await go(ctx);

      const wallet = { gold: 3000, silver: 250, copper: 999 };
      expect(outcome).toEqual({ code: REBIRTH_OK, id: expect.any(Number), name: character.name, rebirth: 1, bonus: 2, priceGold: 2000, wallet });

      const levelZero = (await exec<{ dwEXP: number }>(tx, `SELECT dwEXP FROM ${t.levels} WHERE bLevel = 0`))[0]?.dwEXP ?? 0;
      const spawnId = [15001, 15002][character.country] ?? 15003;
      const [spawn] = await exec(tx, `SELECT wMapID, fPosX, fPosY, fPosZ FROM ${t.spawnPositions} WHERE wID = @spawnId`, { spawnId });
      const [stats] = await exec<{ con: number; men: number }>(
        tx,
        `SELECT c.wCON + r.wCON AS con, c.wMEN + r.wMEN AS men FROM ${t.classChart} c, ${t.raceChart} r
         WHERE c.bClassID = @classId AND r.bRaceID = @raceId`,
        { classId: character.classId, raceId: character.raceId },
      );
      const [row] = await exec(
        tx,
        `SELECT bLevel, dwEXP, wSkillPoint, dwHP, dwMP, wSpawnID, wMapID, fPosX, fPosY, fPosZ, wLastSpawnID, dwLastDestination,
                dwRegion, bAftermath, dwGold AS gold, dwSilver AS silver, dwCooper AS copper
         FROM ${t.characters} WHERE dwCharID = @charId`,
        ids(character),
      );
      expect(row).toEqual({
        bLevel: 1,
        dwEXP: levelZero,
        wSkillPoint: START_SKILL_POINTS,
        dwHP: 7 * (2 + stats.con) + 1,
        dwMP: 9 * (2 + stats.men) + 1,
        wSpawnID: spawnId,
        ...spawn,
        wLastSpawnID: 0,
        dwLastDestination: 0,
        dwRegion: 0,
        bAftermath: 0,
        ...wallet,
      });

      const all = await exec(tx, `SELECT bLevel, dwEXP FROM ${t.allCharacters} WHERE dwCharID = @charId AND dwUserID = @userId`, ids(character));
      expect(all).toEqual([{ bLevel: 1, dwEXP: levelZero }]);
    }));

  it('leaves a wallet that equals the price at zero', () =>
    withReady(
      async (ctx) => {
        expect(await go(ctx)).toMatchObject({ code: REBIRTH_OK, wallet: { gold: 0, silver: 0, copper: 0 } });
        expect(await walletOf(ctx.tx, ctx.character.charId)).toEqual({ gold: 0, silver: 0, copper: 0 });
      },
      { wallet: { gold: 2000, silver: 0, copper: 0 } },
    ));

  it("puts the skills back to a new character's", () =>
    withReady(async (ctx) => {
      const { tx, character } = ctx;
      const start = await startSkillsOf(tx, character.classId);
      const classSkills = start.filter((s) => s.bKind !== 0);
      const [raised, removed] = classSkills;
      const equip = start.find((s) => s.bKind === 0)!;
      const [extra] = await exec<{ wSkillID: number }>(
        tx,
        `SELECT TOP 1 c.wID AS wSkillID FROM ${t.skillChart} c
         WHERE c.bKind <> 0
           AND NOT EXISTS (SELECT 1 FROM ${t.startSkills} st WHERE st.bClassID = @classId AND st.wSkillID = c.wID)
           AND NOT EXISTS (SELECT 1 FROM ${t.skills} s WHERE s.dwCharID = @charId AND s.wSkillID = c.wID)
         ORDER BY c.wID`,
        { classId: character.classId, charId: character.charId },
      );
      await setSkill(tx, character.charId, raised.wSkillID, 5);
      await exec(tx, `DELETE FROM ${t.skills} WHERE dwCharID = @charId AND wSkillID = @wSkillID`, { charId: character.charId, wSkillID: removed.wSkillID });
      await setSkill(tx, character.charId, extra.wSkillID, 3);
      await setSkill(tx, character.charId, equip.wSkillID, 3);
      await setSkill(tx, character.charId, NO_CHART_SKILL, 4);

      expect(await go(ctx)).toMatchObject({ code: REBIRTH_OK });

      const learned = await exec(
        tx,
        `SELECT s.wSkillID, s.bLevel FROM ${t.skills} s JOIN ${t.skillChart} c ON c.wID = s.wSkillID
         WHERE s.dwCharID = @charId AND c.bKind <> 0 ORDER BY s.wSkillID`,
        ids(character),
      );
      expect(learned).toEqual(classSkills.map(({ wSkillID, bLevel }) => ({ wSkillID, bLevel })));
      const [back] = await exec(tx, `SELECT dwRemainTick FROM ${t.skills} WHERE dwCharID = @charId AND wSkillID = @wSkillID`, {
        charId: character.charId,
        wSkillID: removed.wSkillID,
      });
      expect(back).toEqual({ dwRemainTick: 0 });
      expect(await skillLevel(tx, character.charId, equip.wSkillID)).toEqual([3]);
      expect(await skillLevel(tx, character.charId, NO_CHART_SKILL)).toEqual([4]);
    }));

  it('clears hotkeys of skills no longer learned and keeps item hotkeys', () =>
    withReady(async (ctx) => {
      const { tx, character } = ctx;
      const classSkills = (await startSkillsOf(tx, character.classId)).filter((s) => s.bKind !== 0);
      const toZero = classSkills.find((s) => s.bLevel === 0)!;
      const kept = classSkills.find((s) => s.bLevel > 0)!;
      await setSkill(tx, character.charId, toZero.wSkillID, 5);
      await setSkill(tx, character.charId, kept.wSkillID, 4);
      const slots = Array.from({ length: 12 }, (_, i) => i + 1);
      const values: [number, number][] = [[1, toZero.wSkillID], [2, ITEM_ID], [1, kept.wSkillID], ...slots.slice(3).map((): [number, number] => [0, 0])];
      await exec(
        tx,
        `DELETE FROM ${t.hotkeys} WHERE dwCharID = @charId AND bInvenID = 0;
         INSERT INTO ${t.hotkeys} (dwCharID, bInvenID, ${slots.map((n) => `bType${n}, wID${n}`).join(', ')})
         VALUES (@charId, 0, ${values.map(([type, id]) => `${type}, ${id}`).join(', ')});`,
        ids(character),
      );

      expect(await go(ctx)).toMatchObject({ code: REBIRTH_OK });

      const [row] = await exec<Record<string, number>>(tx, `SELECT * FROM ${t.hotkeys} WHERE dwCharID = @charId AND bInvenID = 0`, ids(character));
      expect(slots.slice(0, 3).map((n) => [row[`bType${n}`], row[`wID${n}`]])).toEqual([
        [0, 0],
        [2, ITEM_ID],
        [1, kept.wSkillID],
      ]);
    }));

  it('deletes quests, quest terms, running buffs and the level freeze', () =>
    withReady(async (ctx) => {
      const { tx, character } = ctx;
      await exec(
        tx,
        `DELETE FROM ${t.quests} WHERE dwCharID = @charId;
         DELETE FROM ${t.questTerms} WHERE dwCharID = @charId;
         DELETE FROM ${t.skillMaintains} WHERE dwCharID = @charId;
         DELETE FROM ${t.levelFreezes} WHERE dwCharID = @charId;
         INSERT INTO ${t.quests} (dwCharID, dwQuestID, dwTick, bCompleteCount, bTriggerCount) VALUES (@charId, 1, 0, 1, 1);
         INSERT INTO ${t.questTerms} (dwCharID, dwQuestID, dwTermID, bTermType, bCount) VALUES (@charId, 1, 1, 0, 1);
         INSERT INTO ${t.skillMaintains} (dwCharID, wSkillID, bLevel, dwRemainTick, bAttackType, dwAttackID, bHostType, dwHostID, bAttackCountry, fPosX, fPosY, fPosZ)
           VALUES (@charId, 300, 1, 60000, 0, @charId, 0, @charId, 0, 0, 0, 0);
         INSERT INTO ${t.levelFreezes} (dwCharID, bFreezeLevel, dUpdate) VALUES (@charId, 50, GETDATE());`,
        ids(character),
      );
      const tables = [t.quests, t.questTerms, t.skillMaintains, t.levelFreezes];
      expect(await countRows(tx, tables, character.charId)).toEqual([1, 1, 1, 1]);

      expect(await go(ctx)).toMatchObject({ code: REBIRTH_OK });

      expect(await countRows(tx, tables, character.charId)).toEqual([0, 0, 0, 0]);
    }));

  it('records the count, the bonus and the log line', () =>
    withReady(async (ctx) => {
      const { tx, character } = ctx;
      const outcome = await go(ctx);
      if (outcome.code !== REBIRTH_OK) throw new Error(`rebirth refused with ${outcome.code}`);

      expect(await rebirthRows(tx, character.charId)).toEqual([{ dwCharID: character.charId, bRebirth: 1, bStatBonus: 2 }]);
      expect(await logRows(tx, character.charId)).toEqual([
        {
          dwID: outcome.id,
          dwUserID: character.userId,
          dwCharID: character.charId,
          szCharName: character.name,
          bRebirth: 1,
          bStatBonus: 2,
          dwPriceGold: 2000,
          szBaseline: BASELINE,
          szText: `${character.name} was reborn (rebirth 1)`,
          bAnnounced: 0,
          dRebirth: expect.any(Date),
        },
      ]);
    }));

  it('charges twice the price for the second rebirth and adds the bonus', () =>
    withReady(
      async (ctx) => {
        const { tx, character } = ctx;
        expect(await go(ctx)).toMatchObject({ code: REBIRTH_OK, rebirth: 1 });
        await setLevel(tx, character.charId, 90);

        expect(await go(ctx, { expectedPriceGold: 4000 })).toEqual({
          code: REBIRTH_OK,
          id: expect.any(Number),
          name: character.name,
          rebirth: 2,
          bonus: 4,
          priceGold: 4000,
          wallet: { gold: 1000, silver: 250, copper: 999 },
        });
        expect(await rebirthRows(tx, character.charId)).toEqual([{ dwCharID: character.charId, bRebirth: 2, bStatBonus: 4 }]);
        expect((await logRows(tx, character.charId)).map((row) => [row.bRebirth, row.bStatBonus, row.dwPriceGold, row.szText])).toEqual([
          [1, 2, 2000, `${character.name} was reborn (rebirth 1)`],
          [2, 4, 4000, `${character.name} was reborn (rebirth 2)`],
        ]);
      },
      { wallet: { gold: 7000, silver: 250, copper: 999 } },
    ));

  it('refuses a second press: the character is level 1 now', () =>
    withReady(async (ctx) => {
      const { tx, character } = ctx;
      expect(await go(ctx)).toMatchObject({ code: REBIRTH_OK });

      expect(await go(ctx)).toEqual({ code: REBIRTH_LOW_LEVEL });
      expect(await walletOf(tx, character.charId)).toEqual({ gold: 3000, silver: 250, copper: 999 });
      expect(await logRows(tx, character.charId)).toHaveLength(1);
    }));

  type Refusal = { options?: ReadyOptions; arrange?: (ctx: Ctx) => Promise<unknown>; input?: (c: Character) => Partial<RebirthInput> };

  it.each<[string, RebirthCode, Refusal]>([
    ['the switch is off', REBIRTH_CLOSED, { options: { settings: { live: 'false' } } }],
    ['the price setting is unreadable', REBIRTH_CLOSED, { options: { settings: { priceGold: 'abc' } } }],
    ['the price is 0', REBIRTH_CLOSED, { options: { settings: { priceGold: '0' } } }],
    ['the limit setting is missing', REBIRTH_CLOSED, { options: { settings: { limit: null } } }],
    ['percent times limit passes 100', REBIRTH_CLOSED, { options: { settings: { percent: '10', limit: '11' } } }],
    ['another account asks', REBIRTH_NOT_YOURS, { input: (c) => ({ userId: c.userId + 1 }) }],
    ['the character is deleted', REBIRTH_NOT_YOURS, { arrange: ({ tx, character }) => exec(tx, `UPDATE ${t.characters} SET bDelete = 1 WHERE dwCharID = @charId`, ids(character)) }],
    ['the character is in the game', REBIRTH_ONLINE, { arrange: ({ tx, character }) => goOnline(tx, character) }],
    ['the character is level 89', REBIRTH_LOW_LEVEL, { arrange: ({ tx, character }) => setLevel(tx, character.charId, 89) }],
    ['something is still worn', REBIRTH_WEARING, { arrange: ({ tx, character }) => wear(tx, character.charId) }],
    [
      'the limit is reached',
      REBIRTH_AT_LIMIT,
      { arrange: ({ tx, character }) => exec(tx, `INSERT INTO ${t.rebirths} (dwCharID, bRebirth, bStatBonus) VALUES (@charId, 10, 20)`, ids(character)) },
    ],
    ['the price shown is not the price now', REBIRTH_PRICE_CHANGED, { options: { settings: { priceGold: '2500' } } }],
    ['the wallet is 1 Bronze short', REBIRTH_POOR, { options: { wallet: { gold: 1999, silver: 999, copper: 999 } } }],
  ])('refuses when %s and writes nothing', (_, code, { options, arrange, input }) =>
    withReady(async (ctx) => {
      const { tx, character } = ctx;
      await arrange?.(ctx);
      const before = await snapshot(tx, character);

      expect(await go(ctx, input?.(character))).toEqual({ code });

      expect(await snapshot(tx, character)).toEqual(before);
      expect(before.log).toEqual([]);
    }, options),
  );

  it('reports the first failing check when several fail', () =>
    withReady(async (ctx) => {
      const { tx, character } = ctx;
      await goOnline(tx, character);
      await setLevel(tx, character.charId, 89);
      await wear(tx, character.charId);
      const before = await snapshot(tx, character);

      expect(await go(ctx)).toEqual({ code: REBIRTH_ONLINE });
      expect(await snapshot(tx, character)).toEqual(before);
    }));

  it('finds the character with its rebirth facts', () =>
    withReady(async ({ repo, tx, character }) => {
      expect(await repo.find(character.userId, character.charId)).toEqual({
        name: character.name,
        level: 90,
        online: false,
        wornItems: 0,
        rebirths: 0,
        bonus: 0,
        ...START,
      });

      await goOnline(tx, character);
      await wear(tx, character.charId);
      await exec(tx, `INSERT INTO ${t.rebirths} (dwCharID, bRebirth, bStatBonus) VALUES (@charId, 3, 6)`, ids(character));
      expect(await repo.find(character.userId, character.charId)).toMatchObject({ online: true, wornItems: 1, rebirths: 3, bonus: 6 });
    }));

  it("finds nothing through another account's ID", () =>
    withReady(async ({ repo, tx, character }) => {
      expect(await repo.find(character.userId + 1, character.charId)).toBeNull();

      await exec(tx, `UPDATE ${t.characters} SET bDelete = 1 WHERE dwCharID = @charId`, ids(character));
      expect(await repo.find(character.userId, character.charId)).toBeNull();
    }));

  const NONE: Settings = { live: null, priceGold: null, percent: null, limit: null };
  const STARTING = { live: false, priceGold: 0, percent: 2, limit: 10 };

  const logRow = (tx: sql.Transaction, c: Character, rebirth: number) =>
    exec<{ id: number }>(
      tx,
      `INSERT INTO ${t.rebirthLog} (dwUserID, dwCharID, szCharName, bRebirth, bStatBonus, dwPriceGold, szBaseline, szText)
       OUTPUT INSERTED.dwID AS id VALUES (@userId, @charId, @name, @rebirth, @rebirth * 2, 100, '{}', 'text')`,
      { ...ids(c), name: c.name, rebirth },
    ).then((rows) => rows[0].id);

  it('is closed with the starting numbers when no setting rows exist', () =>
    withReady(async ({ repo }) => {
      expect(await repo.settings()).toEqual(STARTING);
    }, { settings: NONE }));

  it.each(['abc', '-5', '', '2.5'])('falls back to the starting numbers when a row holds %j', (value) =>
    withReady(async ({ repo }) => {
      expect(await repo.settings()).toEqual(STARTING);
    }, { settings: { percent: value } }));

  it('falls back to the starting numbers when the rows break the rules together', () =>
    withReady(async ({ repo }) => {
      expect(await repo.settings()).toEqual(STARTING);
    }, { settings: { percent: '10', limit: '20' } }));

  it('saves and reads the settings back', () =>
    withReady(async ({ repo }) => {
      expect(await repo.settings()).toEqual({ live: true, priceGold: 2000, percent: 2, limit: 10 });
      await repo.saveSettings({ live: false, priceGold: 50, percent: 4, limit: 7 }, 'gm');
      expect(await repo.settings()).toEqual({ live: false, priceGold: 50, percent: 4, limit: 7 });
    }));

  it('saves into an empty table', () =>
    withReady(async ({ repo }) => {
      await repo.saveSettings({ live: true, priceGold: 9, percent: 1, limit: 1 }, 'gm');
      expect(await repo.settings()).toEqual({ live: true, priceGold: 9, percent: 1, limit: 1 });
    }, { settings: NONE }));

  it('recalculates every bonus when the percent or the limit changes', () =>
    withReady(async ({ repo, tx, character }) => {
      const [other] = await exec<{ charId: number }>(tx, `SELECT TOP 1 dwCharID AS charId FROM ${t.characters} WHERE dwCharID <> @charId`, ids(character));
      await exec(tx, `DELETE FROM ${t.rebirths} WHERE dwCharID = @other`, { other: other.charId });
      await exec(tx, `INSERT INTO ${t.rebirths} (dwCharID, bRebirth, bStatBonus) VALUES (@charId, 3, 6), (@other, 12, 20)`, {
        charId: character.charId,
        other: other.charId,
      });

      await repo.saveSettings({ live: true, priceGold: 2000, percent: 3, limit: 5 }, 'gm');

      const bonus = async (charId: number) =>
        (await exec<{ b: number }>(tx, `SELECT bStatBonus AS b FROM ${t.rebirths} WHERE dwCharID = @charId`, { charId }))[0].b;
      expect(await bonus(character.charId)).toBe(9);
      expect(await bonus(other.charId)).toBe(15);
    }));

  it('lists the newest rebirths first', () =>
    withReady(async ({ repo, tx, character }) => {
      const first = await logRow(tx, character, 1);
      const second = await logRow(tx, character, 2);
      const rows = (await repo.recent(100)).filter((row) => row.charId === character.charId);
      expect(rows.map((row) => row.id)).toEqual([second, first]);
      expect(rows[0]).toMatchObject({ userId: character.userId, name: character.name, rebirth: 2, bonus: 4, priceGold: 100, text: 'text', announced: 0 });
      expect(rows[0].at).toBeInstanceOf(Date);
      expect(rows[0].ageSeconds).toBeGreaterThanOrEqual(0);
      expect(await repo.recent(1)).toHaveLength(1);
    }));

  it('counts the characters that have a rebirth row', () =>
    withReady(async ({ repo, tx, character }) => {
      await exec(tx, `DELETE FROM ${t.rebirths}`);
      expect(await repo.count()).toBe(0);
      await exec(tx, `INSERT INTO ${t.rebirths} (dwCharID, bRebirth, bStatBonus) VALUES (@charId, 1, 2)`, ids(character));
      expect(await repo.count()).toBe(1);
    }));

  it('lets only one caller claim an announcement', () =>
    withReady(async ({ repo, tx, character }) => {
      const id = await logRow(tx, character, 1);
      expect((await repo.waitingAnnouncements()).map((row) => row.id)).toContain(id);

      expect(await repo.claimAnnouncement(id)).toBe(true);
      expect(await repo.claimAnnouncement(id)).toBe(false);
      expect((await repo.waitingAnnouncements()).map((row) => row.id)).not.toContain(id);

      await repo.markAnnounced(id, ANNOUNCE_WAITING);
      expect(await repo.claimAnnouncement(id)).toBe(true);
      await repo.markAnnounced(id, ANNOUNCE_SKIPPED);
      expect((await repo.recent(100)).find((row) => row.id === id)?.announced).toBe(ANNOUNCE_SKIPPED);
    }));
});
