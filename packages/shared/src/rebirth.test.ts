import { describe, expect, it } from 'vitest';
import {
  REBIRTH_DEFAULT_SETTINGS,
  rebirthBonus,
  rebirthIsOpen,
  rebirthPriceGold,
  rebirthSettingsSchema,
} from './rebirth.js';

describe('rebirth rules', () => {
  it('the bonus stops growing at the limit', () => {
    expect(rebirthBonus(0, { percent: 2, limit: 10 })).toBe(0);
    expect(rebirthBonus(3, { percent: 2, limit: 10 })).toBe(6);
    expect(rebirthBonus(14, { percent: 2, limit: 10 })).toBe(20);
  });
  it('rebirth N costs N times the price', () => expect(rebirthPriceGold(3, 2000)).toBe(6000));
  it('is open only with the switch on and a price', () => {
    expect(rebirthIsOpen({ ...REBIRTH_DEFAULT_SETTINGS, live: true })).toBe(false);
    expect(rebirthIsOpen({ live: true, priceGold: 1, percent: 2, limit: 10 })).toBe(true);
    expect(rebirthIsOpen({ live: false, priceGold: 500, percent: 2, limit: 10 })).toBe(false);
  });
  it.each([
    [{ live: false, priceGold: 0, percent: 2, limit: 10 }, true],
    [{ live: true, priceGold: 0, percent: 2, limit: 10 }, false],
    [{ live: true, priceGold: 100_001, percent: 2, limit: 10 }, false],
    [{ live: true, priceGold: 5, percent: 10, limit: 11 }, false],
    [{ live: true, priceGold: 5, percent: 10, limit: 10 }, true],
    [{ live: true, priceGold: 5, percent: 0, limit: 10 }, false],
    [{ live: true, priceGold: 5, percent: 2, limit: 21 }, false],
    [{ live: true, priceGold: 5.5, percent: 2, limit: 10 }, false],
  ])('settings %j valid: %s', (input, ok) => expect(rebirthSettingsSchema.safeParse(input).success).toBe(ok));
  it('names the field each refinement blames', () => {
    const price = rebirthSettingsSchema.safeParse({ live: true, priceGold: 0, percent: 2, limit: 10 });
    expect(price.success || price.error.issues[0]).toMatchObject({
      path: ['priceGold'],
      message: 'Set a price before opening rebirth',
    });
    const cap = rebirthSettingsSchema.safeParse({ live: true, priceGold: 5, percent: 10, limit: 11 });
    expect(cap.success || cap.error.issues[0]).toMatchObject({
      path: ['percent'],
      message: 'Percent times limit cannot pass 100',
    });
  });
});
