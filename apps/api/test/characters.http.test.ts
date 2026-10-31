import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sha1Hex } from '../src/auth/sha1.js';
import { characterRow, FakeAccountsRepository, FakeCharactersRepository } from './fakes.js';
import { createTestApp } from './test-app.js';

describe('GET /api/characters', () => {
  let app: INestApplication;
  let characters: FakeCharactersRepository;
  let userId: number;

  beforeEach(async () => {
    const accounts = new FakeAccountsRepository();
    userId = accounts.seed('moose', sha1Hex('secret1')).userId;
    characters = new FakeCharactersRepository();
    characters.rowsByUser.set(userId, [characterRow({ szNAME: 'Moosey', bLevel: 45 })]);
    app = await createTestApp({ accounts, characters });
  });

  afterEach(() => app.close());

  it('returns 401 without a session', async () =>
    expect((await request(app.getHttpServer()).get('/api/characters')).status).toBe(401));

  it("returns the signed-in user's characters, mapped", async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/login').send({ username: 'moose', password: 'secret1' }).expect(200);

    const res = await agent.get('/api/characters');

    expect(res.status).toBe(200);
    expect(characters.requestedUserIds).toEqual([userId]);
    expect(res.body).toEqual([expect.objectContaining({ name: 'Moosey', level: 45, className: 'Wizard' })]);
  });
});
