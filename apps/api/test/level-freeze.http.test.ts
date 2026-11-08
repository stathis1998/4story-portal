import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sha1Hex } from '../src/auth/sha1.js';
import { FakeAccountsRepository, FakeCharactersRepository } from './fakes.js';
import { createTestApp } from './test-app.js';

const CHAR_ID = 7;
const url = (id = CHAR_ID) => `/api/characters/${id}/level-freeze`;

describe('character level freeze', () => {
  let app: INestApplication;
  let characters: FakeCharactersRepository;
  let agent: ReturnType<typeof request.agent>;
  let userId: number;

  beforeEach(async () => {
    const accounts = new FakeAccountsRepository();
    userId = accounts.seed('moose', sha1Hex('secret1')).userId;
    characters = new FakeCharactersRepository();
    characters.freezes.set(CHAR_ID, { userId, level: 40, freezeLevel: null, online: false });
    app = await createTestApp({ accounts, characters });
    agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/login').send({ username: 'moose', password: 'secret1' }).expect(200);
  });

  afterEach(() => app.close());

  const stored = () => characters.freezes.get(CHAR_ID)!.freezeLevel;

  it('refuses a change without a session', async () => {
    const res = await request(app.getHttpServer()).put(url()).send({ level: 50 });

    expect(res.status).toBe(401);
    expect(stored()).toBeNull();
  });

  it('shows the level, the freeze and whether the character is online', async () => {
    characters.freezes.get(CHAR_ID)!.freezeLevel = 55;

    const res = await agent.get(url());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ level: 40, freezeLevel: 55, online: false });
  });

  it("answers 404 for another account's character and leaves it alone", async () => {
    characters.freezes.set(8, { userId: userId + 1, level: 40, freezeLevel: null, online: false });

    expect((await agent.get(url(8))).status).toBe(404);
    expect((await agent.put(url(8)).send({ level: 50 })).status).toBe(404);
    expect(characters.freezes.get(8)!.freezeLevel).toBeNull();
  });

  it('saves a freeze above the current level', async () => {
    const res = await agent.put(url()).send({ level: 50 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ level: 40, freezeLevel: 50, online: false });
    expect(stored()).toBe(50);
  });

  it('allows freezing at the current level', async () => {
    expect((await agent.put(url()).send({ level: 40 })).status).toBe(200);
    expect(stored()).toBe(40);
  });

  it('removes the freeze with a null level', async () => {
    characters.freezes.get(CHAR_ID)!.freezeLevel = 55;

    const res = await agent.put(url()).send({ level: null });

    expect(res.status).toBe(200);
    expect(res.body.freezeLevel).toBeNull();
    expect(stored()).toBeNull();
  });

  it('refuses a level below the current one', async () => {
    const res = await agent.put(url()).send({ level: 39 });

    expect(res.status).toBe(422);
    expect(res.body.message).toContain('40');
    expect(stored()).toBeNull();
  });

  it.each([[90], [0], [50.5], ['50']])('rejects %s as a level', async (level) => {
    expect((await agent.put(url()).send({ level })).status).toBe(400);
    expect(stored()).toBeNull();
  });

  it.each([[50], [null]])('refuses to set %s while the character is online', async (level) => {
    const row = characters.freezes.get(CHAR_ID)!;
    row.online = true;
    row.freezeLevel = 55;

    const res = await agent.put(url()).send({ level });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/log out/i);
    expect(stored()).toBe(55);
  });
});
