import { Injectable } from '@nestjs/common';
import sql from 'mssql';
import { DbService } from '../db/db.service.js';

export const VENDOR_TYPES = { money: 2, pvp: 21 } as const;

export type VendorRow = {
  id: number;
  name: string;
  title: string;
  type: number;
  country: number;
  condition: number;
  mapId: number;
  itemCount: number;
};

export type ItemRow = {
  itemId: number;
  name: string;
  level: number;
  stack: number;
  classMask: number;
  itemCountry: number;
  money: number;
  pvpMoney: number;
  fPrice: number;
  fPvPrice: number;
  sellFlags: number; // TITEMCHART.bIsSell, the game's ITEMTRADE_ bits
  moneySoldBy: number; // type 2 vendors selling the item
  pvpSoldBy: number; // type 21 vendors selling the item
};

/** A row whose item is not in TITEMCHART has name null and zeros for the rest. */
export type StockRow = Omit<ItemRow, 'name'> & { name: string | null };

export type PriceColumn = 'fPrice' | 'fPvPrice';

export interface VendorsRepository {
  listVendors(): Promise<VendorRow[]>;
  findVendor(id: number): Promise<VendorRow | null>; // vendors only
  listStock(vendorId: number): Promise<StockRow[]>; // ordered by item id, the order the game shows
  findItem(itemId: number): Promise<ItemRow | null>;
  searchItems(q: string): Promise<ItemRow[]>; // up to 50, exact id first, then by name
  addStock(vendorId: number, itemId: number): Promise<boolean>; // false when already sold
  removeStock(vendorId: number, itemId: number): Promise<boolean>; // false when not sold
  setPrice(itemId: number, column: PriceColumn, multiplier: number): Promise<void>;
}

export const VENDORS_REPOSITORY = Symbol('VENDORS_REPOSITORY');

const VENDOR_TYPE_LIST = `${VENDOR_TYPES.money}, ${VENDOR_TYPES.pvp}`;
const NAME = "CASE WHEN t.szNAME = '_' THEN '' ELSE t.szNAME END";
// Largest value of an int parameter; a longer all-digit search is not an item id.
const INT_MAX = 2147483647;

@Injectable()
export class SqlVendorsRepository implements VendorsRepository {
  private tx?: sql.Transaction;

  constructor(private readonly db: DbService) {}

  /** Returns a copy whose queries run on tx (used by tests to roll back). */
  withTransaction(tx: sql.Transaction): SqlVendorsRepository {
    const copy = new SqlVendorsRepository(this.db);
    copy.tx = tx;
    return copy;
  }

  private request(): sql.Request {
    return this.tx ? new sql.Request(this.tx) : this.db.pool.request();
  }

  private vendorSelect(): string {
    const { npcs, npcItems } = this.db.tables;
    return `SELECT n.wID AS id,
                   CASE WHEN n.szName = '_' THEN '' ELSE n.szName END AS name,
                   CASE WHEN n.NC_szName2 = '_' THEN '' ELSE n.NC_szName2 END AS title,
                   n.bType AS type, n.bCountryID AS country, n.bCondition AS condition, n.wMapID AS mapId,
                   (SELECT COUNT(*) FROM ${npcItems} ni WHERE ni.wNpcID = n.wID) AS itemCount
            FROM ${npcs} n
            WHERE n.bType IN (${VENDOR_TYPE_LIST})`;
  }

  async listVendors(): Promise<VendorRow[]> {
    const result = await this.request().query<VendorRow>(`${this.vendorSelect()} ORDER BY n.wID`);
    return result.recordset;
  }

  async findVendor(id: number): Promise<VendorRow | null> {
    const result = await this.request()
      .input('id', sql.Int, id)
      .query<VendorRow>(`${this.vendorSelect()} AND n.wID = @id`);
    return result.recordset[0] ?? null;
  }

