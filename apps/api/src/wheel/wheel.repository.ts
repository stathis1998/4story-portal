import { Injectable } from '@nestjs/common';
import sql from 'mssql';
import { DbService } from '../db/db.service.js';

export type WheelItem = { itemId: number; count: number };

/** What a prize pays, in the shape of one letter. */
export type WheelReward = { gold: number; silver: number; copper: number; items: WheelItem[] };

/** A prize as a GM saves it. */
export type PrizeInput = WheelReward & { name: string; weight: number; order: number; enabled: boolean; announce: boolean };

/** A row of TPORTALWHEELPRIZE. */
export type PrizeRow = PrizeInput & { id: number };

/** A row of TPORTALWHEELSPINTABLE. */
export type SpinRow = WheelReward & {
  id: number;
  userId: number;
  charId: number;
  character: string;
  /** The server's wall clock, held as UTC like every date the driver returns. */
  spunAt: Date;
  /** How long ago that was, by the database's own clock. */
  ageSeconds: number;
  prizeId: number;
  prize: string;
  /** The line announced in game. */
  text: string;
  announce: boolean;
  announced: number;
};

export type SpinInput = {
  userId: number;
  charId: number;
  prizeId: number;
  minLevel: number;
  sender: string;
  /** `{prize}` and `{name}` are filled in by the database, which holds both. */
  title: string;
  message: string;
  text: string;
};

export const SPIN_ALREADY_TODAY = 0;
export const SPIN_BAD_CHARACTER = -1;
export const SPIN_SWITCHED_OFF = -2;
export const SPIN_PRIZE_GONE = -3;

export const ANNOUNCE_WAITING = 0;
export const ANNOUNCE_SENT = 1;
export const ANNOUNCE_SKIPPED = 2;

export type WheelItemRow = { itemId: number; name: string; stack: number };

export interface WheelRepository {
  /** Whether players can spin. One switch for every portal process on this database. */
  live(): Promise<boolean>;
  setLive(live: boolean, changedBy: string): Promise<void>;
  /** Every prize, disabled ones too, in wheel order. */
  prizes(): Promise<PrizeRow[]>;
  createPrize(prize: PrizeInput, changedBy: string): Promise<number>;
  /** False when there is no such prize. */
  updatePrize(id: number, prize: PrizeInput, changedBy: string): Promise<boolean>;
  deletePrize(id: number): Promise<boolean>;
  /**
   * Checks the spin is allowed, sends the character the prize's letter and records the spin, together.
   * The new spin's ID, or one of the SPIN_* results when nothing was written.
   */
  spin(input: SpinInput): Promise<number>;
  /** The account's spin today, if it has made one, by the database's own date. */
  today(userId: number): Promise<SpinRow | null>;
  /** Seconds until midnight on the database's clock. */
  secondsToReset(): Promise<number>;
  /** The account's latest spins, newest first. */
  spinsOf(userId: number, limit: number): Promise<SpinRow[]>;
  /** The latest spins whose prize is an announced one, newest first. */
  winners(limit: number): Promise<SpinRow[]>;
  spinsToday(): Promise<number>;
  /** Announced prizes not said in game yet, oldest first. */
  waitingAnnouncements(): Promise<SpinRow[]>;
  /** Takes a waiting announcement for sending. False when another tick or process already has. */
  claimAnnouncement(id: number): Promise<boolean>;
  markAnnounced(id: number, state: number): Promise<void>;
  findItems(itemIds: number[]): Promise<WheelItemRow[]>;
}

export const WHEEL_REPOSITORY = Symbol('WHEEL_REPOSITORY');

const ITEM_SLOTS = [1, 2, 3] as const;
const LIVE_KEY = 'wheel_live';

type Slots = Record<`item${1 | 2 | 3}` | `count${1 | 2 | 3}`, number>;
type RawPrize = Omit<PrizeRow, 'items' | 'enabled' | 'announce'> & Slots & { enabled: number; announce: number };
type RawSpin = Omit<SpinRow, 'items' | 'announce'> & { itemList: string; announce: number };

const slotItems = (slots: Slots): WheelItem[] =>
  ITEM_SLOTS.flatMap((slot) => (slots[`item${slot}`] ? [{ itemId: slots[`item${slot}`], count: slots[`count${slot}`] }] : []));

/** `7602x5,7654x1`, the way the spin table keeps what a letter carried. */
export const parseItemList = (list: string): WheelItem[] =>
  list
    .split(',')
    .filter(Boolean)
    .map((entry) => {
      const [itemId, count] = entry.split('x').map(Number);
      return { itemId, count };
    });

export const isEmptyReward = (reward: WheelReward) => reward.gold + reward.silver + reward.copper === 0 && reward.items.length === 0;

@Injectable()
export class SqlWheelRepository implements WheelRepository {
  private tx?: sql.Transaction;

  constructor(private readonly db: DbService) {}

