import { beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/config.js';
import { itemIcons, npcFaces } from '../src/gm/game-icons.generated.js';
import { MAP_NAMES } from '../src/gm/game-places.generated.js';
import { shopOverflow, VendorsService } from '../src/gm/vendors.service.js';
import type { ItemRow, VendorRow } from '../src/gm/vendors.repository.js';
import { FakeGmRepository, FakeVendorsRepository } from './fakes.js';
import { validEnv } from './fixtures.js';

const actor = { username: 'moose', ip: '10.0.0.1' };

const vendor = (overrides: Partial<VendorRow> = {}): VendorRow => ({
  id: 20002, name: 'Mr Bab', title: 'Potions', type: 2, country: 0, condition: 0, mapId: 0, itemCount: 0, ...overrides,
});

const item = (overrides: Partial<ItemRow> = {}): ItemRow => ({
  itemId: 8001, name: 'Small Vitality Potion', level: 1, stack: 1, classMask: 0b111111, itemCountry: 3,
  money: 1, pvpMoney: 1, fPrice: 50, fPvPrice: 0, soldBy: 12, ...overrides,
});

let repo: FakeVendorsRepository;
let gm: FakeGmRepository;
let service: VendorsService;

beforeEach(() => {
  repo = new FakeVendorsRepository();
  gm = new FakeGmRepository();
  service = new VendorsService(repo, gm, loadConfig(validEnv));
  repo.vendors = [vendor()];
  repo.items = [item()];
});

describe('list', () => {
  it('reports the database, shop type, country name, map name and face', async () => {
    const { database, vendors } = await service.list();
    expect(database).toBe('TGAME_GSP_TEST');
    expect(vendors[0]).toMatchObject({
      id: 20002, shop: 'money', country: 'Defugel', mapName: MAP_NAMES[0], faceIcon: npcFaces[20002],
    });
  });

  it('gives a null face to an NPC not in the lookup', async () => {
    repo.vendors = [vendor({ id: 1, type: 21 })];
    const { vendors } = await service.list();
    expect(vendors[0]).toMatchObject({ shop: 'pvp', faceIcon: null });
  });
});

describe('stock', () => {
  it('uses money for a money shop', async () => {
    repo.items = [item({ money: 475, fPrice: 5 })];
    repo.stock.set(20002, [8001]);
    expect(await service.stock(20002)).toEqual([
      { itemId: 8001, name: 'Small Vitality Potion', level: 1, icon: itemIcons[8001], base: 475, multiplier: 5, price: 2375, soldBy: 12 },
    ]);
  });

  it('uses PvP values for a PvP shop', async () => {
    repo.vendors = [vendor({ type: 21 })];
    repo.items = [item({ money: 475, fPrice: 5, pvpMoney: 2, fPvPrice: 75 })];
    repo.stock.set(20002, [8001]);
    expect(await service.stock(20002)).toMatchObject([{ base: 2, multiplier: 75, price: 150 }]);
  });

  it('shows an unknown item with a null name, a null icon and price 0', async () => {
    repo.stock.set(20002, [60]);
    expect(await service.stock(20002)).toMatchObject([{ itemId: 60, name: null, icon: null, price: 0 }]);
  });

  it('404s for a non-vendor', () => expect(service.stock(1)).rejects.toThrow('That NPC is not a vendor'));
});

describe('addItem', () => {
  it('adds and audits', async () => {
    const added = await service.addItem(20002, 8001, actor);
    expect(added).toMatchObject({ itemId: 8001, name: 'Small Vitality Potion' });
    expect(repo.stock.get(20002)).toEqual([8001]);
    expect(gm.audits).toEqual([
      expect.objectContaining({ command: 'VENDORADD', gmId: 'moose', ip: '10.0.0.1', log: 'Mr Bab (20002): +8001 Small Vitality Potion' }),
    ]);
  });

  it('rejects a non-vendor with 404', () =>
    expect(service.addItem(1, 8001, actor)).rejects.toMatchObject({ status: 404, message: 'That NPC is not a vendor' }));

  it('rejects an item not in the client with 422', async () => {
    await expect(service.addItem(20002, 60, actor)).rejects.toMatchObject({
      status: 422,
      message: 'Not in the game client, adding it would crash players opening this shop',
    });
    expect(repo.stock.size).toBe(0);
  });

  it('rejects an item not in the database with 422', () => {
    repo.items = [];
    return expect(service.addItem(20002, 8001, actor)).rejects.toMatchObject({
      status: 422,
      message: 'Not in the game database, the server would ignore it',
    });
  });

  it('rejects a duplicate with 409', async () => {
    repo.stock.set(20002, [8001]);
    await expect(service.addItem(20002, 8001, actor)).rejects.toMatchObject({ status: 409, message: 'Already sold by this vendor' });
    expect(gm.audits).toEqual([]);
  });

  it('rejects a shop overflow with 422', async () => {
    repo.items = [item({ classMask: 1 })];
    repo.stock.set(20002, Array.from({ length: 255 }, (_, i) => 100000 + i));
    for (let i = 0; i < 255; i++) repo.items.push(item({ itemId: 100000 + i, classMask: 1 }));
    await expect(service.addItem(20002, 8001, actor)).rejects.toMatchObject({
      status: 422,
      message: 'Would exceed the 255 item shop limit for Warrior in Defugel',
    });
    expect(repo.stock.get(20002)).toHaveLength(255);
  });

  it('allows reaching exactly 255', async () => {
    repo.items = [item({ classMask: 1 })];
    repo.stock.set(20002, Array.from({ length: 254 }, (_, i) => 100000 + i));
    for (let i = 0; i < 254; i++) repo.items.push(item({ itemId: 100000 + i, classMask: 1 }));
    await service.addItem(20002, 8001, actor);
    expect(repo.stock.get(20002)).toHaveLength(255);
  });
});

describe('shopOverflow', () => {
  const entry = (classMask: number, itemCountry = 3) => ({ classMask, itemCountry });
  const many = (n: number, e: ReturnType<typeof entry>) => Array.from({ length: n }, () => e);
  it('is null at 255', () => expect(shopOverflow(0, many(255, entry(1)))).toBeNull());
  it('finds the class over 255', () => expect(shopOverflow(0, many(256, entry(0b100)))).toEqual({ classId: 2, country: 0 }));
  it('ignores classes split across masks', () =>
    expect(shopOverflow(0, [...many(200, entry(1)), ...many(200, entry(2))])).toBeNull());
  it('counts faction items only in that faction', () =>
    expect(shopOverflow(0, [...many(200, entry(1, 0)), ...many(200, entry(1, 1))])).toBeNull());
  it('counts every faction item when the vendor is DCC_ALLCOUNTRY', () =>
    expect(shopOverflow(4, [...many(200, entry(1, 0)), ...many(200, entry(1, 1))])).toEqual({ classId: 0, country: 0 }));
});

describe('removeItem', () => {
  it('removes and audits', async () => {
    repo.stock.set(20002, [8001]);
    await service.removeItem(20002, 8001, actor);
    expect(repo.stock.get(20002)).toEqual([]);
    expect(gm.audits).toEqual([
      expect.objectContaining({ command: 'VENDORDEL', gmId: 'moose', log: 'Mr Bab (20002): -8001 Small Vitality Potion' }),
    ]);
  });

  it('404s when not sold', () =>
    expect(service.removeItem(20002, 8001, actor)).rejects.toMatchObject({ status: 404, message: 'Not sold by this vendor' }));

  it('404s for a non-vendor', () =>
    expect(service.removeItem(1, 8001, actor)).rejects.toMatchObject({ status: 404, message: 'That NPC is not a vendor' }));
});

describe('setPrice', () => {
  it('stores a money multiplier and audits old and new values', async () => {
    const result = await service.setPrice(8001, { currency: 'money', amount: 75 }, actor);
    expect(result).toEqual({ itemId: 8001, name: 'Small Vitality Potion', price: 75, multiplier: 75, soldBy: 12 });
    expect(repo.prices).toEqual([[8001, 'fPrice', 75]]);
    expect(gm.audits[0]).toMatchObject({
      command: 'ITEMPRICE', gmId: 'moose', log: '8001 Small Vitality Potion: fPrice 50 -> 75, 50 -> 75 cron',
    });
  });

  it('stores PvP in fPvPrice', async () => {
    repo.items = [item({ pvpMoney: 50, fPvPrice: 2 })];
    await service.setPrice(8001, { currency: 'pvp', amount: 150 }, actor);
    expect(repo.prices).toEqual([[8001, 'fPvPrice', 3]]);
    expect(gm.audits[0].log).toBe('8001 Small Vitality Potion: fPvPrice 2 -> 3, 100 -> 150 points');
  });

  it('allows a free item', async () => {
    const result = await service.setPrice(8001, { currency: 'money', amount: 0 }, actor);
    expect(result).toMatchObject({ price: 0, multiplier: 0 });
    expect(repo.prices).toEqual([[8001, 'fPrice', 0]]);
  });

  it('404s for a missing item', () =>
    expect(service.setPrice(9, { currency: 'money', amount: 1 }, actor)).rejects.toMatchObject({ status: 404, message: 'Item not found' }));

  it('rejects base 0 with 422', async () => {
    repo.items = [item({ money: 0 })];
    await expect(service.setPrice(8001, { currency: 'money', amount: 5 }, actor)).rejects.toMatchObject({
      status: 422,
      message: "This item's level has no price, so it can't be set",
    });
    expect(repo.prices).toEqual([]);
  });

  it('rejects a stack overflow with 422', async () => {
    repo.items = [item({ stack: 100 })];
    await expect(service.setPrice(8001, { currency: 'money', amount: 50_000_000 }, actor)).rejects.toMatchObject({
      status: 422,
      message: 'Price too high, buying a full stack would overflow',
    });
    expect(repo.prices).toEqual([]);
  });

  it('treats stack 0 as 1', async () => {
    repo.items = [item({ stack: 0 })];
    await service.setPrice(8001, { currency: 'money', amount: 4_000_000_000 }, actor);
    expect(repo.prices).toHaveLength(1);
  });

  it('still succeeds when the audit fails', async () => {
    gm.failAudit = true;
    await expect(service.setPrice(8001, { currency: 'money', amount: 75 }, actor)).resolves.toMatchObject({ price: 75 });
    expect(repo.prices).toHaveLength(1);
  });
});

describe('searchItems', () => {
  it('marks items not in the client', async () => {
    repo.items = [item({ itemId: 60 }), item({ itemId: 8001 })];
    const results = await service.searchItems('x');
    expect(results.map((r) => r.inClient)).toEqual([false, true]);
  });

  it('reports both prices', async () => {
    repo.items = [item({ money: 1, fPrice: 50, pvpMoney: 1, fPvPrice: 0 })];
    expect(await service.searchItems('x')).toMatchObject([{ price: 50, pvpPrice: 0 }]);
  });
});
