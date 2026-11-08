import { Injectable } from '@nestjs/common';
import sql from 'mssql';
import { DbService } from '../db/db.service.js';

export type CharacterRow = {
  dwCharID: number;
  bSlot: number;
  szNAME: string;
  bLevel: number;
  bClass: number;
  bRace: number;
  bCountry: number;
  dwGold: number;
  dwSilver: number;
  dwCooper: number;
  wMapID: number;
  dCreateDate: Date | null;
  dLogoutDate: Date | null;
};

export type LevelFreezeRow = {
  level: number;
  freezeLevel: number | null;
  online: boolean;
};

export interface CharactersRepository {
  listByUser(userId: number): Promise<CharacterRow[]>;
  /** Null unless the character exists, isn't deleted and belongs to this account. */
  findLevelFreeze(userId: number, charId: number): Promise<LevelFreezeRow | null>;
  /** A null level removes the freeze. */
  saveLevelFreeze(charId: number, level: number | null): Promise<void>;
}

export const CHARACTERS_REPOSITORY = Symbol('CHARACTERS_REPOSITORY');

@Injectable()
export class SqlCharactersRepository implements CharactersRepository {
  constructor(private readonly db: DbService) {}

  async listByUser(userId: number): Promise<CharacterRow[]> {
    const result = await this.db.pool
      .request()
      .input('userId', sql.Int, userId)
      .query<CharacterRow>(
        `SELECT dwCharID, bSlot, szNAME, bLevel, bClass, bRace, bCountry, dwGold, dwSilver, dwCooper,
                wMapID, dCreateDate, dLogoutDate
         FROM ${this.db.tables.characters}
         WHERE dwUserID = @userId AND bDelete = 0
         ORDER BY bSlot`,
      );
    return result.recordset;
  }

  async findLevelFreeze(userId: number, charId: number): Promise<LevelFreezeRow | null> {
    const { characters, levelFreezes, currentUsers } = this.db.tables;
    const result = await this.db.pool
      .request()
      .input('userId', sql.Int, userId)
      .input('charId', sql.Int, charId)
      .query<LevelFreezeRow>(
        `SELECT c.bLevel AS level, f.bFreezeLevel AS freezeLevel,
                CAST(CASE WHEN EXISTS (SELECT 1 FROM ${currentUsers} u WHERE u.dwCharID = c.dwCharID)
                          THEN 1 ELSE 0 END AS bit) AS online
         FROM ${characters} c
         LEFT JOIN ${levelFreezes} f ON f.dwCharID = c.dwCharID
         WHERE c.dwCharID = @charId AND c.dwUserID = @userId AND c.bDelete = 0`,
      );
    return result.recordset[0] ?? null;
  }

  async saveLevelFreeze(charId: number, level: number | null): Promise<void> {
    const { levelFreezes } = this.db.tables;
    const request = this.db.pool.request().input('charId', sql.Int, charId);
    if (level === null) {
      await request.query(`DELETE FROM ${levelFreezes} WHERE dwCharID = @charId`);
      return;
    }
    // HOLDLOCK so a double click can't make two inserts race on the primary key.
    await request.input('level', sql.TinyInt, level).query(
      `MERGE ${levelFreezes} WITH (HOLDLOCK) AS t
       USING (SELECT @charId AS dwCharID) AS s ON t.dwCharID = s.dwCharID
       WHEN MATCHED THEN UPDATE SET bFreezeLevel = @level, dUpdate = GETDATE()
       WHEN NOT MATCHED THEN INSERT (dwCharID, bFreezeLevel) VALUES (@charId, @level);`,
    );
  }
}
