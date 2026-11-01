import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_PRICE } from '@4story-portal/shared';
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
  money: 1, pvpMoney: 1, fPrice: 50, fPvPrice: 0, sellFlags: 7, moneySoldBy: 12, pvpSoldBy: 0, ...overrides,
});

let repo: FakeVendorsRepository;
let gm: FakeGmRepository;
let service: VendorsService;

const snapshot = () => JSON.stringify([gm.audits, repo.prices, [...repo.stock]]);

/** The call is rejected as described and nothing was written or audited. */
async function expectRejected(call: () => Promise<unknown>, expected: { status: number; message: string }) {
  const before = snapshot();
  await expect(call()).rejects.toMatchObject(expected);
  expect(snapshot()).toBe(before);
}

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
      {
        itemId: 8001, name: 'Small Vitality Potion', level: 1, icon: itemIcons[8001], stack: 1,
        base: 475, multiplier: 5, price: 2375, soldBy: 12, inClient: true, canSellBack: true,
      },
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
    expect(await service.stock(20002)).toMatchObject([
      { itemId: 60, name: null, icon: null, price: 0, stack: 0, inClient: false, canSellBack: false },
    ]);
  });

  it('counts only vendors using the shop currency in soldBy', async () => {
    repo.items = [item({ moneySoldBy: 5, pvpSoldBy: 2 })];
    repo.stock.set(20002, [8001]);
    expect(await service.stock(20002)).toMatchObject([{ soldBy: 5 }]);
    repo.vendors = [vendor({ type: 21 })];
    expect(await service.stock(20002)).toMatchObject([{ soldBy: 2 }]);
  });

  it.each([
    [0, false], [1, false], [2, true], [3, true], [4, false], [5, false], [6, true], [7, true], [100, false],
  ])('reads flags %d as canSellBack %s', async (sellFlags, canSellBack) => {
    repo.items = [item({ sellFlags })];
    repo.stock.set(20002, [8001]);
    expect(await service.stock(20002)).toMatchObject([{ canSellBack }]);
  });

  it('reports the stack', async () => {
    repo.items = [item({ stack: 200 })];
    repo.stock.set(20002, [8001]);
    expect(await service.stock(20002)).toMatchObject([{ stack: 200 }]);
  });

  it('still lists a row whose full stack overflows, so it can be repriced', async () => {
    repo.items = [item({ stack: 200, fPrice: 100_000_000 })];
    repo.stock.set(20002, [8001]);
    expect(await service.stock(20002)).toMatchObject([{ price: 100_000_000, stack: 200 }]);
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

  it('prices the returned row in PvP for a PvP vendor', async () => {
    repo.vendors = [vendor({ type: 21 })];
    repo.items = [item({ money: 475, fPrice: 5, pvpMoney: 2, fPvPrice: 75 })];
    expect(await service.addItem(20002, 8001, actor)).toMatchObject({ base: 2, multiplier: 75, price: 150 });
  });

  it('counts the new vendor in soldBy, only for its currency', async () => {
    repo.items = [item({ moneySoldBy: 5, pvpSoldBy: 2 })];
    expect(await service.addItem(20002, 8001, actor)).toMatchObject({ soldBy: 6 });
    repo.stock.clear();
    repo.vendors = [vendor({ type: 21 })];
    expect(await service.addItem(20002, 8001, actor)).toMatchObject({ soldBy: 3 });
  });

  const fullStackOverflow = {
    status: 422,
    message: 'Price too high to sell here: buying a full stack would overflow. Lower its price first.',
  };

  it('rejects an item whose full stack overflows in a money shop', () => {
    repo.items = [item({ stack: 200, fPrice: 148_500_000 })];
    return expectRejected(() => service.addItem(20002, 8001, actor), fullStackOverflow);
  });

  it('rejects an item whose full stack overflows in a PvP shop', () => {
    repo.vendors = [vendor({ type: 21 })];
    repo.items = [item({ stack: 200, pvpMoney: 2, fPvPrice: 74_250_000 })];
    return expectRejected(() => service.addItem(20002, 8001, actor), fullStackOverflow);
  });

  it('only looks at the currency the vendor uses', async () => {
    repo.items = [item({ stack: 200, fPvPrice: 148_500_000 })];
    await service.addItem(20002, 8001, actor);
    expect(repo.stock.get(20002)).toEqual([8001]);

    repo.stock.clear();
    repo.vendors = [vendor({ type: 21 })];
    repo.items = [item({ stack: 200, fPrice: 148_500_000 })];
    await service.addItem(20002, 8001, actor);
    expect(repo.stock.get(20002)).toEqual([8001]);
  });

  it('allows the largest price that fits a full stack', async () => {
    repo.items = [item({ stack: 100, fPrice: 42_949_672 })];
    await service.addItem(20002, 8001, actor);
    expect(repo.stock.get(20002)).toEqual([8001]);
  });

  it('rejects the next price a multiplier can reach', () => {
    repo.items = [item({ stack: 100, fPrice: 42_949_676 })];
    return expectRejected(() => service.addItem(20002, 8001, actor), fullStackOverflow);
  });

  it('treats stack 0 as 1', async () => {
    repo.items = [item({ stack: 0, fPrice: 4_000_000_000 })];
    await service.addItem(20002, 8001, actor);
    expect(repo.stock.get(20002)).toEqual([8001]);
  });

  it('reports a duplicate before an overflow', () => {
    repo.items = [item({ stack: 200, fPrice: 148_500_000 })];
    repo.stock.set(20002, [8001]);
    return expectRejected(() => service.addItem(20002, 8001, actor), { status: 409, message: 'Already sold by this vendor' });
  });

  it('reports an overflow before a full shop', () => {
    repo.items = [item({ classMask: 1, stack: 200, fPrice: 148_500_000 })];
    repo.stock.set(20002, Array.from({ length: 255 }, (_, i) => 100000 + i));
    for (let i = 0; i < 255; i++) repo.items.push(item({ itemId: 100000 + i, classMask: 1 }));
    return expectRejected(() => service.addItem(20002, 8001, actor), fullStackOverflow);
  });

  it('rejects a non-vendor with 404', () =>
    expectRejected(() => service.addItem(1, 8001, actor), { status: 404, message: 'That NPC is not a vendor' }));

  it('rejects an item not in the client with 422', () =>
    expectRejected(() => service.addItem(20002, 60, actor), {
      status: 422,
      message: 'Not in the game client, adding it would crash players opening this shop',
    }));

  it('rejects an item not in the database with 422', () => {
    repo.items = [];
    return expectRejected(() => service.addItem(20002, 8001, actor), {
      status: 422,
      message: 'Not in the game database, the server would ignore it',
    });
  });

  it('rejects a duplicate with 409', () => {
    repo.stock.set(20002, [8001]);
    return expectRejected(() => service.addItem(20002, 8001, actor), { status: 409, message: 'Already sold by this vendor' });
  });

  it('rejects with 409 when another GM adds it first', () => {
    vi.spyOn(repo, 'addStock').mockResolvedValue(false);
    return expectRejected(() => service.addItem(20002, 8001, actor), { status: 409, message: 'Already sold by this vendor' });
  });

  it('rejects a shop overflow with 422', () => {
    repo.items = [item({ classMask: 1 })];
    repo.stock.set(20002, Array.from({ length: 255 }, (_, i) => 100000 + i));
    for (let i = 0; i < 255; i++) repo.items.push(item({ itemId: 100000 + i, classMask: 1 }));
    return expectRejected(() => service.addItem(20002, 8001, actor), {
      status: 422,
      message: 'Would exceed the 255 item shop limit for Warrior in Defugel',
    });
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
  it('finds a faction over 255', () => {
    expect(shopOverflow(0, many(256, entry(1, 0)))).toEqual({ classId: 0, country: 0 });
    expect(shopOverflow(0, many(256, entry(1, 1)))).toEqual({ classId: 0, country: 1 });
  });
  it('adds neutral items to a faction', () =>
    expect(shopOverflow(0, [...many(200, entry(1)), ...many(56, entry(1, 1))])).toEqual({ classId: 0, country: 1 }));
  it('finds the last class', () => expect(shopOverflow(0, many(256, entry(0b100000)))).toEqual({ classId: 5, country: 0 }));
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
    expectRejected(() => service.removeItem(20002, 8001, actor), { status: 404, message: 'Not sold by this vendor' }));

  it('404s for a non-vendor', () =>
    expectRejected(() => service.removeItem(1, 8001, actor), { status: 404, message: 'That NPC is not a vendor' }));
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

  it('reports only the vendors this edit changes', async () => {
    repo.items = [item({ pvpMoney: 1, moneySoldBy: 5, pvpSoldBy: 2 })];
    expect(await service.setPrice(8001, { currency: 'money', amount: 75 }, actor)).toMatchObject({ soldBy: 5 });
    expect(await service.setPrice(8001, { currency: 'pvp', amount: 75 }, actor)).toMatchObject({ soldBy: 2 });
  });

  it('allows a free item', async () => {
    const result = await service.setPrice(8001, { currency: 'money', amount: 0 }, actor);
    expect(result).toMatchObject({ price: 0, multiplier: 0 });
    expect(repo.prices).toEqual([[8001, 'fPrice', 0]]);
  });

  it('404s for a missing item', () =>
    expectRejected(() => service.setPrice(9, { currency: 'money', amount: 1 }, actor), { status: 404, message: 'Item not found' }));

  it('rejects base 0 with 422', () => {
    repo.items = [item({ money: 0 })];
    return expectRejected(() => service.setPrice(8001, { currency: 'money', amount: 5 }, actor), {
      status: 422,
      message: "This item's level has no price, so it can't be set",
    });
  });

  const tooHigh = { status: 422, message: 'Price too high, buying a full stack would overflow' };

  it('rejects a stack overflow with 422', () => {
    repo.items = [item({ stack: 100 })];
    return expectRejected(() => service.setPrice(8001, { currency: 'money', amount: 50_000_000 }, actor), tooHigh);
  });

  it.each([0, 1])('rejects the maximum price at stack %d', (stack) => {
    repo.items = [item({ stack })];
    return expectRejected(() => service.setPrice(8001, { currency: 'money', amount: MAX_PRICE }, actor), tooHigh);
  });

  it('rejects when the amount times the stack overflows', () => {
    repo.items = [item({ stack: 100 })];
    return expectRejected(() => service.setPrice(8001, { currency: 'money', amount: 42_949_673 }, actor), tooHigh);
  });

  it('allows the largest amount that fits a full stack', async () => {
    repo.items = [item({ stack: 100 })];
    await service.setPrice(8001, { currency: 'money', amount: 42_949_672 }, actor);
    expect(repo.prices).toHaveLength(1);
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
    const results = await service.searchItems('x', 'money');
    expect(results.map((r) => r.inClient)).toEqual([false, true]);
  });

  const row = () =>
    item({ stack: 30, sellFlags: 4, money: 10, fPrice: 5, pvpMoney: 3, fPvPrice: 7, moneySoldBy: 5, pvpSoldBy: 2 });

  it('computes a money result the way a money stock row is', async () => {
    repo.items = [row()];
    expect(await service.searchItems('x', 'money')).toEqual([
      {
        itemId: 8001, name: 'Small Vitality Potion', level: 1, icon: itemIcons[8001], stack: 30,
        base: 10, multiplier: 5, price: 50, soldBy: 5, inClient: true, canSellBack: false,
      },
    ]);
  });

  it('computes a PvP result the way a PvP stock row is', async () => {
    repo.items = [row()];
    expect(await service.searchItems('x', 'pvp')).toMatchObject([{ base: 3, multiplier: 7, price: 21, soldBy: 2 }]);
  });

  it('keeps an empty name empty', async () => {
    repo.items = [item({ name: '' })];
    expect(await service.searchItems('x', 'money')).toMatchObject([{ name: '' }]);
  });
});
