import {
  REBIRTH_DEFAULT_SETTINGS,
  type RebirthBonuses,
  type RebirthSettings,
  rebirthSettingsSchema,
  type Wallet,
} from '@4story-portal/shared';
import { Injectable } from '@nestjs/common';
import sql from 'mssql';
import { isEmptyReward, type RewardItemRow } from '../achievements/achievements.repository.js';
import { DbService } from '../db/db.service.js';
import { settingIsOn } from '../games/wallet-bet.js';
import { REBIRTH_KEY_LIST, REBIRTH_KEYS, REBIRTH_OK, type RebirthCode, rebirthSql, wornItemIds } from './rebirth-sql.js';

export const ANNOUNCE_WAITING = 0,
  ANNOUNCE_SENT = 1,
  ANNOUNCE_SKIPPED = 2;

export type RebirthLogRow = {
  id: number;
  userId: number;
  charId: number;
  name: string;
  rebirth: number;
  bonus: number;
  priceGold: number;
  at: Date;
  ageSeconds: number;
  text: string;
  announced: number;
};

/** A stored whole number, or null for anything else (missing, empty, decimal, text). */
const readInteger = (value: string | undefined): number | null => (value !== undefined && /^-?\d{1,9}$/.test(value.trim()) ? Number(value) : null);

export type RebirthInput = { userId: number; charId: number; expectedPriceGold: number; baseline: string; text: string };

export type RebirthOutcome =
  | {
      code: typeof REBIRTH_OK;
      id: number;
      name: string;
      rebirth: number;
      bonuses: RebirthBonuses;
      priceGold: number;
      wallet: Wallet;
      /** The reward letter, or 0 when this rebirth number pays nothing. */
      postId: number;
    }
  | { code: Exclude<RebirthCode, typeof REBIRTH_OK> };

export type RebirthCharacterRow = {
  name: string;
  level: number;
  online: boolean;
  wornItems: number;
  rebirths: number;
  statBonus: number;
  expBonus: number;
  goldBonus: number;
  gold: number;
  silver: number;
  copper: number;
};

/** What one rebirth number pays: a row of TPORTALREBIRTHREWARD. A number with no row pays nothing. */
export type RebirthRewardRow = {
  rebirth: number;
  gold: number;
  silver: number;
  copper: number;
  items: { itemId: number; count: number }[]; // 0..3
};

export interface RebirthRepository {
  /** Null unless the character exists, isn't deleted and belongs to this account. */
  find(userId: number, charId: number): Promise<RebirthCharacterRow | null>;
  /** Checks and does the whole rebirth in one transaction, or refuses with nothing written. */
  rebirth(input: RebirthInput): Promise<RebirthOutcome>;
  settings(): Promise<RebirthSettings>;
  /**
   * Saves the six rows and sets every character's bStatBonus, bExpBonus and bGoldBonus to min(bRebirth, limit)
   * times each percent, in one transaction. Saved rewards are left alone, even above a lowered limit.
   */
  saveSettings(settings: RebirthSettings, changedBy: string): Promise<void>;
  /** Every saved reward, by rebirth number. */
  rewards(): Promise<RebirthRewardRow[]>;
  /** Saves what a rebirth number pays. A reward with no money and no items removes the row. */
  setReward(reward: RebirthRewardRow, changedBy: string): Promise<void>;
  findItems(itemIds: number[]): Promise<RewardItemRow[]>;
  /** Newest first. */
  recent(limit: number): Promise<RebirthLogRow[]>;
  /** Characters with a row in TCHARREBIRTHTABLE. */
  count(): Promise<number>;
  waitingAnnouncements(): Promise<RebirthLogRow[]>;
  /** WAITING -> SENT; true only for the caller that changed it. */
  claimAnnouncement(id: number): Promise<boolean>;
  markAnnounced(id: number, state: number): Promise<void>;
}

export const REBIRTH_REPOSITORY = Symbol('REBIRTH_REPOSITORY');

type RebirthRow = {
  code: RebirthCode;
  id: number;
  name: string;
  rebirth: number;
  bonus: number;
  expBonus: number;
  goldBonus: number;
  priceGold: number;
  postId: number;
} & Wallet;

const ITEM_SLOTS = [1, 2, 3] as const;
type RawReward = Omit<RebirthRewardRow, 'items'> & Record<`item${1 | 2 | 3}` | `count${1 | 2 | 3}`, number>;

@Injectable()
export class SqlRebirthRepository implements RebirthRepository {
  private tx?: sql.Transaction;

  constructor(private readonly db: DbService) {}

  /** Returns a copy whose queries run on tx (used by tests to roll back). */
  withTransaction(tx: sql.Transaction): SqlRebirthRepository {
    const copy = new SqlRebirthRepository(this.db);
    copy.tx = tx;
    return copy;
  }

  private request(): sql.Request {
    return this.tx ? new sql.Request(this.tx) : this.db.pool.request();
  }

