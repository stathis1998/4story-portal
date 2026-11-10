import { Injectable } from '@nestjs/common';
import sql from 'mssql';
import { DbService } from '../db/db.service.js';

export type MailRecipientRow = { charId: number; name: string };
export type MailItemRow = { itemId: number; name: string; stack: number };
export type MailCharacterRow = MailRecipientRow & { level: number; classCode: number; online: boolean };

export type MailLetter = {
  charId: number;
  sender: string;
  title: string;
  message: string;
  gold: number;
  silver: number;
  copper: number;
  items: { itemId: number; count: number }[]; // 0..3
};

export interface MailRepository {
  findCharacters(names: string[]): Promise<MailRecipientRow[]>; // live characters only, stored spelling
  listCharacters(): Promise<MailCharacterRow[]>; // every live character, by name; online = in TCURRENTUSER
  findItems(itemIds: number[]): Promise<MailItemRow[]>;
  sendLetter(letter: MailLetter): Promise<number>; // the post id, 0 when the character is missing or deleted
}

export const MAIL_REPOSITORY = Symbol('MAIL_REPOSITORY');

const ITEM_SLOTS = 3;

@Injectable()
export class SqlMailRepository implements MailRepository {
  private tx?: sql.Transaction;

  constructor(private readonly db: DbService) {}

  /** Returns a copy whose queries run on tx (used by tests to roll back). */
  withTransaction(tx: sql.Transaction): SqlMailRepository {
    const copy = new SqlMailRepository(this.db);
    copy.tx = tx;
    return copy;
  }

  private request(): sql.Request {
    return this.tx ? new sql.Request(this.tx) : this.db.pool.request();
  }

  async findCharacters(names: string[]): Promise<MailRecipientRow[]> {
    if (names.length === 0) return [];
    const request = this.request();
    names.forEach((name, i) => request.input(`n${i}`, sql.VarChar(50), name));
    const list = names.map((_, i) => `@n${i}`).join(', ');
    const result = await request.query<MailRecipientRow>(
      `SELECT dwCharID AS charId, szName AS name FROM ${this.db.tables.characters}
       WHERE szName IN (${list}) AND bDelete = 0`,
    );
    return result.recordset;
  }

  async listCharacters(): Promise<MailCharacterRow[]> {
    const { characters, currentUsers } = this.db.tables;
    const result = await this.request().query<Omit<MailCharacterRow, 'online'> & { online: number }>(
      `SELECT c.dwCharID AS charId, c.szName AS name, c.bLevel AS level, c.bClass AS classCode,
              CASE WHEN EXISTS (SELECT 1 FROM ${currentUsers} u WHERE u.dwCharID = c.dwCharID) THEN 1 ELSE 0 END AS online
       FROM ${characters} c
       WHERE c.bDelete = 0
       ORDER BY c.szName`,
    );
    return result.recordset.map((row) => ({ ...row, online: row.online === 1 }));
  }

  async findItems(itemIds: number[]): Promise<MailItemRow[]> {
    if (itemIds.length === 0) return [];
    const request = this.request();
    itemIds.forEach((id, i) => request.input(`i${i}`, sql.Int, id));
    const list = itemIds.map((_, i) => `@i${i}`).join(', ');
    const result = await request.query<MailItemRow>(
      `SELECT wItemID AS itemId, CASE WHEN szNAME = '_' THEN '' ELSE szNAME END AS name, bStack AS stack
       FROM ${this.db.tables.items} WHERE wItemID IN (${list})`,
    );
    return result.recordset;
  }

  async sendLetter(letter: MailLetter): Promise<number> {
    const request = this.request()
      .input('charId', sql.Int, letter.charId)
      .input('sender', sql.VarChar(50), letter.sender)
      .input('title', sql.VarChar(240), letter.title)
      .input('message', sql.VarChar(2000), letter.message)
      .input('gold', sql.Int, letter.gold)
      .input('silver', sql.Int, letter.silver)
      .input('copper', sql.Int, letter.copper);
    for (let slot = 0; slot < ITEM_SLOTS; slot++) {
      const item = letter.items[slot];
      request.input(`item${slot + 1}`, sql.SmallInt, item?.itemId ?? 0);
      request.input(`count${slot + 1}`, sql.TinyInt, item?.count ?? 0);
    }
    const result = await request.query<{ postId: number }>(
      `DECLARE @r INT;
       EXEC @r = ${this.db.tables.mailProcedure}
         @pCharID = @charId, @pSender = @sender, @pTitle = @title, @pMessage = @message,
         @dwGold = @gold, @dwSilver = @silver, @dwCooper = @copper,
         @wItemID1 = @item1, @bCount1 = @count1,
         @wItemID2 = @item2, @bCount2 = @count2,
         @wItemID3 = @item3, @bCount3 = @count3;
       SELECT @r AS postId;`,
    );
    return result.recordset[0]?.postId ?? 0;
  }
}
