import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REBIRTH_DEFAULT_SETTINGS, type RebirthSettings, type Wallet } from '@4story-portal/shared';
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
  REWARD_SENDER,
  START_SKILL_POINTS,
} from '../../src/rebirth/rebirth-sql.js';
import {
  ANNOUNCE_SKIPPED,
  ANNOUNCE_WAITING,
  type RebirthInput,
  type RebirthRewardRow,
  SqlRebirthRepository,
} from '../../src/rebirth/rebirth.repository.js';
import { connectTestDb, inRolledBackTransaction } from './db-test-helpers.js';

// The letter procedure and its notify table are created inside each test's transaction, as the mail tests do.
const setupSql = ['TPORTALSETTING.sql', 'TPORTALREBIRTHREWARD.sql', 'TPORTALPOSTNOTIFY.sql', 'TPortalGmPost.sql'].map((file) => readFileSync(path.resolve(process.cwd(), 'sql', file), 'utf8'));

type Character = { charId: number; userId: number; name: string; classId: number; raceId: number; country: number };
/** The six setting rows as stored; null leaves the row out. */
type Settings = Record<keyof RebirthSettings, string | null>;
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
   * offline, and rebirth open at price 2000, 2 percent, limit 10, 10 percent EXP and 5 percent gold, with no rewards saved.
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
       DELETE FROM ${t.tempItems} WHERE dwOwnerID = @charId AND bOwnerType = 0 AND bStorageType = 0 AND dwStorageID = 254;
       DELETE FROM ${t.rebirths} WHERE dwCharID = @charId;
       DELETE FROM ${t.rebirthLog} WHERE dwCharID = @charId;
       DELETE FROM ${t.currentUsers} WHERE dwUserID = @userId OR dwCharID = @charId;
       DELETE FROM ${t.portalSettings} WHERE szKey LIKE 'rebirth[_]%';
       DELETE FROM ${t.rebirthRewards};`,
      { ...ids(character), ...wallet },
    );
    const settings: Settings = { live: 'true', priceGold: '2000', percent: '2', limit: '10', expPercent: '10', goldPercent: '5', ...options.settings };
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

  /** Puts a copy of some item in the character's equipment bag, in TITEMTABLE or in its twin TTEMPITEMTABLE. */
  const wear = (tx: sql.Transaction, charId: number, table = t.characterItems) =>
    exec(
      tx,
      `SELECT TOP 1 * INTO #worn FROM ${table} ORDER BY dlID;
       UPDATE #worn SET dlID = (SELECT MAX(dlID) + 1 FROM ${table}), bStorageType = 0, dwStorageID = 254,
                        bOwnerType = 0, dwOwnerID = @charId, bItemID = 0;
       INSERT INTO ${table} SELECT * FROM #worn;
       DROP TABLE #worn;`,
      { charId },
    );

  const tempSkillRows = (tx: sql.Transaction, table: string, charId: number) =>
    exec(tx, `SELECT dwCharID, wSkillID, bLevel, dwRemainTick FROM ${table} WHERE dwCharID = @charId ORDER BY wSkillID`, { charId });

  const wornIn = async (tx: sql.Transaction, table: string, charId: number) =>
    (
      await exec<{ n: number }>(
        tx,
        `SELECT COUNT(*) AS n FROM ${table} WHERE dwOwnerID = @charId AND bOwnerType = 0 AND bStorageType = 0 AND dwStorageID = 254`,
        { charId },
      )
    )[0].n;

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
    exec(tx, `SELECT dwCharID, bRebirth, bStatBonus, bExpBonus, bGoldBonus FROM ${t.rebirths} WHERE dwCharID = @charId`, { charId });

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
    tempSkills: await tempSkillRows(tx, t.tempSkills, c.charId),
    hotkeys: await exec(tx, `SELECT * FROM ${t.hotkeys} WHERE dwCharID = @charId ORDER BY bInvenID`, ids(c)),
    counts: await countRows(tx, [t.skillMaintains, t.tempSkillMaintains, t.quests, t.questTerms, t.levelFreezes], c.charId),
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
      expect(outcome).toEqual({
        code: REBIRTH_OK,
        id: expect.any(Number),
        name: character.name,
        rebirth: 1,
        bonuses: { stats: 2, exp: 10, gold: 5 },
        priceGold: 2000,
        wallet,
        postId: 0,
      });

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

  // TLogout copies TTEMPSKILLTABLE over TSKILLTABLE at every logout, so the twin must hold the new life's skills.
  it('leaves the twin skill table equal to the skill table', () =>
    withReady(async (ctx) => {
      const { tx, character } = ctx;
      const [raised] = (await startSkillsOf(tx, character.classId)).filter((s) => s.bKind !== 0);
      const [extra] = await exec<{ wSkillID: number }>(
        tx,
        `SELECT TOP 1 c.wID AS wSkillID FROM ${t.skillChart} c
         WHERE c.bKind <> 0 AND NOT EXISTS (SELECT 1 FROM ${t.startSkills} st WHERE st.bClassID = @classId AND st.wSkillID = c.wID)
         ORDER BY c.wID`,
        { classId: character.classId },
      );
      await exec(
        tx,
        `DELETE FROM ${t.tempSkills} WHERE dwCharID = @charId;
         INSERT INTO ${t.tempSkills} (dwCharID, wSkillID, bLevel, dwRemainTick)
         SELECT dwCharID, wSkillID, bLevel, dwRemainTick FROM ${t.skills} WHERE dwCharID = @charId;
         DELETE FROM ${t.tempSkills} WHERE dwCharID = @charId AND wSkillID IN (@raised, @extra);
         INSERT INTO ${t.tempSkills} (dwCharID, wSkillID, bLevel, dwRemainTick) VALUES (@charId, @raised, 9, 0), (@charId, @extra, 7, 0);`,
        { charId: character.charId, raised: raised.wSkillID, extra: extra.wSkillID },
      );
      expect(await tempSkillRows(tx, t.tempSkills, character.charId)).not.toEqual(await tempSkillRows(tx, t.skills, character.charId));

      expect(await go(ctx)).toMatchObject({ code: REBIRTH_OK });

      const skills = await tempSkillRows(tx, t.skills, character.charId);
      expect(skills.length).toBeGreaterThan(0);
      expect(await tempSkillRows(tx, t.tempSkills, character.charId)).toEqual(skills);
    }));

  it('deletes the running buffs in the twin buff table too', () =>
    withReady(async (ctx) => {
      const { tx, character } = ctx;
      await exec(
        tx,
        `DELETE FROM ${t.tempSkillMaintains} WHERE dwCharID = @charId;
         INSERT INTO ${t.tempSkillMaintains} (dwCharID, wSkillID, bLevel, dwRemainTick, bAttackType, dwAttackID, bHostType, dwHostID, bAttackCountry, fPosX, fPosY, fPosZ)
           VALUES (@charId, 300, 1, 60000, 0, @charId, 0, @charId, 0, 0, 0, 0);`,
        ids(character),
      );
      expect(await countRows(tx, [t.tempSkillMaintains], character.charId)).toEqual([1]);

      expect(await go(ctx)).toMatchObject({ code: REBIRTH_OK });

      expect(await countRows(tx, [t.tempSkillMaintains], character.charId)).toEqual([0]);
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

      expect(await rebirthRows(tx, character.charId)).toEqual([{ dwCharID: character.charId, bRebirth: 1, bStatBonus: 2, bExpBonus: 10, bGoldBonus: 5 }]);
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
          dwPostID: 0,
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
          bonuses: { stats: 4, exp: 20, gold: 10 },
          priceGold: 4000,
          wallet: { gold: 1000, silver: 250, copper: 999 },
          postId: 0,
        });
        expect(await rebirthRows(tx, character.charId)).toEqual([{ dwCharID: character.charId, bRebirth: 2, bStatBonus: 4, bExpBonus: 20, bGoldBonus: 10 }]);
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
    // TLogout leaves the online list before it copies TTEMPITEMTABLE over TITEMTABLE.
    ['something is worn only in the twin item table', REBIRTH_WEARING, { arrange: ({ tx, character }) => wear(tx, character.charId, t.tempItems) }],
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
        statBonus: 0,
        expBonus: 0,
        goldBonus: 0,
        ...START,
      });

      await goOnline(tx, character);
      await wear(tx, character.charId);
      await exec(tx, `INSERT INTO ${t.rebirths} (dwCharID, bRebirth, bStatBonus) VALUES (@charId, 3, 6)`, ids(character));
      expect(await repo.find(character.userId, character.charId)).toMatchObject({ online: true, wornItems: 1, rebirths: 3, statBonus: 6 });
    }));

  it('counts an item worn only in the twin item table', () =>
    withReady(async ({ repo, tx, character }) => {
      await wear(tx, character.charId, t.tempItems);
      expect([await wornIn(tx, t.characterItems, character.charId), await wornIn(tx, t.tempItems, character.charId)]).toEqual([0, 1]);

      expect(await repo.find(character.userId, character.charId)).toMatchObject({ wornItems: 1 });
    }));

  it('counts an item that is in both item tables once', () =>
    withReady(async ({ repo, tx, character }) => {
      await wear(tx, character.charId);
      await exec(
        tx,
        `INSERT INTO ${t.tempItems} SELECT * FROM ${t.characterItems}
         WHERE dwOwnerID = @charId AND bOwnerType = 0 AND bStorageType = 0 AND dwStorageID = 254`,
        ids(character),
      );
      expect([await wornIn(tx, t.characterItems, character.charId), await wornIn(tx, t.tempItems, character.charId)]).toEqual([1, 1]);

      expect(await repo.find(character.userId, character.charId)).toMatchObject({ wornItems: 1 });
    }));

  it("finds nothing through another account's ID", () =>
    withReady(async ({ repo, tx, character }) => {
      expect(await repo.find(character.userId + 1, character.charId)).toBeNull();

      await exec(tx, `UPDATE ${t.characters} SET bDelete = 1 WHERE dwCharID = @charId`, ids(character));
      expect(await repo.find(character.userId, character.charId)).toBeNull();
    }));

  const NONE: Settings = { live: null, priceGold: null, percent: null, limit: null, expPercent: null, goldPercent: null };
  const STARTING = REBIRTH_DEFAULT_SETTINGS;

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
      expect(await repo.settings()).toEqual({ live: true, priceGold: 2000, percent: 2, limit: 10, expPercent: 10, goldPercent: 5 });
      await repo.saveSettings({ live: false, priceGold: 50, percent: 4, limit: 7, expPercent: 25, goldPercent: 0 }, 'gm');
      expect(await repo.settings()).toEqual({ live: false, priceGold: 50, percent: 4, limit: 7, expPercent: 25, goldPercent: 0 });
    }));

  it('saves into an empty table', () =>
    withReady(async ({ repo }) => {
      await repo.saveSettings({ live: true, priceGold: 9, percent: 1, limit: 1, expPercent: 3, goldPercent: 4 }, 'gm');
      expect(await repo.settings()).toEqual({ live: true, priceGold: 9, percent: 1, limit: 1, expPercent: 3, goldPercent: 4 });
    }, { settings: NONE }));

  it('recalculates every bonus when the percent or the limit changes', () =>
    withReady(async ({ repo, tx, character }) => {
      const [other] = await exec<{ charId: number }>(tx, `SELECT TOP 1 dwCharID AS charId FROM ${t.characters} WHERE dwCharID <> @charId`, ids(character));
      await exec(tx, `DELETE FROM ${t.rebirths} WHERE dwCharID = @other`, { other: other.charId });
      await exec(tx, `INSERT INTO ${t.rebirths} (dwCharID, bRebirth, bStatBonus) VALUES (@charId, 3, 6), (@other, 12, 20)`, {
        charId: character.charId,
        other: other.charId,
      });

      await repo.saveSettings({ live: true, priceGold: 2000, percent: 3, limit: 5, expPercent: 0, goldPercent: 0 }, 'gm');

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

  describe('EXP and gold bonuses', () => {
    it('stores the EXP and gold bonuses with the stat bonus', () =>
      withReady(async (ctx) => {
        const outcome = await go(ctx);

        expect(outcome).toMatchObject({ code: REBIRTH_OK, bonuses: { stats: 2, exp: 10, gold: 5 } });
        expect(await rebirthRows(ctx.tx, ctx.character.charId)).toEqual([
          { dwCharID: ctx.character.charId, bRebirth: 1, bStatBonus: 2, bExpBonus: 10, bGoldBonus: 5 },
        ]);
      }));

    it('reads missing EXP and gold settings as 0', () =>
      withReady(
        async (ctx) => {
          expect(await ctx.repo.settings()).toEqual({ live: true, priceGold: 2000, percent: 2, limit: 10, expPercent: 0, goldPercent: 0 });

          expect(await go(ctx)).toMatchObject({ code: REBIRTH_OK, bonuses: { stats: 2, exp: 0, gold: 0 } });
          expect(await rebirthRows(ctx.tx, ctx.character.charId)).toEqual([
            { dwCharID: ctx.character.charId, bRebirth: 1, bStatBonus: 2, bExpBonus: 0, bGoldBonus: 0 },
          ]);
        },
        { settings: { expPercent: null, goldPercent: null } },
      ));

    it.each<[string, Partial<Settings>]>([
      ['EXP is text', { expPercent: 'x' }],
      ['EXP is empty', { expPercent: '' }],
      ['EXP is 26', { expPercent: '26' }],
      ['EXP is -1', { expPercent: '-1' }],
      ['EXP 13 with limit 20 passes 250', { expPercent: '13', limit: '20' }],
      ['gold is text', { goldPercent: 'x' }],
      ['gold is 26', { goldPercent: '26' }],
      ['gold 13 with limit 20 passes 250', { goldPercent: '13', limit: '20' }],
    ])('refuses with closed when an EXP or gold setting is unreadable: %s', (_, settings) =>
      withReady(
        async (ctx) => {
          const before = await snapshot(ctx.tx, ctx.character);

          expect(await go(ctx)).toEqual({ code: REBIRTH_CLOSED });

          expect(await snapshot(ctx.tx, ctx.character)).toEqual(before);
          expect(await letters(ctx.tx, ctx.character.charId)).toEqual([]);
          expect(await ctx.repo.settings()).toEqual(STARTING);
        },
        { settings },
      ),
    );

    it('allows EXP and gold at 25 percent with limit 10, 250 in all', () =>
      withReady(
        async (ctx) => {
          expect(await go(ctx)).toMatchObject({ code: REBIRTH_OK, bonuses: { stats: 2, exp: 25, gold: 25 } });
        },
        { settings: { expPercent: '25', goldPercent: '25' } },
      ));

    it('recalculates every bonus when the settings are saved', () =>
      withReady(async ({ repo, tx, character }) => {
        await exec(tx, `INSERT INTO ${t.rebirths} (dwCharID, bRebirth, bStatBonus) VALUES (@charId, 3, 6)`, ids(character));

        await repo.saveSettings({ live: true, priceGold: 2000, percent: 3, limit: 2, expPercent: 10, goldPercent: 4 }, 'gm');

        expect(await rebirthRows(tx, character.charId)).toEqual([
          { dwCharID: character.charId, bRebirth: 3, bStatBonus: 6, bExpBonus: 20, bGoldBonus: 8 },
        ]);
      }));

    it('finds the character with all three bonuses', () =>
      withReady(async ({ repo, tx, character }) => {
        await exec(
          tx,
          `INSERT INTO ${t.rebirths} (dwCharID, bRebirth, bStatBonus, bExpBonus, bGoldBonus) VALUES (@charId, 3, 6, 30, 15)`,
          ids(character),
        );

        expect(await repo.find(character.userId, character.charId)).toMatchObject({ rebirths: 3, statBonus: 6, expBonus: 30, goldBonus: 15 });
      }));
  });

  type Letter = {
    dwPostID: number;
    dwCharID: number;
    szSender: string;
    szTitle: string;
    szMessage: string;
    bType: number;
    dwGold: number;
    dwSilver: number;
    dwCooper: number;
  };

  /** The character's letters from the rebirth sender, title and message without the game's 8 hex digit length prefix. */
  async function letters(tx: sql.Transaction, charId: number): Promise<Letter[]> {
    const rows = await exec<Letter>(
      tx,
      `SELECT dwPostID, dwCharID, szSender, szTitle, szMessage, bType, dwGold, dwSilver, dwCooper
       FROM [${gameName}].dbo.TPOSTTABLE WHERE dwCharID = @charId AND szSender = 'Rebirth' ORDER BY dwPostID`,
      { charId },
    );
    return rows.map((row) => ({ ...row, szTitle: row.szTitle.slice(8), szMessage: row.szMessage.slice(8) }));
  }

  /** The items attached to a letter, in the order they were written. */
  const letterItems = (tx: sql.Transaction, postId: number) =>
    exec(
      tx,
      `SELECT bOwnerType, dwOwnerID, wItemID, bCount FROM ${t.characterItems} WHERE bStorageType = 2 AND dwStorageID = @postId ORDER BY dlID`,
      { postId },
    );

  const postIdsInLog = async (tx: sql.Transaction, charId: number) => (await logRows(tx, charId)).map((row) => [row.bRebirth, row.dwPostID]);

  /** Two item IDs from the item chart that fit a reward's SMALLINT. */
  const twoItems = async (tx: sql.Transaction): Promise<[number, number]> => {
    const rows = await exec<{ itemId: number }>(tx, `SELECT TOP 2 wItemID AS itemId FROM ${t.items} WHERE wItemID BETWEEN 1 AND 32767 ORDER BY wItemID`);
    return [rows[0].itemId, rows[1].itemId];
  };

  type Money = Partial<Pick<RebirthRewardRow, 'gold' | 'silver' | 'copper'>>;
  const reward = (rebirth: number, money: Money, items: RebirthRewardRow['items'] = []): RebirthRewardRow => ({
    rebirth,
    gold: 0,
    silver: 0,
    copper: 0,
    ...money,
    items,
  });

  const letter = (charId: number, rebirth: number, money: Partial<Pick<Letter, 'dwGold' | 'dwSilver' | 'dwCooper'>>): Letter => ({
    dwPostID: expect.any(Number),
    dwCharID: charId,
    szSender: 'Rebirth',
    szTitle: `Rebirth ${rebirth} reward`,
    szMessage: `You were reborn. Your reward for rebirth ${rebirth} is attached.`,
    bType: 6,
    dwGold: 0,
    dwSilver: 0,
    dwCooper: 0,
    ...money,
  });

  describe('rewards', () => {
    it('names the sender Rebirth', () => {
      expect(REWARD_SENDER).toBe('Rebirth');
    });

    it('mails the reward for that rebirth number', () =>
      withReady(async (ctx) => {
        const { repo, tx, character } = ctx;
        const [a, b] = await twoItems(tx);
        await repo.setReward(reward(1, { gold: 2 }, [{ itemId: a, count: 3 }, { itemId: b, count: 1 }]), 'gm');

        const outcome = await go(ctx);

        const sent = await letters(tx, character.charId);
        expect(sent).toEqual([letter(character.charId, 1, { dwGold: 2 })]);
        const postId = sent[0].dwPostID;
        expect(await letterItems(tx, postId)).toEqual([
          { bOwnerType: 0, dwOwnerID: character.charId, wItemID: a, bCount: 3 },
          { bOwnerType: 0, dwOwnerID: character.charId, wItemID: b, bCount: 1 },
        ]);
        expect(await postIdsInLog(tx, character.charId)).toEqual([[1, postId]]);
        expect(outcome).toMatchObject({ code: REBIRTH_OK, rebirth: 1, postId });
      }));

    type OneKind = [string, (item: number) => RebirthRewardRow, Partial<Letter>, (item: number) => { wItemID: number; bCount: number }[]];
    it.each<OneKind>([
      ['money only', () => reward(1, { gold: 1, silver: 20, copper: 300 }), { dwGold: 1, dwSilver: 20, dwCooper: 300 }, () => []],
      ['items only', (item) => reward(1, {}, [{ itemId: item, count: 2 }]), {}, (item) => [{ wItemID: item, bCount: 2 }]],
    ])('mails %s', (_, saved, money, items) =>
      withReady(async (ctx) => {
        const { repo, tx, character } = ctx;
        const [item] = await twoItems(tx);
        await repo.setReward(saved(item), 'gm');

        const outcome = await go(ctx);

        const sent = await letters(tx, character.charId);
        expect(sent).toEqual([letter(character.charId, 1, money)]);
        expect((await letterItems(tx, sent[0].dwPostID)).map(({ wItemID, bCount }) => ({ wItemID, bCount }))).toEqual(items(item));
        expect(outcome).toMatchObject({ code: REBIRTH_OK, postId: sent[0].dwPostID });
      }),
    );

    it('sends nothing for a rebirth number without a reward', () =>
      withReady(async (ctx) => {
        const { repo, tx, character } = ctx;
        await repo.setReward(reward(2, { gold: 5 }), 'gm');

        expect(await go(ctx)).toMatchObject({ code: REBIRTH_OK, rebirth: 1, postId: 0 });

        expect(await letters(tx, character.charId)).toEqual([]);
        expect(await postIdsInLog(tx, character.charId)).toEqual([[1, 0]]);
      }));

    it('sends the reward of the second rebirth on the second rebirth', () =>
      withReady(
        async (ctx) => {
          const { repo, tx, character } = ctx;
          await repo.setReward(reward(1, { gold: 1 }), 'gm');
          await repo.setReward(reward(2, { gold: 7 }), 'gm');
          const first = await go(ctx);
          await setLevel(tx, character.charId, 90);

          const second = await go(ctx, { expectedPriceGold: 4000 });

          const sent = await letters(tx, character.charId);
          expect(sent).toEqual([letter(character.charId, 1, { dwGold: 1 }), letter(character.charId, 2, { dwGold: 7 })]);
          expect(first).toMatchObject({ code: REBIRTH_OK, rebirth: 1, postId: sent[0].dwPostID });
          expect(second).toMatchObject({ code: REBIRTH_OK, rebirth: 2, postId: sent[1].dwPostID });
          expect(await postIdsInLog(tx, character.charId)).toEqual([
            [1, sent[0].dwPostID],
            [2, sent[1].dwPostID],
          ]);
        },
        { wallet: { gold: 7000, silver: 250, copper: 999 } },
      ));

    // TPortalGmPost returns 0 when it writes nothing. The batch throws, and XACT_ABORT takes the whole
    // transaction with it, the caller's too, so mssql reports it aborted.
    it('fails the whole rebirth when the letter is not written', async () => {
      const tx = new sql.Transaction(db.pool);
      await tx.begin();
      let failure: unknown;
      let rollback: unknown;
      try {
        const character = await ready(tx);
        const repo = new SqlRebirthRepository(db).withTransaction(tx);
        await repo.setReward(reward(1, { gold: 2 }), 'gm');
        const stub = `CREATE OR ALTER PROCEDURE dbo.TPortalGmPost
          @pCharID INT, @pSender VARCHAR(50), @pTitle VARCHAR(240), @pMessage VARCHAR(2000), @dwGold INT, @dwSilver INT, @dwCooper INT,
          @wItemID1 SMALLINT, @bCount1 TINYINT, @wItemID2 SMALLINT, @bCount2 TINYINT, @wItemID3 SMALLINT, @bCount3 TINYINT
          AS RETURN 0`;
        await new sql.Request(tx).input('sql', sql.NVarChar(sql.MAX), stub).query(`EXEC [${gameName}].sys.sp_executesql @sql`);

        failure = await go({ repo, tx, character }).then(
          (outcome) => outcome,
          (error: unknown) => error,
        );
      } finally {
        rollback = await tx.rollback().then(
          () => 'rolled back by the test',
          (error: unknown) => error,
        );
      }

      expect(failure).toMatchObject({ message: 'Rebirth reward letter not sent' });
      expect(rollback).toMatchObject({ code: 'EABORT' });
    });

    it('never sends a reward saved above the limit', () =>
      withReady(
        async (ctx) => {
          const { repo, tx, character } = ctx;
          await repo.setReward(reward(2, { gold: 5 }), 'gm');
          await exec(tx, `INSERT INTO ${t.rebirths} (dwCharID, bRebirth, bStatBonus) VALUES (@charId, 1, 2)`, ids(character));

          expect(await go(ctx, { expectedPriceGold: 4000 })).toEqual({ code: REBIRTH_AT_LIMIT });

          expect(await letters(tx, character.charId)).toEqual([]);
          expect(await logRows(tx, character.charId)).toEqual([]);
        },
        { settings: { limit: '1' } },
      ));

    it('lists every saved reward by rebirth number', () =>
      withReady(async ({ repo, tx }) => {
        const [a, b] = await twoItems(tx);
        await repo.setReward(reward(3, { copper: 9 }, [{ itemId: b, count: 4 }]), 'gm');
        await repo.setReward(reward(1, { gold: 2, silver: 3 }, [{ itemId: a, count: 1 }, { itemId: b, count: 2 }]), 'gm');

        expect(await repo.rewards()).toEqual([
          reward(1, { gold: 2, silver: 3 }, [{ itemId: a, count: 1 }, { itemId: b, count: 2 }]),
          reward(3, { copper: 9 }, [{ itemId: b, count: 4 }]),
        ]);
        const [row] = await exec(tx, `SELECT szUpdatedBy, wItemID3, bCount3 FROM ${t.rebirthRewards} WHERE bRebirth = 1`);
        expect(row).toEqual({ szUpdatedBy: 'gm', wItemID3: 0, bCount3: 0 });
      }));

    it('replaces a saved reward', () =>
      withReady(async ({ repo }) => {
        await repo.setReward(reward(2, { gold: 5 }), 'gm');
        await repo.setReward(reward(2, { silver: 6 }), 'other');

        expect(await repo.rewards()).toEqual([reward(2, { silver: 6 })]);
      }));

    it('keeps a reward above a lowered limit', () =>
      withReady(async ({ repo }) => {
        await repo.setReward(reward(5, { gold: 3 }), 'gm');

        await repo.saveSettings({ live: true, priceGold: 2000, percent: 2, limit: 3, expPercent: 10, goldPercent: 5 }, 'gm');

        expect(await repo.rewards()).toEqual([reward(5, { gold: 3 })]);
      }));

    it('deletes a reward saved empty', () =>
      withReady(async ({ repo }) => {
        await repo.setReward(reward(4, { gold: 3 }), 'gm');
        await repo.setReward(reward(5, { gold: 1 }), 'gm');

        await repo.setReward(reward(4, {}), 'gm');

        expect(await repo.rewards()).toEqual([reward(5, { gold: 1 })]);
      }));

    it('finds reward items by ID with their names and stack sizes', () =>
      withReady(async ({ repo, tx }) => {
        const [a, b] = await twoItems(tx);
        const chart = await exec<{ itemId: number; name: string; stack: number }>(
          tx,
          `SELECT wItemID AS itemId, CASE WHEN szNAME = '_' THEN '' ELSE szNAME END AS name, bStack AS stack FROM ${t.items} WHERE wItemID IN (@a, @b)`,
          { a, b },
        );
        const [{ missing }] = await exec<{ missing: number }>(tx, `SELECT MAX(wItemID) + 1 AS missing FROM ${t.items}`);
        const byId = (x: { itemId: number }, y: { itemId: number }) => x.itemId - y.itemId;

        const found = await repo.findItems([a, b, missing]);

        expect([...found].sort(byId)).toEqual([...chart].sort(byId));
        expect(found).toHaveLength(2);
        expect(await repo.findItems([])).toEqual([]);
      }));
  });
});
