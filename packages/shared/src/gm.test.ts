import { describe, expect, it } from 'vitest';
import {
  addVendorItemSchema,
  COIN_SPRITES,
  characterNameSchema,
  chargedPrice,
  fullStackOverflows,
  gmIdSchema,
  gmLocationInputSchema,
  itemPriceSchema,
  itemSearchQuerySchema,
  joinMoney,
  MAX_PRICE,
  multiplierForPrice,
  positionSchema,
  sellBackPrice,
  splitMoney,
  teleportRequestSchema,
  vendorShopSchema,
} from './gm.js';

const position = { world: 1, channel: 1, mapId: 0, x: 2800, y: 50, z: 5000 };

describe('characterNameSchema', () => {
  it('accepts a plain name', () => expect(characterNameSchema.safeParse('Kaelith').success).toBe(true));

  it.each(['', 'a'.repeat(17), 'Kae lith'])('rejects %j', (name) =>
    expect(characterNameSchema.safeParse(name).success).toBe(false));
});

describe('positionSchema', () => {
  it('accepts a valid position', () => expect(positionSchema.safeParse(position).success).toBe(true));

  it.each([262144, -1])('rejects x = %d', (x) =>
    expect(positionSchema.safeParse({ ...position, x }).success).toBe(false));

  it.each([1e6 + 1, -1e6 - 1, 1e300])('rejects y = %d', (y) =>
    expect(positionSchema.safeParse({ ...position, y }).success).toBe(false));

  it('rejects 0/0/0 on the x path', () => {
    const result = positionSchema.safeParse({ ...position, x: 0, y: 0, z: 0 });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({ path: ['x'], message: 'Coordinates cannot all be 0' }),
    );
  });
});

describe('teleportRequestSchema', () => {
  const toPosition = { names: ['Kaelith'], destination: { kind: 'position', ...position } };
  const toCharacter = {
    names: ['Kaelith'],
    destination: { kind: 'character', world: 1, target: 'Moosey' },
  };

  it('accepts both destination kinds', () => {
    expect(teleportRequestSchema.safeParse(toPosition).success).toBe(true);
    expect(teleportRequestSchema.safeParse(toCharacter).success).toBe(true);
  });

  it('rejects 21 names', () => {
    const names = Array.from({ length: 21 }, (_, i) => `Char${i}`);
    expect(teleportRequestSchema.safeParse({ ...toPosition, names }).success).toBe(false);
  });

  it('rejects duplicate names on the names path', () => {
    const result = teleportRequestSchema.safeParse({ ...toPosition, names: ['Kaelith', 'Kaelith'] });
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({ path: ['names'], message: 'Names must be unique' }),
    );
  });

  it('rejects a target that is also moved', () => {
    const result = teleportRequestSchema.safeParse({
      names: ['Kaelith', 'Moosey'],
      destination: { kind: 'character', world: 1, target: 'Moosey' },
    });
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({
        path: ['destination', 'target'],
        message: 'Target cannot also be moved',
      }),
    );
  });
});

describe('gmLocationInputSchema', () => {
  it('accepts a named position', () =>
    expect(gmLocationInputSchema.safeParse({ ...position, name: 'Town' }).success).toBe(true));

  it('rejects a name longer than 40 characters', () =>
    expect(gmLocationInputSchema.safeParse({ ...position, name: 'a'.repeat(41) }).success).toBe(false));
});

describe('chargedPrice', () => {
  it.each([[1, 50, 50], [475, 5, 2375], [53750, 5, 268750], [0, 5, 0], [475, 0, 0]])(
    'base %d x %d = %d', (base, multiplier, price) => expect(chargedPrice(base, multiplier)).toBe(price));
});

describe('multiplierForPrice', () => {
  it('returns 0 for a free item', () => expect(multiplierForPrice(475, 0)).toBe(0));
  it('finds the exact multiplier', () => expect(chargedPrice(475, multiplierForPrice(475, 2375))).toBe(2375));
  it('moves to a neighboring float when plain division misses', () => {
    expect(chargedPrice(475, Math.fround(499650 / 475))).toBe(499651);
    expect(chargedPrice(475, multiplierForPrice(475, 499650))).toBe(499650);
  });
  it('gets as close as a float can when no multiplier is exact', () =>
    expect(chargedPrice(53750, multiplierForPrice(53750, 16_000_000))).toBe(15_999_999));
  it('returns a 32-bit float', () => {
    const multiplier = multiplierForPrice(3960, 5);
    expect(Math.fround(multiplier)).toBe(multiplier);
  });
});

describe('sell back and money', () => {
  it('pays a quarter, rounded down', () => expect(sellBackPrice(75)).toBe(18));
  it('splits', () => expect(splitMoney(268_750)).toEqual({ rune: 0, luna: 268, cron: 750 }));
  it('joins, carrying oversized parts', () => expect(joinMoney({ rune: 1, luna: 1500, cron: 2 })).toBe(2_500_002));
  it('names the coin sprites', () => expect(COIN_SPRITES).toEqual({ rune: 11137, luna: 11138, cron: 11136 }));
});

describe('fullStackOverflows', () => {
  it('allows the largest price that fits a full stack', () => expect(fullStackOverflows(42_949_672, 100)).toBe(false));
  it('rejects one more', () => expect(fullStackOverflows(42_949_673, 100)).toBe(true));
  it('treats stack 0 as 1', () => {
    expect(fullStackOverflows(MAX_PRICE, 0)).toBe(false);
    expect(fullStackOverflows(MAX_PRICE + 1, 0)).toBe(true);
  });
  it('catches the Name Change item', () => expect(fullStackOverflows(148_500_000, 200)).toBe(true));
});

describe('vendor schemas', () => {
  it.each(['money', 'pvp'])('vendorShopSchema accepts %s', (shop) =>
    expect(vendorShopSchema.safeParse(shop).success).toBe(true));
  it.each(['gold', '', undefined])('vendorShopSchema rejects %j', (shop) =>
    expect(vendorShopSchema.safeParse(shop).success).toBe(false));
  it.each(['abc', '0', '-1', '32768', '1.5'])('gmIdSchema rejects %j', (id) =>
    expect(gmIdSchema.safeParse(id).success).toBe(false));
  it('gmIdSchema coerces a numeric string', () => expect(gmIdSchema.parse('20002')).toBe(20002));
  it('addVendorItemSchema accepts an item id', () =>
    expect(addVendorItemSchema.safeParse({ itemId: 5 }).success).toBe(true));
  it.each([0, 32768, 1.5])('addVendorItemSchema rejects %d', (itemId) =>
    expect(addVendorItemSchema.safeParse({ itemId }).success).toBe(false));
  it.each([-1, 1.5, 4_294_967_296])('itemPriceSchema rejects %d', (amount) =>
    expect(itemPriceSchema.safeParse({ currency: 'money', amount }).success).toBe(false));
  it('itemPriceSchema accepts 0', () =>
    expect(itemPriceSchema.safeParse({ currency: 'pvp', amount: 0 }).success).toBe(true));
  it('itemSearchQuerySchema rejects blank', () => expect(itemSearchQuerySchema.safeParse('   ').success).toBe(false));
});