  /**
   * Item columns from TITEMCHART alias t (LEFT JOINed to TITEMATTRCHART alias a), with idExpr as the item id.
   * Every column is null-safe so a stock row with no TITEMCHART row comes back as zeros.
   */
  private itemColumns(idExpr: string, nameExpr: string): string {
    const { npcs, npcItems, levels } = this.db.tables;
    const soldBy = (type: number) =>
      `(SELECT COUNT(*) FROM ${npcItems} ni JOIN ${npcs} n ON n.wID = ni.wNpcID
        WHERE ni.dwItemID = ${idExpr} AND n.bType = ${type})`;
    const level = 'ISNULL(CASE WHEN t.wAttrID <> 0 THEN ISNULL(a.bGrade, 0) ELSE t.bLevel END, 0)';
    return `${idExpr} AS itemId, ${nameExpr} AS name, ${level} AS level,
            ISNULL(t.bStack, 0) AS stack, ISNULL(t.dwClassID, 0) AS classMask, ISNULL(t.bItemCountry, 0) AS itemCountry,
            ISNULL((SELECT l.dwMoney FROM ${levels} l WHERE l.bLevel = ${level}), 0) AS money,
            ISNULL((SELECT l.dwPvPMoney FROM ${levels} l WHERE l.bLevel = ${level}), 0) AS pvpMoney,
            ISNULL(t.fPrice, 0) AS fPrice, ISNULL(t.fPvPrice, 0) AS fPvPrice, ISNULL(t.bIsSell, 0) AS sellFlags,
            ${soldBy(VENDOR_TYPES.money)} AS moneySoldBy, ${soldBy(VENDOR_TYPES.pvp)} AS pvpSoldBy`;
  }

  async listStock(vendorId: number): Promise<StockRow[]> {
    const { npcItems, items, itemAttrs } = this.db.tables;
    const result = await this.request()
      .input('vendor', sql.Int, vendorId)
      .query<StockRow>(
        `SELECT ${this.itemColumns('s.dwItemID', `CASE WHEN t.wItemID IS NULL THEN NULL ELSE ${NAME} END`)}
         FROM ${npcItems} s
         LEFT JOIN ${items} t ON t.wItemID = s.dwItemID
         LEFT JOIN ${itemAttrs} a ON a.wID = t.wAttrID
         WHERE s.wNpcID = @vendor
         ORDER BY s.dwItemID`,
      );
    return result.recordset;
  }

  async findItem(itemId: number): Promise<ItemRow | null> {
    const { items, itemAttrs } = this.db.tables;
    const result = await this.request()
      .input('id', sql.Int, itemId)
      .query<ItemRow>(
        `SELECT ${this.itemColumns('t.wItemID', NAME)}
         FROM ${items} t
         LEFT JOIN ${itemAttrs} a ON a.wID = t.wAttrID
         WHERE t.wItemID = @id`,
      );
    return result.recordset[0] ?? null;
  }

  async searchItems(q: string): Promise<ItemRow[]> {
    const { items, itemAttrs } = this.db.tables;
    const escaped = q.replace(/[\\%_[]/g, (c) => `\\${c}`);
    const byId = /^\d+$/.test(q) && Number(q) <= INT_MAX;
    const request = this.request().input('q', sql.NVarChar, `%${escaped}%`);
    if (byId) request.input('id', sql.Int, Number(q));
    const result = await request.query<ItemRow>(
      `SELECT TOP 50 ${this.itemColumns('t.wItemID', NAME)}
       FROM ${items} t
       LEFT JOIN ${itemAttrs} a ON a.wID = t.wAttrID
       WHERE t.szNAME LIKE @q ESCAPE '\\'${byId ? ' OR t.wItemID = @id' : ''}
       ORDER BY ${byId ? 'CASE WHEN t.wItemID = @id THEN 0 ELSE 1 END, ' : ''}t.szNAME, t.wItemID`,
    );
    return result.recordset;
  }

  async addStock(vendorId: number, itemId: number): Promise<boolean> {
    try {
      await this.request()
        .input('vendor', sql.Int, vendorId)
        .input('item', sql.Int, itemId)
        .query(`INSERT INTO ${this.db.tables.npcItems} (wNpcID, dwItemID) VALUES (@vendor, @item)`);
      return true;
    } catch (error) {
      // 2627: primary key violation, the vendor already sells the item.
      if ((error as { number?: number }).number === 2627) return false;
      throw error;
    }
  }

  async removeStock(vendorId: number, itemId: number): Promise<boolean> {
    const result = await this.request()
      .input('vendor', sql.Int, vendorId)
      .input('item', sql.Int, itemId)
      .query(`DELETE FROM ${this.db.tables.npcItems} WHERE wNpcID = @vendor AND dwItemID = @item`);
    return result.rowsAffected[0] > 0;
  }

  async setPrice(itemId: number, column: PriceColumn, multiplier: number): Promise<void> {
    // The column is interpolated, so refuse anything but the two known names.
    if (column !== 'fPrice' && column !== 'fPvPrice') throw new Error(`Unknown price column ${String(column)}`);
    await this.request()
      .input('item', sql.Int, itemId)
      .input('multiplier', sql.Float, multiplier)
      .query(`UPDATE ${this.db.tables.items} SET ${column} = @multiplier WHERE wItemID = @item`);
  }
}
