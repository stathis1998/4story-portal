import { Injectable } from '@nestjs/common';
import sql from 'mssql';
import { DbService } from '../db/db.service.js';

/** A level the portal has awarded: a row of TPORTALACHIEVEMENTTABLE. */
export type AwardRow = {
  id: number;
  userId: number;
  achievementId: string;
  level: number;
  /** The server's wall clock, held as UTC like every date the driver returns. */
  earnedAt: Date;
  /** How long ago that was, by the database's own clock. */
  ageSeconds: number;
  /** The line announced in game. */
  text: string;
  announced: number;
};

export const ANNOUNCE_WAITING = 0;
export const ANNOUNCE_SENT = 1;
export const ANNOUNCE_SKIPPED = 2;

/** The character that gets an account's reward letters. */
export type RecipientRow = { userId: number; charId: number; name: string };
export type RewardItemRow = { itemId: number; name: string; stack: number };

/** What one achievement level pays: a row of TPORTALACHIEVEMENTREWARD. A level with no row pays nothing. */
export type RewardRow = {
  achievementId: string;
  level: number;
  gold: number;
  silver: number;
  copper: number;
  items: { itemId: number; count: number }[]; // 0..3
};

export type AwardInput = {
  userId: number;
  achievementId: string;
  level: number;
  charId: number;
  sender: string;
  title: string;
  message: string;
  /** Added to the message when the level pays something. The database decides: it holds the reward. */
  rewardNote: string;
  text: string;
};

export const AWARD_ALREADY_GIVEN = 0;
export const AWARD_NO_CHARACTER = -1;
export const AWARD_SWITCHED_OFF = -2;

export interface AchievementsRepository {
  /** Whether levels are awarded, mailed and announced. One switch for every portal process on this database. */
  live(): Promise<boolean>;
  setLive(live: boolean, changedBy: string): Promise<void>;
  rewards(): Promise<RewardRow[]>;
  /** Saves what a level pays. A reward with no money and no items removes the row. */
  setReward(reward: RewardRow, changedBy: string): Promise<void>;
  /** Every award this season, oldest first. */
  awards(): Promise<AwardRow[]>;
  /**
   * Sends the letter, with the level's saved reward, and records the award together.
   * The new award's ID, or one of the AWARD_* results when nothing was written.
   */
  award(input: AwardInput): Promise<number>;
  /** One per account that has a character that isn't banned: the one online now, else the one played last. */
  recipients(): Promise<RecipientRow[]>;
  /** Takes a waiting announcement for sending. False when another tick or process already has. */
  claimAnnouncement(id: number): Promise<boolean>;
  markAnnounced(id: number, state: number): Promise<void>;
  /** Whether anyone is online or logged out within the last `minutes`. */
  recentlyActive(minutes: number): Promise<boolean>;
  findItems(itemIds: number[]): Promise<RewardItemRow[]>;
}

export const ACHIEVEMENTS_REPOSITORY = Symbol('ACHIEVEMENTS_REPOSITORY');

const ITEM_SLOTS = [1, 2, 3] as const;
const LIVE_KEY = 'achievements_live';

type RawReward = Omit<RewardRow, 'items'> & Record<`item${1 | 2 | 3}` | `count${1 | 2 | 3}`, number>;

export const isEmptyReward = (reward: Pick<RewardRow, 'gold' | 'silver' | 'copper' | 'items'>) =>
  reward.gold + reward.silver + reward.copper === 0 && reward.items.length === 0;

@Injectable()
export class SqlAchievementsRepository implements AchievementsRepository {
  private tx?: sql.Transaction;

  constructor(private readonly db: DbService) {}

  /** Returns a copy whose queries run on tx (used by tests to roll back). */
  withTransaction(tx: sql.Transaction): SqlAchievementsRepository {
    const copy = new SqlAchievementsRepository(this.db);
    copy.tx = tx;
    return copy;
  }

  private request(): sql.Request {
    return this.tx ? new sql.Request(this.tx) : this.db.pool.request();
  }

