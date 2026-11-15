import { REBIRTH_DEFAULT_SETTINGS, type RebirthSettings, rebirthSettingsSchema, type Wallet } from '@4story-portal/shared';
import { Injectable } from '@nestjs/common';
import sql from 'mssql';
import { DbService } from '../db/db.service.js';
import { settingIsOn } from '../games/wallet-bet.js';
import { REBIRTH_KEYS, REBIRTH_OK, type RebirthCode, rebirthSql, wornItemIds } from './rebirth-sql.js';

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
  | { code: typeof REBIRTH_OK; id: number; name: string; rebirth: number; bonus: number; priceGold: number; wallet: Wallet }
  | { code: Exclude<RebirthCode, typeof REBIRTH_OK> };

export type RebirthCharacterRow = {
  name: string;
  level: number;
  online: boolean;
  wornItems: number;
  rebirths: number;
  bonus: number;
  gold: number;
  silver: number;
  copper: number;
};

export interface RebirthRepository {
  /** Null unless the character exists, isn't deleted and belongs to this account. */
  find(userId: number, charId: number): Promise<RebirthCharacterRow | null>;
  /** Checks and does the whole rebirth in one transaction, or refuses with nothing written. */
  rebirth(input: RebirthInput): Promise<RebirthOutcome>;
  settings(): Promise<RebirthSettings>;
  /** Saves the four rows and sets every character's bStatBonus to min(bRebirth, limit) * percent, in one transaction. */
  saveSettings(settings: RebirthSettings, changedBy: string): Promise<void>;
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

type RebirthRow = { code: RebirthCode; id: number; name: string; rebirth: number; bonus: number; priceGold: number } & Wallet;

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
                ISNULL(r.bRebirth, 0) AS rebirths, ISNULL(r.bStatBonus, 0) AS bonus,
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
    const { code, id, name, rebirth, bonus, priceGold, gold, silver, copper } = result.recordset[0];
    return code === REBIRTH_OK ? { code, id, name, rebirth, bonus, priceGold, wallet: { gold, silver, copper } } : { code };
  }

  async settings(): Promise<RebirthSettings> {
    const result = await this.request().query<{ key: string; value: string }>(
      `SELECT szKey AS [key], szValue AS value FROM ${this.db.tables.portalSettings}
       WHERE szKey IN ('${REBIRTH_KEYS.live}', '${REBIRTH_KEYS.priceGold}', '${REBIRTH_KEYS.percent}', '${REBIRTH_KEYS.limit}')`,
    );
    const values = new Map(result.recordset.map((row) => [row.key, row.value]));
    const priceGold = readInteger(values.get(REBIRTH_KEYS.priceGold));
    const percent = readInteger(values.get(REBIRTH_KEYS.percent));
    const limit = readInteger(values.get(REBIRTH_KEYS.limit));
    // A missing or unusable row, or numbers that break the rules together, mean closed with the starting numbers.
    if (priceGold === null || percent === null || limit === null || !values.has(REBIRTH_KEYS.live)) return REBIRTH_DEFAULT_SETTINGS;
    const parsed = rebirthSettingsSchema.safeParse({ live: settingIsOn(values.get(REBIRTH_KEYS.live)), priceGold, percent, limit });
    return parsed.success ? parsed.data : REBIRTH_DEFAULT_SETTINGS;
  }

  async saveSettings(settings: RebirthSettings, changedBy: string): Promise<void> {
    // One batch: the four rows and every character's bonus change together or not at all.
    await this.request()
      .input('liveKey', sql.VarChar(40), REBIRTH_KEYS.live)
      .input('liveValue', sql.VarChar(200), String(settings.live))
      .input('priceKey', sql.VarChar(40), REBIRTH_KEYS.priceGold)
      .input('priceValue', sql.VarChar(200), String(settings.priceGold))
      .input('percentKey', sql.VarChar(40), REBIRTH_KEYS.percent)
      .input('percentValue', sql.VarChar(200), String(settings.percent))
      .input('limitKey', sql.VarChar(40), REBIRTH_KEYS.limit)
      .input('limitValue', sql.VarChar(200), String(settings.limit))
      .input('percent', sql.Int, settings.percent)
      .input('limit', sql.Int, settings.limit)
      .input('by', sql.VarChar(50), changedBy)
      .query(
        `SET XACT_ABORT ON;
         BEGIN TRAN;
         MERGE ${this.db.tables.portalSettings} WITH (HOLDLOCK) AS target
         USING (VALUES (@liveKey, @liveValue), (@priceKey, @priceValue), (@percentKey, @percentValue), (@limitKey, @limitValue))
           AS source (szKey, szValue) ON target.szKey = source.szKey
         WHEN MATCHED THEN UPDATE SET szValue = source.szValue, szUpdatedBy = @by, dUpdated = GETDATE()
         WHEN NOT MATCHED THEN INSERT (szKey, szValue, szUpdatedBy) VALUES (source.szKey, source.szValue, @by);
         UPDATE ${this.db.tables.rebirths}
         SET bStatBonus = (CASE WHEN bRebirth < @limit THEN bRebirth ELSE @limit END) * @percent, dUpdate = GETDATE();
         COMMIT;`,
      );
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
