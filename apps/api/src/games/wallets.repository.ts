import type { WalletCharacter } from '@4story-portal/shared';
import { Injectable } from '@nestjs/common';
import sql from 'mssql';
import { className } from '../characters/character-codes.js';
import { DbService } from '../db/db.service.js';
import { walletCharactersSql } from './wallet-bet.js';

export type WalletCharacterRow = {
  charId: number;
  name: string;
  level: number;
  classCode: number;
  gold: number;
  silver: number;
  copper: number;
  online: boolean;
};

/** The wallets a game can bet from: every game shows the same list, so it lives here rather than in one of them. */
export interface WalletsRepository {
  characters(userId: number): Promise<WalletCharacterRow[]>;
}

export const WALLETS_REPOSITORY = Symbol('WALLETS_REPOSITORY');

@Injectable()
export class SqlWalletsRepository implements WalletsRepository {
  private tx?: sql.Transaction;

  constructor(private readonly db: DbService) {}

  /** Returns a copy whose queries run on tx (used by tests to roll back). */
  withTransaction(tx: sql.Transaction): SqlWalletsRepository {
    const copy = new SqlWalletsRepository(this.db);
    copy.tx = tx;
    return copy;
  }

  private request(): sql.Request {
    return this.tx ? new sql.Request(this.tx) : this.db.pool.request();
  }

  async characters(userId: number): Promise<WalletCharacterRow[]> {
    const result = await this.request().input('userId', sql.Int, userId).query<WalletCharacterRow>(walletCharactersSql(this.db.tables));
    return result.recordset;
  }
}

/** The row as pages show it. */
export const walletCharacterView = (row: WalletCharacterRow): WalletCharacter => ({
  id: row.charId,
  name: row.name,
  level: row.level,
  className: className(row.classCode),
  online: row.online,
  wallet: { gold: row.gold, silver: row.silver, copper: row.copper },
});
