import { describe, expect, it } from 'vitest';
import {
  REBIRTH_DEFAULT_SETTINGS,
  REBIRTH_MAX_NUMBER,
  rebirthBonus,
  rebirthExtraBonus,
  rebirthRewardNumberSchema,
  rebirthIsOpen,
  rebirthPriceGold,
  rebirthRequestSchema,
  rebirthSettingsSchema,
} from './rebirth.js';

const X = { expPercent: 0, goldPercent: 0 };

describe('rebirth rules', () => {
  it('the bonus stops growing at the limit', () => {
    expect(rebirthBonus(0, { percent: 2, limit: 10 })).toBe(0);
    expect(rebirthBonus(3, { percent: 2, limit: 10 })).toBe(6);
    expect(rebirthBonus(14, { percent: 2, limit: 10 })).toBe(20);
  });
  it('rebirth N costs N times the price', () => expect(rebirthPriceGold(3, 2000)).toBe(6000));
  it('is open only with the switch on and a price', () => {
    expect(rebirthIsOpen({ ...REBIRTH_DEFAULT_SETTINGS, live: true })).toBe(false);
    expect(rebirthIsOpen({ live: true, priceGold: 1, percent: 2, limit: 10, ...X })).toBe(true);
    expect(rebirthIsOpen({ live: false, priceGold: 500, percent: 2, limit: 10, ...X })).toBe(false);
  });
  it.each([
    [{ live: false, priceGold: 0, percent: 2, limit: 10, ...X }, true],
    [{ live: true, priceGold: 0, percent: 2, limit: 10, ...X }, false],
    [{ live: true, priceGold: 100_001, percent: 2, limit: 10, ...X }, false],
    [{ live: true, priceGold: 5, percent: 10, limit: 11, ...X }, false],
    [{ live: true, priceGold: 5, percent: 10, limit: 10, ...X }, true],
    [{ live: true, priceGold: 5, percent: 0, limit: 10, ...X }, false],
    [{ live: true, priceGold: 5, percent: 11, limit: 5, ...X }, false],
    [{ live: true, priceGold: 5, percent: 2, limit: 21, ...X }, false],
    [{ live: true, priceGold: 5.5, percent: 2, limit: 10, ...X }, false],
  ])('settings %j valid: %s', (input, ok) => expect(rebirthSettingsSchema.safeParse(input).success).toBe(ok));
  it.each([
    [1, true],
    [2_000_000, true],
    [0, false],
    [2_000_001, false],
  ])('a request price of %i is valid: %s', (priceGold, ok) => expect(rebirthRequestSchema.safeParse({ priceGold }).success).toBe(ok));
  it('names the field each refinement blames', () => {
    const price = rebirthSettingsSchema.safeParse({ live: true, priceGold: 0, percent: 2, limit: 10, ...X });
    expect(price.success || price.error.issues[0]).toMatchObject({
      path: ['priceGold'],
      message: 'Set a price before opening rebirth',
    });
    const cap = rebirthSettingsSchema.safeParse({ live: true, priceGold: 5, percent: 10, limit: 11, ...X });
    expect(cap.success || cap.error.issues[0]).toMatchObject({
      path: ['percent'],
      message: 'Percent times limit cannot pass 100',
    });
  });
  const base = { live: false, priceGold: 0, percent: 2, limit: 10 };
  it('accepts EXP and gold percents from 0 to 25', () => {
    for (const f of ['expPercent', 'goldPercent'] as const) {
      const other = f === 'expPercent' ? 'goldPercent' : 'expPercent';
      for (const v of [0, 25]) expect(rebirthSettingsSchema.safeParse({ ...base, limit: 10, [other]: 0, [f]: v }).success).toBe(true);
      for (const v of [26, -1]) {
        const r = rebirthSettingsSchema.safeParse({ ...base, [other]: 0, [f]: v });
        expect(!r.success && r.error.issues.some((i) => i.path[0] === f)).toBe(true);
      }
    }
  });
  it('refuses an EXP or gold total over 250', () => {
    for (const f of ['expPercent', 'goldPercent'] as const) {
      const other = f === 'expPercent' ? 'goldPercent' : 'expPercent';
      const bad = rebirthSettingsSchema.safeParse({ ...base, limit: 20, [other]: 0, [f]: 13 });
      expect(bad.success || bad.error.issues[0]).toMatchObject({
        path: [f],
        message: f === 'expPercent' ? 'EXP times limit cannot pass 250' : 'Gold times limit cannot pass 250',
      });
      expect(rebirthSettingsSchema.safeParse({ ...base, limit: 20, percent: 5, [other]: 0, [f]: 12 }).success).toBe(true);
    }
  });
  it('works out an extra bonus up to the limit', () => {
    expect(rebirthExtraBonus(3, 10, 10)).toBe(30);
    expect(rebirthExtraBonus(15, 10, 10)).toBe(100);
    expect(rebirthExtraBonus(2, 10, 0)).toBe(0);
  });
  it('defaults both extras to 0', () => {
    expect(REBIRTH_DEFAULT_SETTINGS.expPercent).toBe(0);
    expect(REBIRTH_DEFAULT_SETTINGS.goldPercent).toBe(0);
  });
  it('reads a reward number from 1 to 20', () => {
    expect(REBIRTH_MAX_NUMBER).toBe(20);
    expect(rebirthRewardNumberSchema.parse('1')).toBe(1);
    expect(rebirthRewardNumberSchema.parse('20')).toBe(20);
    for (const v of ['0', '21', '1.5', 'x']) expect(rebirthRewardNumberSchema.safeParse(v).success).toBe(false);
  });
});
