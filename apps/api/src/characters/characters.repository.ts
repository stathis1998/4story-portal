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

export interface CharactersRepository {
  listByUser(userId: number): Promise<CharacterRow[]>;
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
}
