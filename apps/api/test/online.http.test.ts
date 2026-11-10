import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sha1Hex } from '../src/auth/sha1.js';
import { FakeAccountsRepository, FakeGmRepository } from './fakes.js';
import { createTestApp } from './test-app.js';

const player = (charId: number, name: string, extra = {}) => ({
  charId,
  name,
  level: 10,
  classCode: 3,
  world: 1,
  channel: 2,
  mapId: 7,
  ...extra,
});

describe('GET /api/online', () => {
  let app: INestApplication;
  let gm: FakeGmRepository;

  beforeAll(() => Logger.overrideLogger(false));

  beforeEach(async () => {
    const accounts = new FakeAccountsRepository();
    accounts.seed('newuser', sha1Hex('secret1'));
    gm = new FakeGmRepository();
    gm.players = [player(1, 'Kaelith'), player(2, 'Moosey', { level: 90, classCode: 0, channel: 1 })];
    app = await createTestApp({ accounts, gm });
  });

  afterEach(async () => {
    await app.close();
  });

  it('needs a portal login', async () => {
    await request(app.getHttpServer()).get('/api/online').expect(401);
  });

  it('lists online characters for any player, without where they are', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/login').send({ username: 'newuser', password: 'secret1' }).expect(200);

    const res = await agent.get('/api/online');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 1, name: 'Kaelith', level: 10, className: 'Wizard', channel: 2 },
      { id: 2, name: 'Moosey', level: 90, className: 'Warrior', channel: 1 },
    ]);
  });
});
