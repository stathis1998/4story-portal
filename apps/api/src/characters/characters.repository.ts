import { Injectable } from '@nestjs/common';
import { type GearEffect, MIN_GRADE_EFFECT_LEVEL } from '@4story-portal/shared';
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

export type GearEffectRow = GearEffect;

export interface CharactersRepository {
  listByUser(userId: number): Promise<CharacterRow[]>;
  /** Null unless the character exists, isn't deleted and belongs to this account. */
  findLevelFreeze(userId: number, charId: number): Promise<LevelFreezeRow | null>;
  /** A null level removes the freeze. */
  saveLevelFreeze(charId: number, level: number | null): Promise<void>;
  /** Null unless the character exists, isn't deleted and belongs to this account. */
  findGearEffect(userId: number, charId: number): Promise<GearEffectRow | null>;
  /** Sets the effect on every worn item that can carry one, unless the character is online. Returns how many changed. */
  saveGearEffect(charId: number, effect: number): Promise<number>;
}

// TMapSvr CSHandler.cpp, IK_CHGGRADEEFFECT: an effect needs +17, and cloaks (19) and kind 90 never take one.
const NO_EFFECT_KINDS = '19, 90';
const INVEN_EQUIP = 254; // NetCode.h
const STORAGE_INVEN = 0;
const TOWNER_CHAR = 0;

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

  async findGearEffect(userId: number, charId: number): Promise<GearEffectRow | null> {
    const { characters, characterItems, items, currentUsers } = this.db.tables;
    const result = await this.db.pool
      .request()
      .input('userId', sql.Int, userId)
      .input('charId', sql.Int, charId)
      .query<{ online: boolean; slot: number | null; itemId: number | null; name: string | null; upgrade: number | null; effect: number | null }>(
        `SELECT CAST(CASE WHEN EXISTS (SELECT 1 FROM ${currentUsers} u WHERE u.dwCharID = c.dwCharID)
                          THEN 1 ELSE 0 END AS bit) AS online,
                i.bItemID AS slot, i.wItemID AS itemId, chart.szNAME AS name, i.bLevel AS upgrade, i.bGradeEffect AS effect
         FROM ${characters} c
         LEFT JOIN (${characterItems} i
                    JOIN ${items} chart ON chart.wItemID = i.wItemID AND chart.bKind NOT IN (${NO_EFFECT_KINDS}))
           ON i.dwOwnerID = c.dwCharID AND i.bOwnerType = ${TOWNER_CHAR} AND i.bStorageType = ${STORAGE_INVEN}
              AND i.dwStorageID = ${INVEN_EQUIP} AND i.bLevel >= ${MIN_GRADE_EFFECT_LEVEL}
         WHERE c.dwCharID = @charId AND c.dwUserID = @userId AND c.bDelete = 0
         ORDER BY i.bItemID`,
      );
    const rows = result.recordset;
    if (rows.length === 0) return null;
    return {
      online: rows[0].online,
      items: rows
        .filter((row) => row.slot !== null)
        .map((row) => ({ slot: row.slot!, itemId: row.itemId!, name: row.name!, upgrade: row.upgrade!, effect: row.effect! })),
    };
  }

  async saveGearEffect(charId: number, effect: number): Promise<number> {
    const { characterItems, items, currentUsers } = this.db.tables;
    // The online check sits in the same statement, so a login can't slip in between check and write.
    const result = await this.db.pool
      .request()
      .input('charId', sql.Int, charId)
      .input('effect', sql.TinyInt, effect)
      .query(
        `UPDATE i SET bGradeEffect = @effect
         FROM ${characterItems} i
         JOIN ${items} chart ON chart.wItemID = i.wItemID AND chart.bKind NOT IN (${NO_EFFECT_KINDS})
         WHERE i.dwOwnerID = @charId AND i.bOwnerType = ${TOWNER_CHAR} AND i.bStorageType = ${STORAGE_INVEN}
           AND i.dwStorageID = ${INVEN_EQUIP} AND i.bLevel >= ${MIN_GRADE_EFFECT_LEVEL}
           AND NOT EXISTS (SELECT 1 FROM ${currentUsers} u WHERE u.dwCharID = @charId)`,
      );
    return result.rowsAffected[0] ?? 0;
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