  /** Returns a copy whose queries run on tx (used by tests to roll back). */
  withTransaction(tx: sql.Transaction): SqlWheelRepository {
    const copy = new SqlWheelRepository(this.db);
    copy.tx = tx;
    return copy;
  }

  private request(): sql.Request {
    return this.tx ? new sql.Request(this.tx) : this.db.pool.request();
  }

  async live(): Promise<boolean> {
    const result = await this.request()
      .input('key', sql.VarChar(40), LIVE_KEY)
      .query<{ value: string }>(`SELECT szValue AS value FROM ${this.db.tables.portalSettings} WHERE szKey = @key`);
    return result.recordset[0]?.value === 'true';
  }

  async setLive(live: boolean, changedBy: string): Promise<void> {
    await this.request()
      .input('key', sql.VarChar(40), LIVE_KEY)
      .input('value', sql.VarChar(200), String(live))
      .input('by', sql.VarChar(50), changedBy)
      .query(
        `MERGE ${this.db.tables.portalSettings} WITH (HOLDLOCK) AS target
         USING (SELECT @key AS szKey) AS source ON target.szKey = source.szKey
         WHEN MATCHED THEN UPDATE SET szValue = @value, szUpdatedBy = @by, dUpdated = GETDATE()
         WHEN NOT MATCHED THEN INSERT (szKey, szValue, szUpdatedBy) VALUES (@key, @value, @by);`,
      );
  }

  async prizes(): Promise<PrizeRow[]> {
    const result = await this.request().query<RawPrize>(
      `SELECT dwID AS id, szName AS name, wWeight AS weight, wOrder AS [order], bEnabled AS enabled, bAnnounce AS announce,
              dwGold AS gold, dwSilver AS silver, dwCooper AS copper,
              wItemID1 AS item1, bCount1 AS count1, wItemID2 AS item2, bCount2 AS count2, wItemID3 AS item3, bCount3 AS count3
       FROM ${this.db.tables.wheelPrizes}
       ORDER BY wOrder, dwID`,
    );
    return result.recordset.map(({ id, name, weight, order, enabled, announce, gold, silver, copper, ...slots }) => ({
      id,
      name,
      weight,
      order,
      enabled: enabled === 1,
      announce: announce === 1,
      gold,
      silver,
      copper,
      items: slotItems(slots),
    }));
  }

  private prizeRequest(prize: PrizeInput, changedBy: string): sql.Request {
    const request = this.request()
      .input('name', sql.VarChar(40), prize.name)
      .input('weight', sql.SmallInt, prize.weight)
      .input('order', sql.SmallInt, prize.order)
      .input('enabled', sql.TinyInt, prize.enabled ? 1 : 0)
      .input('announce', sql.TinyInt, prize.announce ? 1 : 0)
      .input('gold', sql.Int, prize.gold)
      .input('silver', sql.Int, prize.silver)
      .input('copper', sql.Int, prize.copper)
      .input('by', sql.VarChar(50), changedBy);
    for (const slot of ITEM_SLOTS) {
      const item = prize.items[slot - 1];
      request.input(`item${slot}`, sql.SmallInt, item?.itemId ?? 0);
      request.input(`count${slot}`, sql.TinyInt, item?.count ?? 0);
    }
    return request;
  }

  async createPrize(prize: PrizeInput, changedBy: string): Promise<number> {
    const result = await this.prizeRequest(prize, changedBy).query<{ id: number }>(
      `INSERT INTO ${this.db.tables.wheelPrizes}
         (szName, wWeight, wOrder, bEnabled, bAnnounce, dwGold, dwSilver, dwCooper,
          wItemID1, bCount1, wItemID2, bCount2, wItemID3, bCount3, szUpdatedBy)
       VALUES (@name, @weight, @order, @enabled, @announce, @gold, @silver, @copper,
          @item1, @count1, @item2, @count2, @item3, @count3, @by);
       SELECT CAST(SCOPE_IDENTITY() AS INT) AS id;`,
    );
    return result.recordset[0].id;
  }

  async updatePrize(id: number, prize: PrizeInput, changedBy: string): Promise<boolean> {
    const result = await this.prizeRequest(prize, changedBy)
      .input('id', sql.Int, id)
      .query(
        `UPDATE ${this.db.tables.wheelPrizes} SET
           szName = @name, wWeight = @weight, wOrder = @order, bEnabled = @enabled, bAnnounce = @announce,
           dwGold = @gold, dwSilver = @silver, dwCooper = @copper,
           wItemID1 = @item1, bCount1 = @count1, wItemID2 = @item2, bCount2 = @count2, wItemID3 = @item3, bCount3 = @count3,
           szUpdatedBy = @by, dUpdated = GETDATE()
         WHERE dwID = @id`,
      );
    return result.rowsAffected[0] === 1;
  }