  async find(userId: number, charId: number): Promise<RebirthCharacterRow | null> {
    const t = this.db.tables;
    // Online and worn are read the way the rebirth batch reads them, so the page agrees with the button.
    const result = await this.request()
      .input('userId', sql.Int, userId)
      .input('charId', sql.Int, charId)
      .query<RebirthCharacterRow>(
        `SELECT c.szNAME AS name, c.bLevel AS level,
                CAST(CASE WHEN EXISTS (SELECT 1 FROM ${t.currentUsers} u WHERE u.dwUserID = @userId AND u.dwCharID = c.dwCharID)
                          THEN 1 ELSE 0 END AS bit) AS online,
                (SELECT COUNT(*) FROM (${wornItemIds(t, 'c.dwCharID')}) w) AS wornItems,
                ISNULL(r.bRebirth, 0) AS rebirths, ISNULL(r.bStatBonus, 0) AS statBonus,
                ISNULL(r.bExpBonus, 0) AS expBonus, ISNULL(r.bGoldBonus, 0) AS goldBonus,
                c.dwGold AS gold, c.dwSilver AS silver, c.dwCooper AS copper
         FROM ${t.characters} c
         LEFT JOIN ${t.rebirths} r ON r.dwCharID = c.dwCharID
         WHERE c.dwCharID = @charId AND c.dwUserID = @userId AND c.bDelete = 0`,
      );
    return result.recordset[0] ?? null;
  }

  async rebirth(input: RebirthInput): Promise<RebirthOutcome> {
    const result = await this.request()
      .input('userId', sql.Int, input.userId)
      .input('charId', sql.Int, input.charId)
      .input('expectedPriceGold', sql.Int, input.expectedPriceGold)
      .input('baseline', sql.VarChar(2000), input.baseline)
      .input('text', sql.VarChar(160), input.text)
      .query<RebirthRow>(rebirthSql(this.db.tables));
    const { code, id, name, rebirth, bonus, expBonus, goldBonus, priceGold, gold, silver, copper, postId } = result.recordset[0];
    return code === REBIRTH_OK
      ? { code, id, name, rebirth, bonuses: { stats: bonus, exp: expBonus, gold: goldBonus }, priceGold, wallet: { gold, silver, copper }, postId }
      : { code };
  }

  async settings(): Promise<RebirthSettings> {
    const result = await this.request().query<{ key: string; value: string }>(
      `SELECT szKey AS [key], szValue AS value FROM ${this.db.tables.portalSettings} WHERE szKey IN (${REBIRTH_KEY_LIST})`,
    );
    const values = new Map(result.recordset.map((row) => [row.key, row.value]));
    const priceGold = readInteger(values.get(REBIRTH_KEYS.priceGold));
    const percent = readInteger(values.get(REBIRTH_KEYS.percent));
    const limit = readInteger(values.get(REBIRTH_KEYS.limit));
    // The EXP and gold percents came later: a missing row is 0 (off). One that is there but unusable is unusable.
    const extra = (key: string) => (values.has(key) ? readInteger(values.get(key)) : 0);
    const expPercent = extra(REBIRTH_KEYS.expPercent);
    const goldPercent = extra(REBIRTH_KEYS.goldPercent);
    // A missing or unusable row, or numbers that break the rules together, mean closed with the starting numbers.
    if (priceGold === null || percent === null || limit === null || expPercent === null || goldPercent === null || !values.has(REBIRTH_KEYS.live))
      return REBIRTH_DEFAULT_SETTINGS;
    const live = settingIsOn(values.get(REBIRTH_KEYS.live));
    const parsed = rebirthSettingsSchema.safeParse({ live, priceGold, percent, limit, expPercent, goldPercent });
    return parsed.success ? parsed.data : REBIRTH_DEFAULT_SETTINGS;
  }

  async saveSettings(settings: RebirthSettings, changedBy: string): Promise<void> {
    // One batch: the six rows and every character's bonuses change together or not at all.
    const rows: [string, string, string | number | boolean][] = [
      ['live', REBIRTH_KEYS.live, settings.live],
      ['price', REBIRTH_KEYS.priceGold, settings.priceGold],
      ['percent', REBIRTH_KEYS.percent, settings.percent],
      ['limit', REBIRTH_KEYS.limit, settings.limit],
      ['exp', REBIRTH_KEYS.expPercent, settings.expPercent],
      ['gold', REBIRTH_KEYS.goldPercent, settings.goldPercent],
    ];
    const request = this.request();
    for (const [name, key, value] of rows) {
      request.input(`${name}Key`, sql.VarChar(40), key).input(`${name}Value`, sql.VarChar(200), String(value));
    }
    await request
      .input('percent', sql.Int, settings.percent)
      .input('limit', sql.Int, settings.limit)
      .input('expPercent', sql.Int, settings.expPercent)
      .input('goldPercent', sql.Int, settings.goldPercent)
      .input('by', sql.VarChar(50), changedBy)
      .query(
        `SET XACT_ABORT ON;
         BEGIN TRAN;
         MERGE ${this.db.tables.portalSettings} WITH (HOLDLOCK) AS target
         USING (VALUES ${rows.map(([name]) => `(@${name}Key, @${name}Value)`).join(', ')})
           AS source (szKey, szValue) ON target.szKey = source.szKey
         WHEN MATCHED THEN UPDATE SET szValue = source.szValue, szUpdatedBy = @by, dUpdated = GETDATE()
         WHEN NOT MATCHED THEN INSERT (szKey, szValue, szUpdatedBy) VALUES (source.szKey, source.szValue, @by);
         UPDATE ${this.db.tables.rebirths}
         SET bStatBonus = (CASE WHEN bRebirth < @limit THEN bRebirth ELSE @limit END) * @percent,
             bExpBonus = (CASE WHEN bRebirth < @limit THEN bRebirth ELSE @limit END) * @expPercent,
             bGoldBonus = (CASE WHEN bRebirth < @limit THEN bRebirth ELSE @limit END) * @goldPercent,
             dUpdate = GETDATE();
         COMMIT;`,
      );
  }

