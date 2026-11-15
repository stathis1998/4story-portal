import type { Wallet } from '@4story-portal/shared';
import { Injectable } from '@nestjs/common';
import sql from 'mssql';
import { DbService } from '../db/db.service.js';
import { REBIRTH_OK, type RebirthCode, rebirthSql } from './rebirth-sql.js';

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
                (SELECT COUNT(*) FROM ${t.characterItems} i
                 WHERE i.dwOwnerID = c.dwCharID AND i.bOwnerType = 0 AND i.bStorageType = 0 AND i.dwStorageID = 254) AS wornItems,
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
}