  async live(): Promise<boolean> {
    const result = await this.request()
      .input('key', sql.VarChar(40), LIVE_KEY)
      .query<{ value: string }>(`SELECT szValue AS value FROM ${this.db.tables.portalSettings} WHERE szKey = @key`);
    return result.recordset[0]?.value === 'true';
  }

  async setLive(live: boolean, changedBy: string): Promise<void> {
    await this.request()
      .input('key', sql.VarChar(40), LIVE_KEY)
      .input('value', sql.VarChar(200), String(live))
      .input('by', sql.VarChar(50), changedBy)
      .query(
        `MERGE ${this.db.tables.portalSettings} WITH (HOLDLOCK) AS target
         USING (SELECT @key AS szKey) AS source ON target.szKey = source.szKey
         WHEN MATCHED THEN UPDATE SET szValue = @value, szUpdatedBy = @by, dUpdated = GETDATE()
         WHEN NOT MATCHED THEN INSERT (szKey, szValue, szUpdatedBy) VALUES (@key, @value, @by);`,
      );
  }

  async rewards(): Promise<RewardRow[]> {
    const result = await this.request().query<RawReward>(
      `SELECT szAchievement AS achievementId, bLevel AS level, dwGold AS gold, dwSilver AS silver, dwCooper AS copper,
              wItemID1 AS item1, bCount1 AS count1, wItemID2 AS item2, bCount2 AS count2, wItemID3 AS item3, bCount3 AS count3
       FROM ${this.db.tables.achievementRewards}
       ORDER BY szAchievement, bLevel`,
    );
    return result.recordset.map(({ achievementId, level, gold, silver, copper, ...slots }) => ({
      achievementId,
      level,
      gold,
      silver,
      copper,
      items: ITEM_SLOTS.flatMap((slot) => (slots[`item${slot}`] ? [{ itemId: slots[`item${slot}`], count: slots[`count${slot}`] }] : [])),
    }));
  }

  async setReward(reward: RewardRow, changedBy: string): Promise<void> {
    const request = this.request()
      .input('achievement', sql.VarChar(40), reward.achievementId)
      .input('level', sql.TinyInt, reward.level);
    if (isEmptyReward(reward)) {
      await request.query(`DELETE FROM ${this.db.tables.achievementRewards} WHERE szAchievement = @achievement AND bLevel = @level`);
      return;
    }
    request
      .input('gold', sql.Int, reward.gold)
      .input('silver', sql.Int, reward.silver)
      .input('copper', sql.Int, reward.copper)
      .input('by', sql.VarChar(50), changedBy);
    for (const slot of ITEM_SLOTS) {
      const item = reward.items[slot - 1];
      request.input(`item${slot}`, sql.SmallInt, item?.itemId ?? 0);
      request.input(`count${slot}`, sql.TinyInt, item?.count ?? 0);
    }
    await request.query(
      `MERGE ${this.db.tables.achievementRewards} WITH (HOLDLOCK) AS target
       USING (SELECT @achievement AS szAchievement, @level AS bLevel) AS source
         ON target.szAchievement = source.szAchievement AND target.bLevel = source.bLevel
       WHEN MATCHED THEN UPDATE SET
         dwGold = @gold, dwSilver = @silver, dwCooper = @copper,
         wItemID1 = @item1, bCount1 = @count1, wItemID2 = @item2, bCount2 = @count2, wItemID3 = @item3, bCount3 = @count3,
         szUpdatedBy = @by, dUpdated = GETDATE()
       WHEN NOT MATCHED THEN INSERT
         (szAchievement, bLevel, dwGold, dwSilver, dwCooper, wItemID1, bCount1, wItemID2, bCount2, wItemID3, bCount3, szUpdatedBy)
         VALUES (@achievement, @level, @gold, @silver, @copper, @item1, @count1, @item2, @count2, @item3, @count3, @by);`,
    );
  }

  async awards(): Promise<AwardRow[]> {
    const result = await this.request().query<AwardRow>(
      `SELECT dwID AS id, dwUserID AS userId, szAchievement AS achievementId, bLevel AS level,
              dEarned AS earnedAt, DATEDIFF(second, dEarned, GETDATE()) AS ageSeconds, szText AS text, bAnnounced AS announced
       FROM ${this.db.tables.achievementAwards}
       ORDER BY dwID`,
    );
    return result.recordset;
  }