  async deletePrize(id: number): Promise<boolean> {
    const result = await this.request().input('id', sql.Int, id).query(`DELETE FROM ${this.db.tables.wheelPrizes} WHERE dwID = @id`);
    return result.rowsAffected[0] === 1;
  }

  async spin(input: SpinInput): Promise<number> {
    const result = await this.request()
      .input('userId', sql.Int, input.userId)
      .input('charId', sql.Int, input.charId)
      .input('prizeId', sql.Int, input.prizeId)
      .input('minLevel', sql.TinyInt, input.minLevel)
      .input('sender', sql.VarChar(50), input.sender)
      .input('title', sql.VarChar(200), input.title)
      .input('message', sql.VarChar(1800), input.message)
      .input('text', sql.VarChar(160), input.text)
      .query<{ id: number }>(
        `DECLARE @r INT;
         EXEC @r = ${this.db.tables.wheelProcedure}
           @dwUserID = @userId, @dwCharID = @charId, @dwPrizeID = @prizeId, @bMinLevel = @minLevel,
           @pSender = @sender, @pTitle = @title, @pMessage = @message, @szText = @text;
         SELECT @r AS id;`,
      );
    return result.recordset[0]?.id ?? SPIN_BAD_CHARACTER;
  }

  private async spins(top: number, where: string, order: string, bind: (request: sql.Request) => sql.Request = (r) => r): Promise<SpinRow[]> {
    const result = await bind(this.request())
      .input('top', sql.Int, top)
      .query<RawSpin>(
        `SELECT TOP (@top) dwID AS id, dwUserID AS userId, dwCharID AS charId, szCharName AS character,
                dSpun AS spunAt, DATEDIFF(second, dSpun, GETDATE()) AS ageSeconds, dwPrizeID AS prizeId, szPrize AS prize,
                dwGold AS gold, dwSilver AS silver, dwCooper AS copper, szItems AS itemList, szText AS text,
                bAnnounce AS announce, bAnnounced AS announced
         FROM ${this.db.tables.wheelSpins}
         WHERE ${where}
         ORDER BY ${order}`,
      );
    return result.recordset.map(({ itemList, announce, ...row }) => ({ ...row, announce: announce === 1, items: parseItemList(itemList) }));
  }

  async today(userId: number): Promise<SpinRow | null> {
    const rows = await this.spins(1, 'dwUserID = @userId AND dDay = CAST(GETDATE() AS DATE)', 'dwID DESC', (r) => r.input('userId', sql.Int, userId));
    return rows[0] ?? null;
  }

  async secondsToReset(): Promise<number> {
    const result = await this.request().query<{ seconds: number }>(
      `SELECT DATEDIFF(second, GETDATE(), DATEADD(day, 1, CAST(CAST(GETDATE() AS DATE) AS DATETIME))) AS seconds`,
    );
    return result.recordset[0].seconds;
  }

  spinsOf(userId: number, limit: number): Promise<SpinRow[]> {
    return this.spins(limit, 'dwUserID = @userId', 'dwID DESC', (r) => r.input('userId', sql.Int, userId));
  }

  winners(limit: number): Promise<SpinRow[]> {
    return this.spins(limit, 'bAnnounce = 1', 'dwID DESC');
  }

  async spinsToday(): Promise<number> {
    const result = await this.request().query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ${this.db.tables.wheelSpins} WHERE dDay = CAST(GETDATE() AS DATE)`,
    );
    return result.recordset[0].n;
  }

  waitingAnnouncements(): Promise<SpinRow[]> {
    return this.spins(50, `bAnnounce = 1 AND bAnnounced = ${ANNOUNCE_WAITING}`, 'dwID');
  }

  async claimAnnouncement(id: number): Promise<boolean> {
    const result = await this.request()
      .input('id', sql.Int, id)
      .query(`UPDATE ${this.db.tables.wheelSpins} SET bAnnounced = ${ANNOUNCE_SENT} WHERE dwID = @id AND bAnnounced = ${ANNOUNCE_WAITING}`);
    return result.rowsAffected[0] === 1;
  }

  async markAnnounced(id: number, state: number): Promise<void> {
    await this.request()
      .input('id', sql.Int, id)
      .input('state', sql.TinyInt, state)
      .query(`UPDATE ${this.db.tables.wheelSpins} SET bAnnounced = @state WHERE dwID = @id`);
  }

  async findItems(itemIds: number[]): Promise<WheelItemRow[]> {
    if (itemIds.length === 0) return [];
    const request = this.request();
    itemIds.forEach((id, i) => request.input(`i${i}`, sql.Int, id));
    const list = itemIds.map((_, i) => `@i${i}`).join(', ');
    const result = await request.query<WheelItemRow>(
      `SELECT wItemID AS itemId, CASE WHEN szNAME = '_' THEN '' ELSE szNAME END AS name, bStack AS stack
       FROM ${this.db.tables.items} WHERE wItemID IN (${list})`,
    );
    return result.recordset;
  }
}