  async rewards(): Promise<RebirthRewardRow[]> {
    const result = await this.request().query<RawReward>(
      `SELECT bRebirth AS rebirth, dwGold AS gold, dwSilver AS silver, dwCooper AS copper,
              wItemID1 AS item1, bCount1 AS count1, wItemID2 AS item2, bCount2 AS count2, wItemID3 AS item3, bCount3 AS count3
       FROM ${this.db.tables.rebirthRewards}
       ORDER BY bRebirth`,
    );
    return result.recordset.map(({ rebirth, gold, silver, copper, ...slots }) => ({
      rebirth,
      gold,
      silver,
      copper,
      items: ITEM_SLOTS.flatMap((slot) => (slots[`item${slot}`] ? [{ itemId: slots[`item${slot}`], count: slots[`count${slot}`] }] : [])),
    }));
  }

  async setReward(reward: RebirthRewardRow, changedBy: string): Promise<void> {
    const request = this.request().input('rebirth', sql.TinyInt, reward.rebirth);
    if (isEmptyReward(reward)) {
      await request.query(`DELETE FROM ${this.db.tables.rebirthRewards} WHERE bRebirth = @rebirth`);
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
      `MERGE ${this.db.tables.rebirthRewards} WITH (HOLDLOCK) AS target
       USING (SELECT @rebirth AS bRebirth) AS source ON target.bRebirth = source.bRebirth
       WHEN MATCHED THEN UPDATE SET
         dwGold = @gold, dwSilver = @silver, dwCooper = @copper,
         wItemID1 = @item1, bCount1 = @count1, wItemID2 = @item2, bCount2 = @count2, wItemID3 = @item3, bCount3 = @count3,
         szUpdatedBy = @by, dUpdated = GETDATE()
       WHEN NOT MATCHED THEN INSERT
         (bRebirth, dwGold, dwSilver, dwCooper, wItemID1, bCount1, wItemID2, bCount2, wItemID3, bCount3, szUpdatedBy)
         VALUES (@rebirth, @gold, @silver, @copper, @item1, @count1, @item2, @count2, @item3, @count3, @by);`,
    );
  }

  /** The same query as AchievementsRepository.findItems. */
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

  private async log(top: number, where: string, order: string): Promise<RebirthLogRow[]> {
    const result = await this.request().input('top', sql.Int, top).query<RebirthLogRow>(
      `SELECT TOP (@top) dwID AS id, dwUserID AS userId, dwCharID AS charId, szCharName AS name, bRebirth AS rebirth,
              bStatBonus AS bonus, dwPriceGold AS priceGold, dRebirth AS at, DATEDIFF(SECOND, dRebirth, GETDATE()) AS ageSeconds,
              szText AS text, bAnnounced AS announced
       FROM ${this.db.tables.rebirthLog} WHERE ${where} ORDER BY ${order}`,
    );
    return result.recordset;
  }

  recent(limit: number): Promise<RebirthLogRow[]> {
    return this.log(limit, '1 = 1', 'dwID DESC');
  }

  async count(): Promise<number> {
    const result = await this.request().query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${this.db.tables.rebirths}`);
    return result.recordset[0].n;
  }

  waitingAnnouncements(): Promise<RebirthLogRow[]> {
    return this.log(50, `bAnnounced = ${ANNOUNCE_WAITING}`, 'dwID');
  }

  async claimAnnouncement(id: number): Promise<boolean> {
    const result = await this.request()
      .input('id', sql.Int, id)
      .query(`UPDATE ${this.db.tables.rebirthLog} SET bAnnounced = ${ANNOUNCE_SENT} WHERE dwID = @id AND bAnnounced = ${ANNOUNCE_WAITING}`);
    return result.rowsAffected[0] === 1;
  }

  async markAnnounced(id: number, state: number): Promise<void> {
    await this.request()
      .input('id', sql.Int, id)
      .input('state', sql.TinyInt, state)
      .query(`UPDATE ${this.db.tables.rebirthLog} SET bAnnounced = @state WHERE dwID = @id`);
  }
}
