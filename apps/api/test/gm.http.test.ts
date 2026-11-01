import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sha1Hex } from '../src/auth/sha1.js';
import { GmLocationsStore } from '../src/gm/gm-locations.store.js';
import { FakeAccountsRepository, FakeControlClient, FakeGmRepository } from './fakes.js';
import { createTestApp } from './test-app.js';

const position = { kind: 'position', world: 1, channel: 1, mapId: 0, x: 2800, y: 50, z: 5000 };
const player = (name: string, extra = {}) => ({
  charId: 1,
  name,
  level: 10,
  classCode: 3,
  world: 1,
  channel: 1,
  mapId: 0,
  ...extra,
});

describe('/api/gm', () => {
  let app: INestApplication;
  let control: FakeControlClient;
  let gm: FakeGmRepository;
  let dir: string;
  let agent: ReturnType<typeof request.agent>;

  beforeAll(() => Logger.overrideLogger(false));

  beforeEach(async () => {
    const accounts = new FakeAccountsRepository();
    accounts.seed('moose', sha1Hex('secret1'));
    accounts.seed('newuser', sha1Hex('secret1'));
    control = new FakeControlClient();
    gm = new FakeGmRepository();
    gm.players = [player('Kaelith', { charId: 1 }), player('Moosey', { charId: 2 })];
    dir = await mkdtemp(join(tmpdir(), 'gm-http-'));
    app = await createTestApp({ accounts, control, gm, locations: new GmLocationsStore(join(dir, 'p.json')) });
    agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/login').send({ username: 'moose', password: 'secret1' }).expect(200);
  });

  afterEach(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  const routes = [
    ['get', '/api/gm/status'],
    ['get', '/api/gm/players'],
    ['get', '/api/gm/places'],
    ['post', '/api/gm/teleport'],
    ['get', '/api/gm/locations'],
    ['post', '/api/gm/locations'],
    ['delete', '/api/gm/locations/x'],
    ['get', '/api/gm/logins'],
    ['post', '/api/gm/logins/1/clear'],
  ] as const;

  describe('GET /api/gm/places', () => {
    it('names the hosted maps and falls back to null for a map the client has no name for', async () => {
      gm.hostedMaps = [0, 13, 65000];

      const res = await agent.get('/api/gm/places');

      expect(res.status).toBe(200);
      expect(res.body.maps).toEqual([
        { id: 0, name: 'Overworld' },
        { id: 13, name: 'Keter Underground' },
        { id: 65000, name: null },
      ]);
    });

    it('offers only destinations on hosted maps', async () => {
      gm.hostedMaps = [0];

      const res = await agent.get('/api/gm/places');

      expect(res.body.destinations.length).toBeGreaterThan(0);
      expect(res.body.destinations.every((d: { mapId: number }) => d.mapId === 0)).toBe(true);
      expect(res.body.destinations).toContainEqual({
        name: 'Lonbaley Training Camp',
        mapId: 0,
        x: 2850.52,
        y: 68.36,
        z: 5004.94,
      });
    });
  });

  it.each(routes)('rejects %s %s without a session and for non-GMs', async (method, path) => {
    expect((await request(app.getHttpServer())[method](path)).status).toBe(401);
    const other = request.agent(app.getHttpServer());
    await other.post('/api/auth/login').send({ username: 'newuser', password: 'secret1' }).expect(200);
    const res = await other[method](path);
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('GM access required');
  });

  describe('logins', () => {
    const login = (extra = {}) => ({
      key: 7,
      account: 'friend',
      character: 'Kaelith' as string | null,
      world: 1,
      channel: 2,
      blocked: true,
      loggedInAt: new Date('2026-10-31T23:37:25.553Z'),
      ...extra,
    });

    it('lists logins with the login time as an ISO string', async () => {
      gm.logins = [login()];

      const res = await agent.get('/api/gm/logins');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([{ ...login(), loggedInAt: '2026-10-31T23:37:25.553Z' }]);
    });

    it('deletes the row when the kick finds no session, because it is stuck', async () => {
      gm.logins = [login(), login({ key: 8, account: 'other', character: 'Moosey' })];

      const res = await agent.post('/api/gm/logins/7/clear');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ outcome: 'cleared' });
      expect(control.kicks).toEqual(['Kaelith']);
      expect(gm.deletedLogins).toEqual([7]);
      expect(gm.audits).toEqual([
        { ip: expect.any(String), gmId: 'moose', command: 'CLEARLOGIN', log: 'Kaelith (friend): stuck login cleared' },
      ]);
    });

    it('leaves the row to the normal logout when the kick closes a real session', async () => {
      gm.logins = [login()];
      control.onKick = () => {
        gm.logins = [];
      };

      const res = await agent.post('/api/gm/logins/7/clear');

      expect(res.body).toEqual({ outcome: 'logged-out' });
      expect(gm.deletedLogins).toEqual([]);
      expect(gm.audits[0].log).toBe('Kaelith (friend): logged out by kick');
    });

    it('waits for a logout that takes a moment', async () => {
      gm.logins = [login()];
      control.onKick = () => {
        setTimeout(() => {
          gm.logins = [];
        }, 10);
      };

      const res = await agent.post('/api/gm/logins/7/clear');

      expect(res.body).toEqual({ outcome: 'logged-out' });
      expect(gm.deletedLogins).toEqual([]);
    });

    it('reports a logout when the row goes just before the delete', async () => {
      gm.logins = [login()];
      gm.loginGoesBeforeDelete = true;

      const res = await agent.post('/api/gm/logins/7/clear');

      expect(res.body).toEqual({ outcome: 'logged-out' });
    });

    it('deletes a login with no character in game without kicking, even when disconnected', async () => {
      gm.logins = [login({ character: null })];
      control.state = 'disconnected';

      const res = await agent.post('/api/gm/logins/7/clear');

      expect(res.body).toEqual({ outcome: 'cleared' });
      expect(control.kicks).toEqual([]);
      expect(gm.deletedLogins).toEqual([7]);
      expect(gm.audits[0].log).toBe('friend: stuck login cleared');
    });

    it('refuses to touch a character login when disconnected, since it could be a real session', async () => {
      gm.logins = [login()];
      control.state = 'disconnected';

      const res = await agent.post('/api/gm/logins/7/clear');

      expect(res.status).toBe(503);
      expect(res.body.message).toBe('Game server is not connected');
      expect(gm.deletedLogins).toEqual([]);
      expect(gm.audits[0].log).toBe('REJECTED disconnected: Kaelith (friend)');
    });

    it('returns 404 for a login that is gone', async () => {
      const res = await agent.post('/api/gm/logins/7/clear');

      expect(res.status).toBe(404);
      expect(control.kicks).toEqual([]);
    });

    it('returns 400 for a key that is not a number', async () => {
      expect((await agent.post('/api/gm/logins/abc/clear')).status).toBe(400);
    });

    it('still reports the outcome when the audit write fails', async () => {
      gm.logins = [login()];
      gm.failAudit = true;

      const res = await agent.post('/api/gm/logins/7/clear');

      expect(res.body).toEqual({ outcome: 'cleared' });
    });

    it('throttles clears', async () => {
      for (let i = 0; i < 30; i++) await agent.post('/api/gm/logins/7/clear').expect(404);
      expect((await agent.post('/api/gm/logins/7/clear')).status).toBe(429);
    });
  });

  it('reports status with channels', async () => {
    const res = await agent.get('/api/gm/status');
    expect(res.body).toEqual({ state: 'connected', worlds: [{ id: 1, name: 'Lapiris' }], channels: [1, 2, 3, 50] });
  });

  it('lists players with class names', async () => {
    const res = await agent.get('/api/gm/players');
    expect(res.body[0]).toEqual(expect.objectContaining({ name: 'Kaelith', className: 'Wizard' }));
    expect(res.body[0]).not.toHaveProperty('classCode');
  });

  it('returns 400 with field errors for an invalid body', async () => {
    const res = await agent.post('/api/gm/teleport').send({ names: ['Kaelith'], destination: { ...position, x: -1 } });
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors).toBeDefined();
  });

  it('returns 422 and audits when no server hosts the location', async () => {
    gm.hosted = false;
    const res = await agent.post('/api/gm/teleport').send({ names: ['Kaelith'], destination: position });
    expect(res.status).toBe(422);
    expect(res.body.message).toBe('No server hosts that location');
    expect(control.moves).toEqual([]);
    expect(gm.audits[0].log).toMatch(/^REJECTED no-server: /);
  });

  it('returns 409 listing offline names', async () => {
    gm.players = [player('Kaelith')];
    const res = await agent.post('/api/gm/teleport').send({ names: ['Kaelith', 'Moosey'], destination: position });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Not online: Moosey');
    expect(control.moves).toEqual([]);
    expect(gm.audits[0].log).toMatch(/^REJECTED offline: /);
  });

  it('treats players in another world as offline', async () => {
    gm.players = [player('Kaelith', { world: 2 })];
    const res = await agent.post('/api/gm/teleport').send({ names: ['Kaelith'], destination: position });
    expect(res.status).toBe(409);
  });

  it('matches names case-insensitively and sends the stored spelling', async () => {
    const res = await agent.post('/api/gm/teleport').send({ names: ['kaelith'], destination: position });
    expect(res.status).toBe(202);
    expect(control.moves[0]).toEqual(expect.objectContaining({ names: ['Kaelith'] }));
    expect(res.body.names).toEqual(['Kaelith']);
  });

  it('returns 503 when the control server is disconnected', async () => {
    control.state = 'disconnected';
    const res = await agent.post('/api/gm/teleport').send({ names: ['Kaelith'], destination: position });
    expect(res.status).toBe(503);
    expect(res.body.message).toBe('Game server is not connected');
    expect(gm.audits[0].log).toMatch(/^REJECTED disconnected: /);
  });

  it('sends a position teleport and audits it', async () => {
    const res = await agent.post('/api/gm/teleport').send({ names: ['Kaelith'], destination: position });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ sent: true, names: ['Kaelith'] });
    expect(control.moves).toEqual([{ ...position, names: ['Kaelith'] }]);
    expect(gm.audits).toEqual([
      { ip: expect.any(String), gmId: 'moose', command: 'TELEPORT', log: 'Kaelith -> w1 ch1 map0 (2800,50,5000)' },
    ]);
  });

  it('sends a character teleport and audits it', async () => {
    const res = await agent
      .post('/api/gm/teleport')
      .send({ names: ['Kaelith'], destination: { kind: 'character', world: 1, target: 'Moosey' } });
    expect(res.status).toBe(202);
    expect(control.moves).toEqual([{ kind: 'character', world: 1, target: 'Moosey', names: ['Kaelith'] }]);
    expect(gm.audits[0].log).toBe('Kaelith -> char Moosey');
  });

  it('still succeeds when the audit write fails', async () => {
    gm.failAudit = true;
    const res = await agent.post('/api/gm/teleport').send({ names: ['Kaelith'], destination: position });
    expect(res.status).toBe(202);
  });

  it('creates, lists and deletes presets', async () => {
    const input = { name: 'Town', world: 1, channel: 1, mapId: 0, x: 2800, y: 50, z: 5000 };
    const created = await agent.post('/api/gm/locations').send(input);
    expect(created.status).toBe(201);
    expect(created.body.id).toEqual(expect.any(String));
    expect((await agent.get('/api/gm/locations')).body).toEqual([created.body]);
    expect((await agent.delete(`/api/gm/locations/${created.body.id}`)).status).toBe(204);
    expect((await agent.delete(`/api/gm/locations/${created.body.id}`)).status).toBe(404);
  });

  it('throttles teleports to 30 per minute', async () => {
    const body = { names: ['Kaelith'], destination: position };
    for (let i = 0; i < 30; i++) expect((await agent.post('/api/gm/teleport').send(body)).status).toBe(202);
    expect((await agent.post('/api/gm/teleport').send(body)).status).toBe(429);
  });
});
