import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sha1Hex } from '../src/auth/sha1.js';
import type { ItemRow, VendorRow } from '../src/gm/vendors.repository.js';
import { FakeAccountsRepository, FakeGmRepository, FakeVendorsRepository } from './fakes.js';
import { createTestApp } from './test-app.js';

const vendor = (overrides: Partial<VendorRow> = {}): VendorRow => ({
  id: 20002, name: 'Mr Bab', title: 'Potions', type: 2, country: 0, condition: 0, mapId: 0, itemCount: 1, ...overrides,
});

const item = (overrides: Partial<ItemRow> = {}): ItemRow => ({
  itemId: 8001, name: 'Small Vitality Potion', level: 1, stack: 1, classMask: 0b111111, itemCountry: 3,
  money: 1, pvpMoney: 1, fPrice: 50, fPvPrice: 0, soldBy: 12, ...overrides,
});

describe('/api/gm vendors', () => {
  let app: INestApplication;
  let vendors: FakeVendorsRepository;
  let gm: FakeGmRepository;
  let agent: ReturnType<typeof request.agent>;

  beforeAll(() => Logger.overrideLogger(false));

  beforeEach(async () => {
    const accounts = new FakeAccountsRepository();
    accounts.seed('moose', sha1Hex('secret1'));
    accounts.seed('newuser', sha1Hex('secret1'));
    vendors = new FakeVendorsRepository();
    vendors.vendors = [vendor()];
    vendors.items = [item(), item({ itemId: 8002, name: 'Other Potion' })];
    vendors.stock.set(20002, [8001]);
    gm = new FakeGmRepository();
    app = await createTestApp({ accounts, gm, vendors });
    agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/login').send({ username: 'moose', password: 'secret1' }).expect(200);
  });

  afterEach(() => app.close());

  const routes = [
    ['get', '/api/gm/vendors'],
    ['get', '/api/gm/vendors/20002/items'],
    ['post', '/api/gm/vendors/20002/items'],
    ['delete', '/api/gm/vendors/20002/items/8001'],
    ['put', '/api/gm/items/8001/price'],
    ['get', '/api/gm/items?q=potion'],
  ] as const;

  it.each(routes)('%s %s is 401 when logged out', async (method, path) => {
    expect((await request(app.getHttpServer())[method](path)).status).toBe(401);
  });

  it.each(routes)('%s %s is 403 for a non-GM', async (method, path) => {
    const other = request.agent(app.getHttpServer());
    await other.post('/api/auth/login').send({ username: 'newuser', password: 'secret1' }).expect(200);
    expect((await other[method](path)).status).toBe(403);
  });

  it('GET /gm/vendors returns the list', async () => {
    const res = await agent.get('/api/gm/vendors');
    expect(res.status).toBe(200);
    expect(res.body.database).toBe('TGAME_GSP_TEST');
    expect(res.body.vendors[0]).toMatchObject({ id: 20002, name: 'Mr Bab', shop: 'money' });
  });

  it('GET /gm/vendors/:id/items returns stock', async () => {
    const res = await agent.get('/api/gm/vendors/20002/items');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ itemId: 8001, name: 'Small Vitality Potion' });
  });

  it('POST adds and returns 201 with the row', async () => {
    const res = await agent.post('/api/gm/vendors/20002/items').send({ itemId: 8002 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ itemId: 8002, name: 'Other Potion' });
    expect(vendors.stock.get(20002)).toContain(8002);
    expect(gm.audits[0]).toMatchObject({ command: 'VENDORADD', gmId: 'moose' });
  });

  it.each([{ itemId: 'x' }, { itemId: 40000 }])('POST with a bad body %j is 400', async (body) => {
    expect((await agent.post('/api/gm/vendors/20002/items').send(body)).status).toBe(400);
  });

  it('DELETE removes and returns 204', async () => {
    const res = await agent.delete('/api/gm/vendors/20002/items/8001');
    expect(res.status).toBe(204);
    expect(vendors.stock.get(20002)).toEqual([]);
  });

  it('PUT sets a price', async () => {
    const res = await agent.put('/api/gm/items/8001/price').send({ currency: 'money', amount: 75 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ itemId: 8001, price: 75, soldBy: 12 });
    expect(vendors.prices).toHaveLength(1);
  });

  it('PUT with a negative amount is 400', async () => {
    expect((await agent.put('/api/gm/items/8001/price').send({ currency: 'money', amount: -1 })).status).toBe(400);
  });

  it('GET /gm/items searches', async () => {
    const res = await agent.get('/api/gm/items').query({ q: 'potion' });
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ itemId: 8001 });
  });

  it.each(['/api/gm/items', '/api/gm/items?q=', '/api/gm/items?q=%20%20'])('GET %s requires q', async (path) => {
    expect((await agent.get(path)).status).toBe(400);
  });

  it('passes the status and message of a rule failure through', async () => {
    vendors.items.push(item({ itemId: 60, name: 'Not in client' }));
    const res = await agent.post('/api/gm/vendors/20002/items').send({ itemId: 60 });
    expect(res.status).toBe(422);
    expect(res.body.message).toBe('Not in the game client, adding it would crash players opening this shop');
  });

  it.each(['abc', '0', '-1', '32768', '99999999999'])('GET /gm/vendors/%s/items is 400', async (id) =>
    expect((await agent.get(`/api/gm/vendors/${id}/items`)).status).toBe(400));

  it.each(['abc', '40000'])('DELETE with item id %s is 400', async (id) =>
    expect((await agent.delete(`/api/gm/vendors/20002/items/${id}`)).status).toBe(400));

  it.each(['abc', '40000'])('PUT with item id %s is 400', async (id) =>
    expect((await agent.put(`/api/gm/items/${id}/price`).send({ currency: 'money', amount: 1 })).status).toBe(400));
});
