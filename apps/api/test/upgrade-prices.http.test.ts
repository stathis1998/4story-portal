import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sha1Hex } from '../src/auth/sha1.js';
import type { ItemRow } from '../src/gm/vendors.repository.js';
import { FakeAccountsRepository, FakeVendorsRepository } from './fakes.js';
import { createTestApp } from './test-app.js';

const item = (itemId: number, fPrice: number, overrides: Partial<ItemRow> = {}): ItemRow => ({
  itemId, name: `Item ${itemId}`, level: 1, stack: 200, classMask: 0b111111, itemCountry: 3,
  money: 1, pvpMoney: 1, fPrice, fPvPrice: 0, sellFlags: 7, moneySoldBy: 1, pvpSoldBy: 0, ...overrides,
});

describe('GET /api/upgrade-prices', () => {
  let app: INestApplication;
  let vendors: FakeVendorsRepository;

  beforeAll(() => Logger.overrideLogger(false));

  beforeEach(async () => {
    const accounts = new FakeAccountsRepository();
    accounts.seed('newuser', sha1Hex('secret1'));
    vendors = new FakeVendorsRepository();
    // Apprentice's Formula, Master's Formula, a Greater Survival Tincture, and a 200% Serendipity on a dearer level.
    vendors.items = [item(8501, 10_000), item(7602, 100_000), item(7921, 40_000_000), item(7679, 2.5, { money: 400_000 })];
    app = await createTestApp({ accounts, vendors });
  });

  afterEach(() => app.close());

  it('needs a portal login', async () => {
    await request(app.getHttpServer()).get('/api/upgrade-prices').expect(401);
  });

  it('gives a player who is not a GM what a vendor charges for each upgrade item, in Cron', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/login').send({ username: 'newuser', password: 'secret1' }).expect(200);

    const res = await agent.get('/api/upgrade-prices');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      apprentice: 10_000,
      master: 100_000,
      reflection: 0,
      potion100: 0,
      potion150: 0,
      potion200: 1_000_000,
      potion300: 0,
      survival: 0,
      medium: 0,
      greater: 40_000_000,
    });
  });
});