  async award(input: AwardInput): Promise<number> {
    const result = await this.request()
      .input('userId', sql.Int, input.userId)
      .input('achievement', sql.VarChar(40), input.achievementId)
      .input('level', sql.TinyInt, input.level)
      .input('charId', sql.Int, input.charId)
      .input('sender', sql.VarChar(50), input.sender)
      .input('title', sql.VarChar(240), input.title)
      .input('message', sql.VarChar(1800), input.message)
      .input('rewardNote', sql.VarChar(200), input.rewardNote)
      .input('text', sql.VarChar(200), input.text)
      .query<{ id: number }>(
        `DECLARE @r INT;
         EXEC @r = ${this.db.tables.achievementProcedure}
           @dwUserID = @userId, @szAchievement = @achievement, @bLevel = @level, @pCharID = @charId,
           @pSender = @sender, @pTitle = @title, @pMessage = @message, @pRewardNote = @rewardNote, @szText = @text;
         SELECT @r AS id;`,
      );
    return result.recordset[0]?.id ?? AWARD_NO_CHARACTER;
  }

  async recipients(): Promise<RecipientRow[]> {
    const { characters, currentUsers, allCharacters } = this.db.tables;
    const result = await this.request().query<RecipientRow>(
      `SELECT userId, charId, name FROM (
         SELECT c.dwUserID AS userId, c.dwCharID AS charId, c.szNAME AS name,
                ROW_NUMBER() OVER (
                  PARTITION BY c.dwUserID
                  ORDER BY CASE WHEN EXISTS (SELECT 1 FROM ${currentUsers} u WHERE u.dwCharID = c.dwCharID) THEN 0 ELSE 1 END,
                           c.dLogoutDate DESC, c.dwCharID
                ) AS pick
         FROM ${characters} c
         WHERE c.bDelete = 0
           AND NOT EXISTS (SELECT 1 FROM ${allCharacters} a WHERE a.dwCharID = c.dwCharID AND a.Ban <> 0)
       ) ranked
       WHERE pick = 1`,
    );
    return result.recordset;
  }

  async claimAnnouncement(id: number): Promise<boolean> {
    const result = await this.request()
      .input('id', sql.Int, id)
      .query(
        `UPDATE ${this.db.tables.achievementAwards} SET bAnnounced = ${ANNOUNCE_SENT}
         WHERE dwID = @id AND bAnnounced = ${ANNOUNCE_WAITING}`,
      );
    return result.rowsAffected[0] === 1;
  }

  async markAnnounced(id: number, state: number): Promise<void> {
    await this.request()
      .input('id', sql.Int, id)
      .input('state', sql.TinyInt, state)
      .query(`UPDATE ${this.db.tables.achievementAwards} SET bAnnounced = @state WHERE dwID = @id`);
  }

  async recentlyActive(minutes: number): Promise<boolean> {
    const { characters, currentUsers } = this.db.tables;
    const result = await this.request()
      .input('minutes', sql.Int, minutes)
      .query<{ active: number }>(
        `SELECT CASE WHEN EXISTS (SELECT 1 FROM ${currentUsers})
                       OR EXISTS (SELECT 1 FROM ${characters}
                                  WHERE bDelete = 0 AND dLogoutDate > DATEADD(minute, -@minutes, GETDATE()))
                     THEN 1 ELSE 0 END AS active`,
      );
    return result.recordset[0]?.active === 1;
  }

  async findItems(itemIds: number[]): Promise<RewardItemRow[]> {
    if (itemIds.length === 0) return [];
    const request = this.request();
    itemIds.forEach((id, i) => request.input(`i${i}`, sql.Int, id));
    const list = itemIds.map((_, i) => `@i${i}`).join(', ');
    const result = await request.query<RewardItemRow>(
      `SELECT wItemID AS itemId, CASE WHEN szNAME = '_' THEN '' ELSE szNAME END AS name, bStack AS stack
       FROM ${this.db.tables.items} WHERE wItemID IN (${list})`,
    );
    return result.recordset;
  }
}
