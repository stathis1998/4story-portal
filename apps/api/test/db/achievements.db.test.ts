import { readFileSync } from 'node:fs';
import path from 'node:path';
import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ANNOUNCE_SENT,
  ANNOUNCE_SKIPPED,
  ANNOUNCE_WAITING,
  AWARD_ALREADY_GIVEN,
  AWARD_NO_CHARACTER,
  AWARD_SWITCHED_OFF,
  type AwardInput,
  type RewardRow,
  SqlAchievementsRepository,
} from '../../src/achievements/achievements.repository.js';
import { loadConfig } from '../../src/config/config.js';
import type { DbService } from '../../src/db/db.service.js';
import { connectTestDb, inRolledBackTransaction } from './db-test-helpers.js';

// Run in this order inside each test's transaction: the tables, then the procedures that use them.
const setupSql = [
  'TPORTALPOSTNOTIFY.sql',
  'TPortalGmPost.sql',
  'TPORTALACHIEVEMENTTABLE.sql',
  'TPORTALACHIEVEMENTREWARD.sql',
  'TPORTALSETTING.sql',
  'TPortalAchievementAward.sql',
].map((file) => readFileSync(path.resolve(process.cwd(), 'sql', file), 'utf8'));

type PostRow = { dwCharID: number; szSender: string; szTitle: string; szMessage: string; bType: number; dwGold: number; dwSilver: number; dwCooper: number };

