import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbService } from '../../src/db/db.service.js';
import { SqlVendorsRepository } from '../../src/gm/vendors.repository.js';
import { connectTestDb, inRolledBackTransaction } from './db-test-helpers.js';

describe('SqlVendorsRepository against the _TEST copy', () => {
  let db: DbService;
  let repo: SqlVendorsRepository;

  beforeAll(async () => {
    db = await connectTestDb();
    repo = new SqlVendorsRepository(db);
  });

  afterAll(() => db.onModuleDestroy());

  async function literalMatches(text: string) {
    const result = await db.pool
      .request()
      .input('text', sql.NVarChar, text)
      .query<{ id: number }>(
        `SELECT wItemID AS id FROM ${db.tables.items} WHERE CHARINDEX(@text, szNAME) > 0 ORDER BY wItemID`,
      );
    return result.recordset.map((r) => r.id).sort((a, b) => a - b);
  }

  it('lists only vendor types', async () => {
    const vendors = await repo.listVendors();
    expect(vendors.map((v) => v.id)).toContain(20002);
    expect(vendors.map((v) => v.id)).toContain(20757);
    expect(vendors.map((v) => v.id)).not.toContain(22229);
    expect(vendors.every((v) => v.type === 2 || v.type === 21)).toBe(true);
  });

  it('includes a vendor with no stock', async () => {
    const vendor = (await repo.listVendors()).find((v) => v.id === 25300);
    expect(vendor?.itemCount).toBe(0);
  });

  it('blanks a name of underscore', async () => {
    expect((await repo.findVendor(20002))?.title).toBe('');
  });

  it('findVendor returns null for a non-vendor NPC', async () => {
    expect(await repo.findVendor(22229)).toBeNull();
  });

  it('lists stock with the base for the item level', async () => {
    const stock = await repo.listStock(26012);
    const row = stock.find((s) => s.itemId === 4);
    expect(row).toEqual(expect.objectContaining({ level: 5, money: 475, fPrice: 5, stack: 1 }));
    const ids = stock.map((s) => s.itemId);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it('uses the attribute grade as the level', async () => {
    const item = await repo.findItem(551);
    expect(item?.level).toBe(34);
    const base = await db.pool
      .request()
      .query<{ dwMoney: number }>(`SELECT dwMoney FROM ${db.tables.levels} WHERE bLevel = 34`);
    expect(item?.money).toBe(base.recordset[0].dwMoney);
  });

  it('counts only vendors in the sold-by counts', async () => {
    const { npcs, npcItems } = db.tables;
    const result = await db.pool.request().query<{ itemId: number; vendors: number; all: number }>(
      `SELECT TOP 1 ni.dwItemID AS itemId,
              SUM(CASE WHEN n.bType IN (2, 21) THEN 1 ELSE 0 END) AS vendors, COUNT(*) AS [all]
       FROM ${npcItems} ni JOIN ${npcs} n ON n.wID = ni.wNpcID
       GROUP BY ni.dwItemID
       HAVING COUNT(*) > SUM(CASE WHEN n.bType IN (2, 21) THEN 1 ELSE 0 END)
          AND SUM(CASE WHEN n.bType IN (2, 21) THEN 1 ELSE 0 END) > 0`,
    );
    const { itemId, vendors } = result.recordset[0];
    const item = await repo.findItem(itemId);
    expect((item?.moneySoldBy ?? 0) + (item?.pvpSoldBy ?? 0)).toBe(vendors);
  });

  it('splits the sold-by counts by vendor type', async () => {
    const { npcs, npcItems } = db.tables;
    const result = await db.pool.request().query<{ itemId: number; money: number; pvp: number; vendorId: number }>(
      `SELECT TOP 1 ni.dwItemID AS itemId,
              SUM(CASE WHEN n.bType = 2 THEN 1 ELSE 0 END) AS money,
              SUM(CASE WHEN n.bType = 21 THEN 1 ELSE 0 END) AS pvp,
              MIN(n.wID) AS vendorId
       FROM ${npcItems} ni JOIN ${npcs} n ON n.wID = ni.wNpcID
       WHERE n.bType IN (2, 21)
       GROUP BY ni.dwItemID
       HAVING SUM(CASE WHEN n.bType = 2 THEN 1 ELSE 0 END) > 0
          AND SUM(CASE WHEN n.bType = 21 THEN 1 ELSE 0 END) > 0
          AND SUM(CASE WHEN n.bType = 2 THEN 1 ELSE 0 END) <> SUM(CASE WHEN n.bType = 21 THEN 1 ELSE 0 END)`,
    );
    const { itemId, money, pvp, vendorId } = result.recordset[0];
    expect(await repo.findItem(itemId)).toEqual(expect.objectContaining({ moneySoldBy: money, pvpSoldBy: pvp }));
    const row = (await repo.listStock(vendorId)).find((s) => s.itemId === itemId);
    expect(row).toEqual(expect.objectContaining({ moneySoldBy: money, pvpSoldBy: pvp }));
    const found = (await repo.searchItems(String(itemId)))[0];
    expect(found).toEqual(expect.objectContaining({ itemId, moneySoldBy: money, pvpSoldBy: pvp }));
  });

  it('exposes the raw trade flags', async () => {
    const result = await db.pool
      .request()
      .query<{ id: number; flags: number }>(
        `SELECT TOP 1 wItemID AS id, bIsSell AS flags FROM ${db.tables.items} WHERE bIsSell = 5 ORDER BY wItemID`,
      );
    const { id, flags } = result.recordset[0];
    expect((await repo.findItem(id))?.sellFlags).toBe(flags);
  });

  it('adds and removes stock', () =>
    inRolledBackTransaction(db, async (tx) => {
      const free = await new sql.Request(tx).query<{ id: number }>(
        `SELECT TOP 1 wItemID AS id FROM ${db.tables.items} t
         WHERE NOT EXISTS (SELECT 1 FROM ${db.tables.npcItems} WHERE wNpcID = 20002 AND dwItemID = t.wItemID)`,
      );
      const itemId = free.recordset[0].id;
      const r = repo.withTransaction(tx);
      expect(await r.addStock(20002, itemId)).toBe(true);
      expect(await r.addStock(20002, itemId)).toBe(false);
      expect(await r.removeStock(20002, itemId)).toBe(true);
      expect(await r.removeStock(20002, itemId)).toBe(false);
    }));

  it('updates only the chosen price column', () =>
    inRolledBackTransaction(db, async (tx) => {
      const r = repo.withTransaction(tx);
      const before = await r.findItem(8001);
      await r.setPrice(8001, 'fPrice', 75);
      const after = await r.findItem(8001);
      expect(after?.fPrice).toBe(75);
      expect(after?.fPvPrice).toBe(before?.fPvPrice);
    }));

  it('finds an item by exact id first', async () => {
    expect((await repo.searchItems('8001'))[0].itemId).toBe(8001);
  });

  it('treats wildcards in a search as literal text', async () => {
    const found = (await repo.searchItems('%')).map((i) => i.itemId);
    const literal = await literalMatches('%');
    expect(found.length).toBe(Math.min(literal.length, 50));
    expect(found.every((id) => literal.includes(id))).toBe(true);
    expect((await repo.searchItems('Sm_ll Vitality')).length).toBe(0);
    expect((await repo.searchItems('[a-z]')).length).toBe(0);
  });

  it('returns at most 50 results', async () => {
    expect((await repo.searchItems('a')).length).toBe(50);
  });
});
