import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sha1Hex } from '../src/auth/sha1.js';
import { itemIcons } from '../src/gm/game-icons.generated.js';
import { FakeAccountsRepository, FakeGmRepository, FakeMailRepository } from './fakes.js';
import { createTestApp } from './test-app.js';

const [itemId] = Object.keys(itemIcons).map(Number);

describe('/api/gm/mail', () => {
  let app: INestApplication;
  let mail: FakeMailRepository;
  let agent: ReturnType<typeof request.agent>;

  beforeAll(() => Logger.overrideLogger(false));

  beforeEach(async () => {
    const accounts = new FakeAccountsRepository();
    accounts.seed('moose', sha1Hex('secret1'));
    accounts.seed('newuser', sha1Hex('secret1'));
    mail = new FakeMailRepository();
    mail.characters = [{ charId: 1, name: 'Moose' }];
    mail.items = [{ itemId, name: 'Potion', stack: 20 }];
    app = await createTestApp({ accounts, gm: new FakeGmRepository(), mail });
    agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/login').send({ username: 'moose', password: 'secret1' }).expect(200);
  });

  afterEach(() => app.close());

  it('is 401 when logged out', async () => {
    expect((await request(app.getHttpServer()).post('/api/gm/mail').send({})).status).toBe(401);
  });

  it('is 403 for a non-GM', async () => {
    const other = request.agent(app.getHttpServer());
    await other.post('/api/auth/login').send({ username: 'newuser', password: 'secret1' }).expect(200);
    expect((await other.post('/api/gm/mail').send({ recipients: ['Moose'], title: 'Hi' })).status).toBe(403);
  });

  it('sends and returns results', async () => {
    const res = await agent.post('/api/gm/mail').send({ recipients: ['Moose'], title: 'Hi', items: [{ itemId, count: 1 }] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ results: [{ name: 'Moose', postId: 1000 }] });
    expect(mail.sent[0].items).toEqual([{ itemId, count: 1 }]);
  });

  it('is 400 for a schema violation', async () => {
    expect((await agent.post('/api/gm/mail').send({ recipients: [], title: 'Hi' })).status).toBe(400);
    expect(mail.sent).toEqual([]);
  });

  it('is 422 for an unknown name', async () => {
    const res = await agent.post('/api/gm/mail').send({ recipients: ['Ghost'], title: 'Hi' });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain('Ghost');
    expect(mail.sent).toEqual([]);
  });
});