describe('SqlAchievementsRepository against the _TEST copy', () => {
  let db: DbService;
  let gameName: string;
  let character: { charId: number; userId: number; name: string };
  let stackable: { itemId: number; stack: number };

  beforeAll(async () => {
    db = await connectTestDb();
    gameName = loadConfig(process.env).db.gameName;
    const chars = await db.pool
      .request()
      .query<{ charId: number; userId: number; name: string }>(
        `SELECT TOP 1 dwCharID AS charId, dwUserID AS userId, szName AS name FROM ${db.tables.characters} WHERE bDelete = 0 ORDER BY dwCharID`,
      );
    character = chars.recordset[0];
    const stacks = await db.pool
      .request()
      .query<{ itemId: number; stack: number }>(
        `SELECT TOP 1 wItemID AS itemId, bStack AS stack FROM ${db.tables.items} WHERE bStack >= 20 ORDER BY wItemID`,
      );
    stackable = stacks.recordset[0];
  });

  afterAll(() => db.onModuleDestroy());

  const input = (overrides: Partial<AwardInput> = {}): AwardInput => ({
    userId: character.userId,
    charId: character.charId,
    rebirth: 0,
    achievementId: 'kills',
    level: 2,
    sender: 'Achievements',
    title: 'Achievement: Slayer II',
    message: 'You completed Slayer II: Defeat 10,000 monsters.',
    rewardNote: ' Your reward is attached.',
    text: `${character.name} completed Slayer II: Defeat 10,000 monsters`,
    ...overrides,
  });

  const reward = (overrides: Partial<RewardRow> = {}): RewardRow => ({
    achievementId: 'kills',
    level: 2,
    gold: 12,
    silver: 340,
    copper: 5,
    items: [{ itemId: stackable.itemId, count: 3 }],
    ...overrides,
  });

  /** Creates the tables and procedures inside tx, so the rollback removes them again. */
  async function withRepo(fn: (repo: SqlAchievementsRepository, tx: sql.Transaction) => Promise<void>) {
    await inRolledBackTransaction(db, async (tx) => {
      for (const batch of setupSql) {
        await new sql.Request(tx).input('sql', sql.NVarChar(sql.MAX), batch).query(`EXEC [${gameName}].sys.sp_executesql @sql`);
      }
      await fn(new SqlAchievementsRepository(db).withTransaction(tx), tx);
    });
  }

  /** The same, with rewards switched on. */
  const withLiveRepo = (fn: (repo: SqlAchievementsRepository, tx: sql.Transaction) => Promise<void>) =>
    withRepo(async (repo, tx) => {
      await repo.setLive(true, 'moose');
      await fn(repo, tx);
    });

  const count = async (tx: sql.Transaction, table: string, where: string) =>
    (await new sql.Request(tx).query<{ n: number }>(`SELECT COUNT(*) AS n FROM [${gameName}].dbo.${table} WHERE ${where}`)).recordset[0].n;

  async function letterOf(tx: sql.Transaction, awardId: number) {
    const award = (
      await new sql.Request(tx).input('id', sql.Int, awardId).query<{
        dwUserID: number;
        szAchievement: string;
        bLevel: number;
        dwCharID: number;
        bRebirth: number;
        dwPostID: number;
        dwGold: number;
        dwSilver: number;
        dwCooper: number;
        szItems: string;
        szText: string;
        bAnnounced: number;
      }>(`SELECT * FROM [${gameName}].dbo.TPORTALACHIEVEMENTTABLE WHERE dwID = @id`)
    ).recordset[0];
    const post = (
      await new sql.Request(tx)
        .input('id', sql.Int, award.dwPostID)
        .query<PostRow>(
          `SELECT dwCharID, szSender, szTitle, szMessage, bType, dwGold, dwSilver, dwCooper FROM [${gameName}].dbo.TPOSTTABLE WHERE dwPostID = @id`,
        )
    ).recordset[0];
    // Title and message sit behind the game's 8 hex digit length prefix.
    return { award, post: { ...post, szTitle: post.szTitle.slice(8), szMessage: post.szMessage.slice(8) } };
  }

  describe('the switch', () => {
    it('is off until someone turns it on', async () => {
      await withRepo(async (repo) => {
        expect(await repo.live()).toBe(false);
        await repo.setLive(true, 'moose');
        expect(await repo.live()).toBe(true);
        await repo.setLive(false, 'friend');
        expect(await repo.live()).toBe(false);
      });
    });

    it('records who changed it last', async () => {
      await withRepo(async (repo, tx) => {
        await repo.setLive(true, 'moose');
        await repo.setLive(false, 'friend');
        const rows = (await new sql.Request(tx).query<{ szValue: string; szUpdatedBy: string }>(`SELECT szValue, szUpdatedBy FROM [${gameName}].dbo.TPORTALSETTING`)).recordset;
        expect(rows).toEqual([{ szValue: 'false', szUpdatedBy: 'friend' }]);
      });
    });

    it('awards nothing while it is off', async () => {
      await withRepo(async (repo, tx) => {
        expect(await repo.award(input())).toBe(AWARD_SWITCHED_OFF);
        await repo.setLive(true, 'moose');
        await repo.setLive(false, 'moose');
        expect(await repo.award(input())).toBe(AWARD_SWITCHED_OFF);
        expect(await repo.awards()).toEqual([]);
        expect(await count(tx, 'TPOSTTABLE', `szSender = 'Achievements'`)).toBe(0);
      });
    });
  });

  describe('rewards', () => {
    it('has none to start with', async () => {
      await withRepo(async (repo) => expect(await repo.rewards()).toEqual([]));
    });

    it('saves a reward for each level, with its items in order', async () => {
      await withRepo(async (repo) => {
        const three = [
          { itemId: stackable.itemId, count: 1 },
          { itemId: stackable.itemId, count: 2 },
          { itemId: stackable.itemId, count: 3 },
        ];
        await repo.setReward(reward(), 'moose');
        await repo.setReward(reward({ level: 1, gold: 0, silver: 0, copper: 7, items: three }), 'moose');
        await repo.setReward(reward({ achievementId: 'level', level: 5, items: [] }), 'moose');
        expect(await repo.rewards()).toEqual([
          reward({ level: 1, gold: 0, silver: 0, copper: 7, items: three }),
          reward(),
          reward({ achievementId: 'level', level: 5, items: [] }),
        ]);
      });
    });

    it('replaces the reward of a level saved again', async () => {
      await withRepo(async (repo) => {
        await repo.setReward(reward(), 'moose');
        await repo.setReward(reward({ gold: 250, items: [] }), 'friend');
        expect(await repo.rewards()).toEqual([reward({ gold: 250, items: [] })]);
      });
    });

    it('removes a reward saved as nothing', async () => {
      await withRepo(async (repo) => {
        await repo.setReward(reward(), 'moose');
        await repo.setReward(reward({ gold: 0, silver: 0, copper: 0, items: [] }), 'moose');
        expect(await repo.rewards()).toEqual([]);
      });
    });
  });

  describe('awarding', () => {
    it('sends the letter with the reward saved for the level, and records both together', async () => {
      await withLiveRepo(async (repo, tx) => {
        await repo.setReward(reward(), 'moose');
        const id = await repo.award(input());
        expect(id).toBeGreaterThan(0);

        const { award, post } = await letterOf(tx, id);
        expect(award).toMatchObject({
          dwUserID: character.userId,
          szAchievement: 'kills',
          bLevel: 2,
          dwCharID: character.charId,
          bRebirth: 0,
          dwGold: 12,
          dwSilver: 340,
          dwCooper: 5,
          szItems: `${stackable.itemId}x3`,
          szText: `${character.name} completed Slayer II: Defeat 10,000 monsters`,
          bAnnounced: ANNOUNCE_WAITING,
        });
        expect(post).toMatchObject({
          dwCharID: character.charId,
          szSender: 'Achievements',
          szTitle: 'Achievement: Slayer II',
          szMessage: 'You completed Slayer II: Defeat 10,000 monsters. Your reward is attached.',
          bType: 6,
          dwGold: 12,
          dwSilver: 340,
          dwCooper: 5,
        });
        expect(await count(tx, 'TITEMTABLE', `bStorageType = 2 AND dwStorageID = ${award.dwPostID} AND wItemID = ${stackable.itemId} AND bCount = 3`)).toBe(1);
        expect(await count(tx, 'TPORTALPOSTNOTIFY', `dwPostID = ${award.dwPostID}`)).toBe(1);
      });
    });

    it('sends a plain letter for a level with no reward', async () => {
      await withLiveRepo(async (repo, tx) => {
        // Another level's reward must not leak into this one.
        await repo.setReward(reward({ level: 3 }), 'moose');
        const { award, post } = await letterOf(tx, await repo.award(input()));
        expect(award).toMatchObject({ dwGold: 0, dwSilver: 0, dwCooper: 0, szItems: '' });
        expect(post).toMatchObject({ szMessage: 'You completed Slayer II: Defeat 10,000 monsters.', dwGold: 0, dwSilver: 0, dwCooper: 0 });
        expect(await count(tx, 'TITEMTABLE', `bStorageType = 2 AND dwStorageID = ${award.dwPostID}`)).toBe(0);
      });
    });

    it('attaches an items-only reward, and lists all three items', async () => {
      await withLiveRepo(async (repo, tx) => {
        const item = { itemId: stackable.itemId, count: 1 };
        await repo.setReward(reward({ gold: 0, silver: 0, copper: 0, items: [item, { ...item, count: 2 }, { ...item, count: 3 }] }), 'moose');
        const { award, post } = await letterOf(tx, await repo.award(input()));
        expect(award.szItems).toBe(`${stackable.itemId}x1,${stackable.itemId}x2,${stackable.itemId}x3`);
        expect(post.szMessage).toBe('You completed Slayer II: Defeat 10,000 monsters. Your reward is attached.');
        expect(await count(tx, 'TITEMTABLE', `bStorageType = 2 AND dwStorageID = ${award.dwPostID}`)).toBe(3);
      });
    });

    it('awards a level once: the second call sends no letter', async () => {
      await withLiveRepo(async (repo, tx) => {
        await repo.setReward(reward(), 'moose');
        expect(await repo.award(input())).toBeGreaterThan(0);
        expect(await repo.award(input())).toBe(AWARD_ALREADY_GIVEN);

        expect(await count(tx, 'TPORTALACHIEVEMENTTABLE', `dwUserID = ${character.userId}`)).toBe(1);
        expect(await count(tx, 'TPOSTTABLE', `dwCharID = ${character.charId} AND szSender = 'Achievements'`)).toBe(1);
      });
    });

    it('treats another level, and another account, as separate awards', async () => {
      await withLiveRepo(async (repo) => {
        await repo.award(input());
        expect(await repo.award(input({ level: 3 }))).toBeGreaterThan(0);
        expect(await repo.award(input({ userId: character.userId + 1_000_000 }))).toBeGreaterThan(0);
        expect(await repo.awards()).toHaveLength(3);
      });
    });

    it('awards the same level again in a character next life, and keeps the first', async () => {
      await withLiveRepo(async (repo, tx) => {
        await repo.setReward(reward(), 'moose');
        expect(await repo.award(input())).toBeGreaterThan(0);
        expect(await repo.award(input({ rebirth: 1 }))).toBeGreaterThan(0);
        expect(await repo.award(input({ rebirth: 1 }))).toBe(AWARD_ALREADY_GIVEN);

        expect((await repo.awards()).map(({ charId, rebirth, level }) => ({ charId, rebirth, level }))).toEqual([
          { charId: character.charId, rebirth: 0, level: 2 },
          { charId: character.charId, rebirth: 1, level: 2 },
        ]);
        // Paid both times.
        expect(await count(tx, 'TPOSTTABLE', `dwCharID = ${character.charId} AND szSender = 'Achievements' AND dwGold = 12`)).toBe(2);
      });
    });

    it('records an account achievement without a letter, and never with a reward', async () => {
      await withLiveRepo(async (repo, tx) => {
        // A reward row for it must be ignored: account achievements pay nothing.
        await repo.setReward(reward({ achievementId: 'hours', level: 1 }), 'moose');
        const id = await repo.award(input({ charId: 0, achievementId: 'hours', level: 1, text: 'account award' }));
        expect(id).toBeGreaterThan(0);

        const row = (
          await new sql.Request(tx).query<{ dwCharID: number; dwPostID: number; dwGold: number; szItems: string; szText: string }>(
            `SELECT dwCharID, dwPostID, dwGold, szItems, szText FROM [${gameName}].dbo.TPORTALACHIEVEMENTTABLE WHERE dwID = ${id}`,
          )
        ).recordset[0];
        expect(row).toEqual({ dwCharID: 0, dwPostID: 0, dwGold: 0, szItems: '', szText: 'account award' });
        expect(await count(tx, 'TPOSTTABLE', `szSender = 'Achievements'`)).toBe(0);
        expect(await repo.award(input({ charId: 0, achievementId: 'hours', level: 1 }))).toBe(AWARD_ALREADY_GIVEN);
      });
    });

    it('keeps two characters of one account apart', async () => {
      await withLiveRepo(async (repo, tx) => {
        const other = (
          await new sql.Request(tx).query<{ charId: number }>(
            `SELECT TOP 1 dwCharID AS charId FROM ${db.tables.characters} WHERE bDelete = 0 AND dwCharID <> ${character.charId} ORDER BY dwCharID`,
          )
        ).recordset[0];
        expect(await repo.award(input())).toBeGreaterThan(0);
        // Same account, achievement and level, another character.
        expect(await repo.award(input({ charId: other.charId }))).toBeGreaterThan(0);
        expect(await count(tx, 'TPOSTTABLE', `dwCharID = ${other.charId} AND szSender = 'Achievements'`)).toBe(1);
      });
    });

    it('writes nothing for a character that does not exist', async () => {
      await withLiveRepo(async (repo, tx) => {
        expect(await repo.award(input({ charId: 2_000_000_000 }))).toBe(AWARD_NO_CHARACTER);
        expect(await repo.awards()).toEqual([]);
        expect(await count(tx, 'TPOSTTABLE', `szSender = 'Achievements'`)).toBe(0);
        // The level can still be awarded once the account has a character again.
        expect(await repo.award(input())).toBeGreaterThan(0);
      });
    });
  });

  describe('awards and announcements', () => {
    it('reads the awards back oldest first, with their age', async () => {
      await withLiveRepo(async (repo) => {
        const first = await repo.award(input({ level: 1, text: 'first' }));
        const second = await repo.award(input({ level: 2, text: 'second' }));

        const awards = await repo.awards();
        expect(awards.map(({ id, level, text, announced }) => ({ id, level, text, announced }))).toEqual([
          { id: first, level: 1, text: 'first', announced: ANNOUNCE_WAITING },
          { id: second, level: 2, text: 'second', announced: ANNOUNCE_WAITING },
        ]);
        expect(awards[0]).toMatchObject({ userId: character.userId, charId: character.charId, rebirth: 0, achievementId: 'kills' });
        expect(awards[0].earnedAt).toBeInstanceOf(Date);
        expect(awards[0].ageSeconds).toBeGreaterThanOrEqual(0);
        expect(awards[0].ageSeconds).toBeLessThan(60);
      });
    });

    it('ages an award by the database clock', async () => {
      await withLiveRepo(async (repo, tx) => {
        const id = await repo.award(input());
        await new sql.Request(tx).query(`UPDATE [${gameName}].dbo.TPORTALACHIEVEMENTTABLE SET dEarned = DATEADD(minute, -15, GETDATE()) WHERE dwID = ${id}`);
        const [award] = await repo.awards();
        expect(award.ageSeconds).toBeGreaterThanOrEqual(15 * 60);
        expect(award.ageSeconds).toBeLessThan(16 * 60);
      });
    });

    it('lets an announcement be claimed once', async () => {
      await withLiveRepo(async (repo) => {
        const id = await repo.award(input());
        expect(await repo.claimAnnouncement(id)).toBe(true);
        expect(await repo.claimAnnouncement(id)).toBe(false);
        expect((await repo.awards())[0].announced).toBe(ANNOUNCE_SENT);
      });
    });

    it('can put a claimed announcement back, and cannot claim a skipped one', async () => {
      await withLiveRepo(async (repo) => {
        const id = await repo.award(input());
        await repo.claimAnnouncement(id);
        await repo.markAnnounced(id, ANNOUNCE_WAITING);
        expect(await repo.claimAnnouncement(id)).toBe(true);

        await repo.markAnnounced(id, ANNOUNCE_SKIPPED);
        expect(await repo.claimAnnouncement(id)).toBe(false);
        expect(await repo.claimAnnouncement(2_000_000_000)).toBe(false);
      });
    });
  });

  it('knows whether anyone has played in the last minutes', async () => {
    await withRepo(async (repo, tx) => {
      // Nobody online and every logout long ago.
      await new sql.Request(tx).query(
        `DELETE FROM ${db.tables.currentUsers}; UPDATE ${db.tables.characters} SET dLogoutDate = '2000-01-01' WHERE bDelete = 0;`,
      );
      expect(await repo.recentlyActive(10)).toBe(false);

      await new sql.Request(tx).query(`UPDATE ${db.tables.characters} SET dLogoutDate = DATEADD(minute, -5, GETDATE()) WHERE dwCharID = ${character.charId}`);
      expect(await repo.recentlyActive(10)).toBe(true);
      expect(await repo.recentlyActive(3)).toBe(false);
    });
  });

  it('finds reward items by ID', async () => {
    await withRepo(async (repo) => {
      expect(await repo.findItems([])).toEqual([]);
      const found = await repo.findItems([stackable.itemId, 32767]);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ itemId: stackable.itemId, stack: stackable.stack });
    });
  });
});
