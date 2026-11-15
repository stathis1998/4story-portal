import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { sha1Hex } from '../src/auth/sha1.js';
import { RebirthAnnouncer } from '../src/rebirth/rebirth-announcer.js';
import { ANNOUNCE_SENT, ANNOUNCE_SKIPPED, ANNOUNCE_WAITING } from '../src/rebirth/rebirth.repository.js';
import { StatsService } from '../src/stats/stats.service.js';
import { FakeAccountsRepository, FakeControlClient, FakeGmRepository, FakeRebirthRepository } from './fakes.js';
import { createTestApp } from './test-app.js';

const settingsBody = (overrides = {}) => ({ live: true, priceGold: 2000, percent: 2, limit: 10, ...overrides });

describe('/api rebirth', () => {
  let app: INestApplication;
  let rebirth: FakeRebirthRepository;
  let gm: FakeGmRepository;
  let control: FakeControlClient;
  let player: ReturnType<typeof request.agent>;
  let moose: ReturnType<typeof request.agent>;
  let playerId: number;
  let now: Date;
  let freshBaseline: MockInstance<StatsService['freshBaseline']>;

  beforeAll(() => Logger.overrideLogger(false));

  beforeEach(async () => {
    const accounts = new FakeAccountsRepository();
    accounts.seed('moose', sha1Hex('secret1'));
    playerId = accounts.seed('newuser', sha1Hex('secret1')).userId;
    rebirth = new FakeRebirthRepository();
    now = new Date('2026-11-15T10:00:00Z');
    rebirth.now = () => now;
    rebirth.settingsRow = { live: true, priceGold: 2000, percent: 2, limit: 10 };
    const base = { level: 90, online: false, wornItems: 0, rebirths: 0, bonus: 0, gold: 5000, silver: 0, copper: 0 };
    rebirth.characters = [
      { ...base, charId: 7, userId: playerId, name: 'Mounara' },
      { ...base, charId: 9, userId: playerId + 50, name: 'Stranger' },
    ];
    gm = new FakeGmRepository();
    control = new FakeControlClient();
    app = await createTestApp({ accounts, gm, rebirth, control });
    // The fake stats know no character; a rebirth needs a baseline.
    freshBaseline = vi.spyOn(app.get(StatsService), 'freshBaseline').mockResolvedValue({ kills: 0 });
    player = request.agent(app.getHttpServer());
    await player.post('/api/auth/login').send({ username: 'newuser', password: 'secret1' }).expect(200);
    moose = request.agent(app.getHttpServer());
    await moose.post('/api/auth/login').send({ username: 'moose', password: 'secret1' }).expect(200);
  });

  afterEach(() => app.close());

  const mine = () => rebirth.characters[0];
  const reborn = (priceGold = 2000, id = 7) => player.post(`/api/characters/${id}/rebirth`).send({ priceGold });

  describe('GET /characters/:id/rebirth', () => {
    it('shows what the next rebirth costs and gives', async () => {
      Object.assign(mine(), { rebirths: 1, bonus: 2 });
      const res = await player.get('/api/characters/7/rebirth').expect(200);
      expect(res.body).toMatchObject({
        characterId: 7,
        name: 'Mounara',
        level: 90,
        rebirths: 1,
        bonus: 2,
        open: true,
        next: { number: 2, bonus: 4, priceGold: 4000 },
      });
    });

    it('shows no next rebirth at the limit', async () => {
      Object.assign(mine(), { rebirths: 10, bonus: 20 });
      const res = await player.get('/api/characters/7/rebirth').expect(200);
      expect(res.body.next).toBeNull();
    });

    it('shows rebirth as closed with no price', async () => {
      rebirth.settingsRow = { live: true, priceGold: 0, percent: 2, limit: 10 };
      const res = await player.get('/api/characters/7/rebirth').expect(200);
      expect(res.body.open).toBe(false);
    });

    it('needs a login', async () => {
      await request(app.getHttpServer()).get('/api/characters/7/rebirth').expect(401);
    });

    it("answers 404 for another account's character", async () => {
      await player.get('/api/characters/9/rebirth').expect(404);
      await reborn(2000, 9).expect(404);
      expect(rebirth.rebirthCalls).toEqual([]);
    });
  });

  describe('POST /characters/:id/rebirth', () => {
    it('is reborn and returns the new state', async () => {
      const res = await reborn().expect(200);
      expect(res.body).toMatchObject({ level: 1, rebirths: 1, bonus: 2, wallet: { gold: 3000, silver: 0, copper: 0 } });
      expect(res.body.next).toEqual({ number: 2, bonus: 4, priceGold: 4000 });
      expect(mine()).toMatchObject({ level: 1, rebirths: 1, gold: 3000 });
    });

    it('stores a baseline read past the cache', async () => {
      freshBaseline.mockResolvedValue({ kills: 7 });
      await reborn().expect(200);
      expect(freshBaseline).toHaveBeenCalledWith(7);
      expect(rebirth.rebirthCalls[0]).toMatchObject({
        userId: playerId,
        charId: 7,
        expectedPriceGold: 2000,
        baseline: '{"kills":7}',
        text: '{name} was reborn (rebirth {rebirth})',
      });
    });

    it('answers 503 and stays out of the batch when the stats do not know the character', async () => {
      freshBaseline.mockResolvedValue(null);
      const before = { ...mine() };
      const res = await reborn().expect(503);
      expect(res.body.message).toBe('Rebirth is not available right now. Try again in a minute');
      expect(rebirth.rebirthCalls).toEqual([]);
      expect(mine()).toEqual(before);
    });

    it.each([
      ['closed', { settingsRow: { live: false, priceGold: 2000, percent: 2, limit: 10 } }, 409, 'Rebirth is closed right now'],
      ['closed with no price', { settingsRow: { live: true, priceGold: 0, percent: 2, limit: 10 } }, 409, 'Rebirth is closed right now'],
      ['online', { row: { online: true } }, 409, 'Log out of the game with this character first'],
      ['level 1', { row: { level: 1 } }, 422, 'This character is not level 90 yet'],
    ])('refuses %s before reading the baseline', async (_name, change, status, message) => {
      const { settingsRow, row } = change as { settingsRow?: typeof rebirth.settingsRow; row?: Partial<ReturnType<typeof mine>> };
      if (settingsRow) rebirth.settingsRow = settingsRow;
      if (row) Object.assign(mine(), row);
      const res = await reborn().expect(status);
      expect(res.body.message).toBe(message);
      expect(freshBaseline).not.toHaveBeenCalled();
      expect(rebirth.rebirthCalls).toEqual([]);
    });

    it('drops the stats cache after a rebirth', async () => {
      const drop = vi.spyOn(app.get(StatsService), 'dropCache');
      await reborn(1).expect(409);
      expect(drop).not.toHaveBeenCalled();
      await reborn().expect(200);
      expect(drop).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['closed', { settingsRow: { live: false, priceGold: 2000, percent: 2, limit: 10 } }, 409, 'Rebirth is closed right now'],
      ['online', { row: { online: true } }, 409, 'Log out of the game with this character first'],
      ['a changed price', { price: 1000 }, 409, 'The price has changed. Check it and confirm again'],
      ['too low a level', { row: { level: 89 } }, 422, 'This character is not level 90 yet'],
      ['worn gear', { row: { wornItems: 2 } }, 422, 'Take off everything this character is wearing first'],
      ['the limit', { row: { rebirths: 10 } }, 422, 'This character has reached the rebirth limit'],
      ['too little Gold', { row: { gold: 1999, silver: 999 } }, 422, 'This character does not have enough Gold'],
    ])('answers %s with %i and %s', async (_name, change, status, message) => {
      const { settingsRow, row, price } = change as {
        settingsRow?: typeof rebirth.settingsRow;
        row?: Partial<ReturnType<typeof mine>>;
        price?: number;
      };
      if (settingsRow) rebirth.settingsRow = settingsRow;
      if (row) Object.assign(mine(), row);
      const before = { ...mine() };
      const res = await reborn(price ?? 2000).expect(status);
      expect(res.body.message).toBe(message);
      expect(mine()).toEqual(before);
      expect(rebirth.logRows).toEqual([]);
    });

    it('refuses a body without a price', async () => {
      await player.post('/api/characters/7/rebirth').send({}).expect(400);
      await reborn(0).expect(400);
      expect(rebirth.rebirthCalls).toEqual([]);
    });

    it('refuses a price above what rebirth 20 at the highest price costs', async () => {
      await reborn(2_000_001).expect(400);
      expect(rebirth.rebirthCalls).toEqual([]);
    });
  });

  describe('GM routes', () => {
    it('refuses the GM routes to a player', async () => {
      await player.get('/api/gm/rebirth').expect(403);
      await player.put('/api/gm/rebirth/settings').send(settingsBody({ live: false })).expect(403);
      expect(rebirth.settingsRow.live).toBe(true);
    });

    it('saves the settings, writes the audit line and returns the page', async () => {
      await reborn().expect(200);
      const res = await moose.put('/api/gm/rebirth/settings').send(settingsBody({ priceGold: 3000, percent: 3, limit: 5 })).expect(200);
      expect(rebirth.settingsRow).toEqual({ live: true, priceGold: 3000, percent: 3, limit: 5 });
      expect(res.body).toMatchObject({
        settings: { live: true, priceGold: 3000, percent: 3, limit: 5 },
        reborn: 1,
        recent: [{ name: 'Mounara', rebirth: 1, bonus: 2, priceGold: 2000, at: now.toISOString() }],
      });
      expect(gm.audits).toEqual([
        expect.objectContaining({ gmId: 'moose', command: 'REBIRTH', log: 'SET on price 3000 percent 3 limit 5' }),
      ]);
      expect(mine().bonus).toBe(3);
    });

    it('shows the newest 20 rebirths', async () => {
      rebirth.logRows = Array.from({ length: 25 }, (_, i) => ({
        id: i + 1,
        userId: playerId,
        charId: 7,
        name: 'Mounara',
        rebirth: 1,
        bonus: 2,
        priceGold: 2000,
        at: now,
        ageSeconds: 0,
        text: '',
        announced: ANNOUNCE_SENT,
      }));
      const res = await moose.get('/api/gm/rebirth').expect(200);
      expect(res.body.recent).toHaveLength(20);
      expect(res.body.recent.map((row: { id: number }) => row.id)).toEqual(Array.from({ length: 20 }, (_, i) => 25 - i));
    });

    it('refuses to open rebirth without a price', async () => {
      const res = await moose.put('/api/gm/rebirth/settings').send(settingsBody({ priceGold: 0 })).expect(400);
      expect(JSON.stringify(res.body)).toContain('Set a price before opening rebirth');
      expect(gm.audits).toEqual([]);
    });
  });

  describe('announcements', () => {
    it('announces a rebirth once', async () => {
      await reborn().expect(200);
      const announcer = app.get(RebirthAnnouncer);
      expect(await announcer.tick()).toBe(1);
      expect(control.announcements).toEqual(['Mounara was reborn (rebirth 1)']);
      expect(rebirth.logRows[0].announced).toBe(ANNOUNCE_SENT);
      expect(await announcer.tick()).toBe(0);
      expect(control.announcements).toHaveLength(1);
    });

    it('leaves an announcement waiting while the control server is down, and skips it once it is old', async () => {
      await reborn().expect(200);
      const announcer = app.get(RebirthAnnouncer);
      control.state = 'disconnected';
      expect(await announcer.tick()).toBe(0);
      expect(rebirth.logRows[0].announced).toBe(ANNOUNCE_WAITING);

      control.state = 'connected';
      now = new Date(now.getTime() + 601_000);
      expect(await announcer.tick()).toBe(0);
      expect(control.announcements).toEqual([]);
      expect(rebirth.logRows[0].announced).toBe(ANNOUNCE_SKIPPED);
    });

    it('sends a waiting announcement once the control server is back', async () => {
      await reborn().expect(200);
      const announcer = app.get(RebirthAnnouncer);
      control.state = 'disconnected';
      await announcer.tick();
      control.state = 'connected';
      expect(await announcer.tick()).toBe(1);
    });
  });
});
