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

export type AwardInput = {
  userId: number;
  achievementId: string;
  level: number;
  charId: number;
  sender: string;
  title: string;
  message: string;
  gold: number;
  silver: number;
  copper: number;
  items: { itemId: number; count: number }[]; // 0..3
  text: string;
};

export const AWARD_ALREADY_GIVEN = 0;
export const AWARD_NO_CHARACTER = -1;

export interface AchievementsRepository {
  /** Every award this season, oldest first. */
  awards(): Promise<AwardRow[]>;
  /** Sends the letter and records the award together. The new award's ID, or one of the AWARD_* results. */
  award(input: AwardInput): Promise<number>;
  /** One per account that has a live character: the one online now, else the one played last. */
  recipients(): Promise<RecipientRow[]>;
  markAnnounced(id: number, state: number): Promise<void>;
  /** Whether anyone is online or logged out within the last `minutes`. */
  recentlyActive(minutes: number): Promise<boolean>;
  findItems(itemIds: number[]): Promise<RewardItemRow[]>;
}

export const ACHIEVEMENTS_REPOSITORY = Symbol('ACHIEVEMENTS_REPOSITORY');

const ITEM_SLOTS = 3;

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

  async awards(): Promise<AwardRow[]> {
    const result = await this.request().query<AwardRow>(
      `SELECT dwID AS id, dwUserID AS userId, szAchievement AS achievementId, bLevel AS level,
              dEarned AS earnedAt, szText AS text, bAnnounced AS announced
       FROM ${this.db.tables.achievementAwards}
       ORDER BY dwID`,
    );
    return result.recordset;
  }

  async award(input: AwardInput): Promise<number> {
    const request = this.request()
      .input('userId', sql.Int, input.userId)
      .input('achievement', sql.VarChar(40), input.achievementId)
      .input('level', sql.TinyInt, input.level)
      .input('charId', sql.Int, input.charId)
      .input('sender', sql.VarChar(50), input.sender)
      .input('title', sql.VarChar(240), input.title)
      .input('message', sql.VarChar(2000), input.message)
      .input('gold', sql.Int, input.gold)
      .input('silver', sql.Int, input.silver)
      .input('copper', sql.Int, input.copper)
      .input('text', sql.VarChar(200), input.text);
    for (let slot = 0; slot < ITEM_SLOTS; slot++) {
      const item = input.items[slot];
      request.input(`item${slot + 1}`, sql.SmallInt, item?.itemId ?? 0);
      request.input(`count${slot + 1}`, sql.TinyInt, item?.count ?? 0);
    }
    const result = await request.query<{ id: number }>(
      `DECLARE @r INT;
       EXEC @r = ${this.db.tables.achievementProcedure}
         @dwUserID = @userId, @szAchievement = @achievement, @bLevel = @level, @pCharID = @charId,
         @pSender = @sender, @pTitle = @title, @pMessage = @message,
         @dwGold = @gold, @dwSilver = @silver, @dwCooper = @copper,
         @wItemID1 = @item1, @bCount1 = @count1,
         @wItemID2 = @item2, @bCount2 = @count2,
         @wItemID3 = @item3, @bCount3 = @count3,
         @szText = @text;
       SELECT @r AS id;`,
    );
    return result.recordset[0]?.id ?? AWARD_NO_CHARACTER;
  }

  async recipients(): Promise<RecipientRow[]> {
    const { characters, currentUsers } = this.db.tables;
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
       ) ranked
       WHERE pick = 1`,
    );
    return result.recordset;
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
