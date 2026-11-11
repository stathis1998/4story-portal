import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sha1Hex } from '../src/auth/sha1.js';
import { FakeAccountsRepository, FakeCharactersRepository } from './fakes.js';
import { createTestApp } from './test-app.js';

const CHAR_ID = 7;
const url = (id = CHAR_ID) => `/api/characters/${id}/gear-effect`;

describe('character gear effect', () => {
  let app: INestApplication;
  let characters: FakeCharactersRepository;
  let agent: ReturnType<typeof request.agent>;
  let userId: number;

  beforeEach(async () => {
    const accounts = new FakeAccountsRepository();
    userId = accounts.seed('moose', sha1Hex('secret1')).userId;
    characters = new FakeCharactersRepository();
    characters.gearEffects.set(CHAR_ID, {
      userId,
      online: false,
      items: [
        { slot: 0, itemId: 3001, name: 'Dragon Helm', upgrade: 17, effect: 3 },
        { slot: 6, itemId: 1001, name: 'Dragon Sword', upgrade: 24, effect: 0 },
      ],
    });
    app = await createTestApp({ accounts, characters });
    agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/login').send({ username: 'moose', password: 'secret1' }).expect(200);
  });

  afterEach(() => app.close());

  const effects = () => characters.gearEffects.get(CHAR_ID)!.items.map((item) => item.effect);

  it('refuses a change without a session', async () => {
    expect((await request(app.getHttpServer()).put(url()).send({ effect: 12 })).status).toBe(401);
    expect(effects()).toEqual([3, 0]);
  });

  it('lists the worn items that can carry an effect', async () => {
    const res = await agent.get(url());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      online: false,
      items: [
        { slot: 0, itemId: 3001, name: 'Dragon Helm', upgrade: 17, effect: 3 },
        { slot: 6, itemId: 1001, name: 'Dragon Sword', upgrade: 24, effect: 0 },
      ],
    });
  });

  it('sets the effect on every listed item and returns them', async () => {
    const res = await agent.put(url()).send({ effect: 12 });

    expect(res.status).toBe(200);
    expect(res.body.items.map((item: { effect: number }) => item.effect)).toEqual([12, 12]);
    expect(effects()).toEqual([12, 12]);
  });

  it("answers 404 for another account's character and leaves it alone", async () => {
    characters.gearEffects.set(8, { userId: userId + 1, online: false, items: [{ slot: 6, itemId: 1002, name: 'Sword', upgrade: 20, effect: 1 }] });

    expect((await agent.get(url(8))).status).toBe(404);
    expect((await agent.put(url(8)).send({ effect: 12 })).status).toBe(404);
    expect(characters.gearEffects.get(8)!.items[0].effect).toBe(1);
  });

  it('refuses while the character is online', async () => {
    characters.gearEffects.get(CHAR_ID)!.online = true;

    const res = await agent.put(url()).send({ effect: 12 });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/log out/i);
    expect(effects()).toEqual([3, 0]);
  });

  it('says so when nothing worn can carry an effect', async () => {
    characters.gearEffects.get(CHAR_ID)!.items = [];

    const res = await agent.put(url()).send({ effect: 12 });

    expect(res.status).toBe(422);
    expect(res.body.message).toContain('+17');
  });

  it.each([[0], [40], [1.5], ['12'], [null]])('rejects %s as an effect', async (effect) => {
    expect((await agent.put(url()).send({ effect })).status).toBe(400);
    expect(effects()).toEqual([3, 0]);
  });
});
