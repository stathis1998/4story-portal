import { Injectable } from '@nestjs/common';
import sql from 'mssql';
import { DbService } from '../db/db.service.js';

export type AccountRecord = {
  userId: number;
  username: string;
  passwordHash: string;
};

export interface AccountsRepository {
  findByUsername(username: string): Promise<AccountRecord | null>;
  /** Returns the new dwUserID, or null if the username is taken. */
  createAccount(username: string, passwordHash: string): Promise<number | null>;
}

export const ACCOUNTS_REPOSITORY = Symbol('ACCOUNTS_REPOSITORY');

@Injectable()
export class SqlAccountsRepository implements AccountsRepository {
  constructor(private readonly db: DbService) {}

  async findByUsername(username: string): Promise<AccountRecord | null> {
    const result = await this.db.pool
      .request()
      .input('username', sql.VarChar(50), username)
      .query<{ dwUserID: number; szUserID: string; szPasswd: string | null }>(
        `SELECT TOP 1 dwUserID, szUserID, szPasswd FROM ${this.db.tables.accounts} WHERE szUserID = @username`,
      );

    const row = result.recordset[0];
    return row ? { userId: row.dwUserID, username: row.szUserID, passwordHash: row.szPasswd ?? '' } : null;
  }

  createAccount(username: string, passwordHash: string): Promise<number | null> {
    return this.db.withTransaction((tx) => this.createAccountIn(tx, username, passwordHash));
  }

  /**
   * TACCOUNT_PW has no unique index on szUserID, so the UPDLOCK/HOLDLOCK range lock is what keeps
   * two registrations of the same name from both succeeding. It holds until the transaction ends.
   */
  async createAccountIn(tx: sql.Transaction, username: string, passwordHash: string): Promise<number | null> {
    const { accounts, userInfo } = this.db.tables;

    const existing = await new sql.Request(tx)
      .input('username', sql.VarChar(50), username)
      .query(`SELECT dwUserID FROM ${accounts} WITH (UPDLOCK, HOLDLOCK) WHERE szUserID = @username`);
    if (existing.recordset.length > 0) return null;

    const inserted = await new sql.Request(tx)
      .input('username', sql.VarChar(50), username)
      .input('hash', sql.VarChar(255), passwordHash)
      .query<{ id: number }>(
        `INSERT INTO ${accounts} (szUserID, szPasswd, bCheck) VALUES (@username, @hash, 0);
         SELECT CAST(SCOPE_IDENTITY() AS int) AS id;`,
      );
    const userId = inserted.recordset[0].id;

    await new sql.Request(tx)
      .input('userId', sql.Int, userId)
      .query(`INSERT INTO ${userInfo} (dwUserID, bCanCreateCharCount, bAgreement) VALUES (@userId, 6, 1)`);

    return userId;
  }
}
