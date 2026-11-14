import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sha1Hex } from '../src/auth/sha1.js';
import { itemIcons } from '../src/gm/game-icons.generated.js';
import { WheelAnnouncer } from '../src/wheel/wheel-announcer.js';
import { ANNOUNCE_SENT, ANNOUNCE_SKIPPED, ANNOUNCE_WAITING } from '../src/wheel/wheel.repository.js';
import { pickPrize, WheelService } from '../src/wheel/wheel.service.js';
import { FakeAccountsRepository, FakeControlClient, FakeGmRepository, FakeWheelRepository } from './fakes.js';
import { createTestApp } from './test-app.js';

const POTION = 8001;
const NOT_IN_CLIENT = 32_000;
const prizeBody = (overrides = {}) => ({
  name: 'Five potions',
  weight: 4,
  order: 2,
  enabled: true,
  announce: false,
  gold: 0,
  silver: 50,
  copper: 0,
  items: [{ itemId: POTION, count: 5 }],
  ...overrides,
});

describe('pickPrize', () => {
  const prizes = [
    { name: 'a', weight: 3 },
    { name: 'b', weight: 1 },
    { name: 'c', weight: 2 },
  ];

  it.each([
    [0, 'a'],
    [2, 'a'],
    [3, 'b'],
    [4, 'c'],
    [5, 'c'],
  ])('a roll of %i lands on %s', (roll, name) => {
    expect(pickPrize(prizes, roll).name).toBe(name);
  });

  it('always lands on a lone prize', () => {
    expect(pickPrize([{ name: 'only', weight: 7 }], 6).name).toBe('only');
  });
});

describe('/api/wheel', () => {
  let app: INestApplication;
  let wheel: FakeWheelRepository;
  let gm: FakeGmRepository;
  let control: FakeControlClient;
  let player: ReturnType<typeof request.agent>;
  let moose: ReturnType<typeof request.agent>;
  let playerId: number;
  let now: Date;

  beforeAll(() => Logger.overrideLogger(false));

  beforeEach(async () => {
    const accounts = new FakeAccountsRepository();
    accounts.seed('moose', sha1Hex('secret1'));
    playerId = accounts.seed('newuser', sha1Hex('secret1')).userId;
    wheel = new FakeWheelRepository();
    now = new Date('2026-11-14T10:00:00Z');
    wheel.now = () => now;
    wheel.items = [{ itemId: POTION, name: 'Small Vitality Potion', stack: 30 }];
    wheel.characters = [
      { charId: 7, userId: playerId, name: 'Mounara', level: 60 },
      { charId: 8, userId: playerId, name: 'Tiny', level: 19 },
      { charId: 9, userId: playerId + 50, name: 'Stranger', level: 90 },
    ];
    gm = new FakeGmRepository();
    control = new FakeControlClient();
    app = await createTestApp({ accounts, gm, control, wheel });
    player = request.agent(app.getHttpServer());
    await player.post('/api/auth/login').send({ username: 'newuser', password: 'secret1' }).expect(200);
    moose = request.agent(app.getHttpServer());
    await moose.post('/api/auth/login').send({ username: 'moose', password: 'secret1' }).expect(200);
  });

  afterEach(() => app.close());

  /** Makes the next spins land on this roll. */
  const roll = (value: number) => {
    const calls: number[] = [];
    app.get(WheelService).random = (max) => {
      calls.push(max);
      return value;
    };
    return calls;
  };

  describe('GET /wheel', () => {
    it('needs a portal login', async () => {
      await request(app.getHttpServer()).get('/api/wheel').expect(401);
    });

    it('shows the enabled prizes in wheel order with their chances, closed until switched on', async () => {
      wheel.addPrize({ name: 'Last', weight: 1, order: 9 });
      wheel.addPrize({ name: 'Hidden', weight: 50, order: 5, enabled: false });
      wheel.addPrize({ name: 'First', weight: 3, order: 1, announce: true, gold: 0, items: [{ itemId: POTION, count: 2 }] });

      const res = await player.get('/api/wheel').expect(200);

      expect(res.body).toMatchObject({ live: false, minLevel: 20, today: null, mine: [], winners: [] });
      expect(res.body.secondsToReset).toBe(14 * 3600);
      expect(res.body.prizes).toEqual([
        {
          id: 3,
          name: 'First',
          chance: 75,
          announce: true,
          reward: { gold: 0, silver: 0, copper: 0, items: [{ itemId: POTION, count: 2, name: 'Small Vitality Potion', icon: itemIcons[POTION] }] },
        },
        { id: 1, name: 'Last', chance: 25, announce: false, reward: { gold: 1, silver: 0, copper: 0, items: [] } },
      ]);
    });

    it('shows an empty prize with no reward', async () => {
      wheel.addPrize({ name: 'No luck', gold: 0 });
      const res = await player.get('/api/wheel').expect(200);
      expect(res.body.prizes[0]).toMatchObject({ name: 'No luck', chance: 100, reward: null });
    });

    it('still opens, closed and empty, when the tables cannot be read', async () => {
      wheel.failWith = new Error('Invalid object name TPORTALWHEELPRIZE');
      const res = await player.get('/api/wheel').expect(200);
      expect(res.body).toMatchObject({ live: false, prizes: [], today: null, secondsToReset: 0 });
    });
  });

  describe('POST /wheel/spin', () => {
    beforeEach(() => {
      wheel.liveFlag = true;
      wheel.addPrize({ name: '100 Luna', weight: 3, gold: 0, silver: 100 });
      wheel.addPrize({ name: 'Jackpot', weight: 1, gold: 10, announce: true });
    });

    it('needs a portal login', async () => {
      await request(app.getHttpServer()).post('/api/wheel/spin').send({ characterId: 7 }).expect(401);
    });

    it('needs a character', async () => {
      await player.post('/api/wheel/spin').send({}).expect(400);
      expect(wheel.asked).toEqual([]);
    });

    it('picks by weight, sends the prize to the character and answers with it', async () => {
      const calls = roll(3);

      const res = await player.post('/api/wheel/spin').send({ characterId: 7 }).expect(200);

      // Out of a total weight of 4, a roll of 3 is past the first prize.
      expect(calls).toEqual([4]);
      expect(res.body.prizeId).toBe(2);
      expect(res.body.spin).toMatchObject({ character: 'Mounara', prize: 'Jackpot', reward: { gold: 10, silver: 0, copper: 0, items: [] } });
      expect(res.body.state.today).toEqual(res.body.spin);
      expect(res.body.state.mine).toEqual([res.body.spin]);
      expect(res.body.state.winners).toEqual([res.body.spin]);
      expect(wheel.asked).toEqual([
        {
          userId: playerId,
          charId: 7,
          prizeId: 2,
          minLevel: 20,
          sender: 'Wheel of Fortune',
          title: 'Wheel of Fortune: {prize}',
          message: expect.stringContaining('won {prize}'),
          text: '{name} won {prize} on the Wheel of Fortune',
        },
      ]);
    });

    it('lands on the first prize for a low roll, which is not a listed winner', async () => {
      roll(0);
      const res = await player.post('/api/wheel/spin').send({ characterId: 7 }).expect(200);
      expect(res.body.prizeId).toBe(1);
      expect(res.body.spin.reward).toEqual({ gold: 0, silver: 100, copper: 0, items: [] });
      expect(res.body.state.winners).toEqual([]);
    });

    it('rolls over the enabled prizes only', async () => {
      wheel.addPrize({ name: 'Off', weight: 100, enabled: false });
      const calls = roll(0);
      await player.post('/api/wheel/spin').send({ characterId: 7 }).expect(200);
      expect(calls).toEqual([4]);
    });

    it('allows one spin a day, then another the next day', async () => {
      roll(0);
      await player.post('/api/wheel/spin').send({ characterId: 7 }).expect(200);

      const again = await player.post('/api/wheel/spin').send({ characterId: 7 }).expect(409);
      expect(again.body.message).toBe('You have already spun today');
      expect((await player.get('/api/wheel')).body.today).toMatchObject({ prize: '100 Luna' });

      now = new Date('2026-11-15T00:00:05Z');
      expect((await player.get('/api/wheel')).body.today).toBeNull();
      await player.post('/api/wheel/spin').send({ characterId: 7 }).expect(200);
      expect(wheel.spinRows).toHaveLength(2);
    });

    it('gives each account its own spin', async () => {
      roll(0);
      wheel.characters.push({ charId: 20, userId: 100, name: 'Moosey', level: 90 });
      await player.post('/api/wheel/spin').send({ characterId: 7 }).expect(200);
      await moose.post('/api/wheel/spin').send({ characterId: 20 }).expect(200);
    });

    it.each([
      ['under level 20', 8],
      ["someone else's", 9],
      ['unknown', 12345],
    ])('refuses a character that is %s, and keeps the spin', async (_, characterId) => {
      roll(0);
      const res = await player.post('/api/wheel/spin').send({ characterId }).expect(422);
      expect(res.body.message).toBe('Pick one of your own characters at level 20 or higher');
      expect(wheel.spinRows).toEqual([]);
    });

    it('refuses while the wheel is switched off', async () => {
      wheel.liveFlag = false;
      const res = await player.post('/api/wheel/spin').send({ characterId: 7 }).expect(503);
      expect(res.body.message).toBe('The wheel is not open yet');
    });

    it('refuses when no prize is enabled', async () => {
      wheel.prizeRows.forEach((row) => (row.enabled = false));
      const res = await player.post('/api/wheel/spin').send({ characterId: 7 }).expect(503);
      expect(res.body.message).toBe('The wheel has no prizes yet');
      expect(wheel.asked).toEqual([]);
    });

    it('picks again when a GM disables the prize between the pick and the spin', async () => {
      roll(0);
      wheel.beforeSpin = () => {
        wheel.prizeRows[0].enabled = false;
      };

      const res = await player.post('/api/wheel/spin').send({ characterId: 7 }).expect(200);

      expect(wheel.asked.map((asked) => asked.prizeId)).toEqual([1, 2]);
      expect(res.body.prizeId).toBe(2);
    });

    it('answers 503 when the tables cannot be used', async () => {
      wheel.failWith = new Error('Invalid object name');
      const res = await player.post('/api/wheel/spin').send({ characterId: 7 }).expect(503);
      expect(res.body.message).toBe('The wheel is not available right now');
    });
  });

  describe('announcements', () => {
    let announcer: WheelAnnouncer;

    beforeEach(async () => {
      announcer = app.get(WheelAnnouncer);
      wheel.liveFlag = true;
      wheel.addPrize({ name: 'Jackpot', gold: 10, announce: true });
      roll(0);
      await player.post('/api/wheel/spin').send({ characterId: 7 }).expect(200);
    });

    const later = (seconds: number) => {
      now = new Date(now.getTime() + seconds * 1000);
    };

    it('waits until the wheel on the screen has stopped', async () => {
      later(14);
      expect(await announcer.tick()).toBe(0);
      expect(control.announcements).toEqual([]);

      later(1);
      expect(await announcer.tick()).toBe(1);
      expect(control.announcements).toEqual(['Mounara won Jackpot on the Wheel of Fortune']);
      expect(wheel.spinRows[0].announced).toBe(ANNOUNCE_SENT);

      expect(await announcer.tick()).toBe(0);
      expect(control.announcements).toHaveLength(1);
    });

    it('says nothing for a quiet prize', async () => {
      wheel.prizeRows[0].announce = false;
      later(86_400);
      await player.post('/api/wheel/spin').send({ characterId: 7 }).expect(200);
      wheel.spinRows[0].announced = ANNOUNCE_SENT;
      later(20);

      expect(await announcer.tick()).toBe(0);
      expect(control.announcements).toEqual([]);
    });

    it('skips a win that is more than 10 minutes old', async () => {
      later(601);
      expect(await announcer.tick()).toBe(0);
      expect(control.announcements).toEqual([]);
      expect(wheel.spinRows[0].announced).toBe(ANNOUNCE_SKIPPED);
    });

    it('leaves a win waiting while the control server is down', async () => {
      control.state = 'disconnected';
      later(20);
      expect(await announcer.tick()).toBe(0);
      expect(wheel.spinRows[0].announced).toBe(ANNOUNCE_WAITING);

      control.state = 'connected';
      expect(await announcer.tick()).toBe(1);
    });

    it('does not say a win another portal process has taken', async () => {
      wheel.claimedElsewhere = true;
      later(20);
      expect(await announcer.tick()).toBe(0);
      expect(control.announcements).toEqual([]);
    });

    it('survives a database that cannot be read', async () => {
      wheel.failWith = new Error('Invalid object name');
      expect(await announcer.tick()).toBe(0);
    });
  });

  describe('GM routes', () => {
    const routes = [
      ['get', '/api/gm/wheel'],
      ['post', '/api/gm/wheel/prizes'],
      ['put', '/api/gm/wheel/prizes/1'],
      ['delete', '/api/gm/wheel/prizes/1'],
      ['put', '/api/gm/wheel/live'],
    ] as const;

    it.each(routes)('%s %s is 401 when logged out', async (method, path) => {
      expect((await request(app.getHttpServer())[method](path)).status).toBe(401);
    });

    it.each(routes)('%s %s is 403 for a non-GM', async (method, path) => {
      expect((await player[method](path)).status).toBe(403);
    });

    it('lists every prize, with a chance of 0 for a disabled one', async () => {
      wheel.addPrize({ name: 'On', weight: 1 });
      wheel.addPrize({ name: 'Also on', weight: 3 });
      wheel.addPrize({ name: 'Off', weight: 6, enabled: false });
      wheel.liveFlag = true;

      const res = await moose.get('/api/gm/wheel').expect(200);

      expect(res.body).toMatchObject({ live: true, control: 'connected', spinsToday: 0 });
      expect(res.body.prizes.map((prize: { name: string; chance: number }) => [prize.name, prize.chance])).toEqual([
        ['On', 25],
        ['Also on', 75],
        ['Off', 0],
      ]);
      expect(res.body.prizes[0]).toMatchObject({ id: 1, weight: 1, enabled: true, announce: false, gold: 1, items: [], reward: { gold: 1 } });
    });

    it('adds a prize and writes it to the audit log', async () => {
      const res = await moose.post('/api/gm/wheel/prizes').send(prizeBody()).expect(200);

      expect(res.body.prizes).toHaveLength(1);
      expect(res.body.prizes[0]).toMatchObject({
        id: 1,
        name: 'Five potions',
        weight: 4,
        order: 2,
        chance: 100,
        silver: 50,
        items: [{ itemId: POTION, count: 5 }],
        reward: { items: [{ itemId: POTION, count: 5, name: 'Small Vitality Potion', icon: itemIcons[POTION] }] },
      });
      expect(gm.audits).toEqual([
        expect.objectContaining({
          gmId: 'moose',
          command: 'WHEEL',
          log: 'ADD 1 "Five potions" weight 4 order 2 enabled money 0/50/0 items 8001x5',
        }),
      ]);
    });

    it('accepts an empty prize as a no luck segment', async () => {
      const res = await moose.post('/api/gm/wheel/prizes').send(prizeBody({ name: 'No luck', silver: 0, items: [] })).expect(200);
      expect(res.body.prizes[0].reward).toBeNull();
    });

    it.each([
      ['no name', { name: '  ' }],
      ['a name the game cannot show', { name: 'Prémio' }],
      ['a name over 40 characters', { name: 'x'.repeat(41) }],
      ['a weight of 0', { weight: 0 }],
      ['a weight that is not whole', { weight: 1.5 }],
      ['four items', { items: [1, 2, 3, 4].map(() => ({ itemId: POTION, count: 1 })) }],
      ['999 Luna and one more', { silver: 1000 }],
    ])('refuses %s', async (_, overrides) => {
      await moose.post('/api/gm/wheel/prizes').send(prizeBody(overrides)).expect(400);
      expect(wheel.prizeRows).toEqual([]);
    });

    it.each([
      ['an item the game does not have', [{ itemId: 31_999, count: 1 }], 'Unknown items: 31999'],
      ['more than the item stacks to', [{ itemId: POTION, count: 31 }], 'Small Vitality Potion stacks to 30'],
    ])('refuses %s', async (_, items, message) => {
      const res = await moose.post('/api/gm/wheel/prizes').send(prizeBody({ items })).expect(422);
      expect(res.body.message).toBe(message);
      expect(wheel.prizeRows).toEqual([]);
    });

    it('refuses an item the game client does not have', async () => {
      expect(Object.hasOwn(itemIcons, NOT_IN_CLIENT)).toBe(false);
      wheel.items.push({ itemId: NOT_IN_CLIENT, name: 'Ghost', stack: 1 });
      const res = await moose.post('/api/gm/wheel/prizes').send(prizeBody({ items: [{ itemId: NOT_IN_CLIENT, count: 1 }] })).expect(422);
      expect(res.body.message).toBe(`Not in the game client: ${NOT_IN_CLIENT}`);
    });

    it('holds at most 20 prizes', async () => {
      for (let index = 0; index < 20; index++) wheel.addPrize();
      const res = await moose.post('/api/gm/wheel/prizes').send(prizeBody()).expect(422);
      expect(res.body.message).toBe('The wheel holds at most 20 prizes');
    });

    it('changes a prize', async () => {
      wheel.addPrize({ name: 'Old' });

      const res = await moose.put('/api/gm/wheel/prizes/1').send(prizeBody({ name: 'New', enabled: false, announce: true })).expect(200);

      expect(res.body.prizes[0]).toMatchObject({ id: 1, name: 'New', enabled: false, announce: true, chance: 0 });
      expect(gm.audits[0].log).toBe('SET 1 "New" weight 4 order 2 disabled announce money 0/50/0 items 8001x5');
    });

    it('answers 404 for a prize that is not there', async () => {
      await moose.put('/api/gm/wheel/prizes/5').send(prizeBody()).expect(404);
      await moose.delete('/api/gm/wheel/prizes/5').expect(404);
      expect(gm.audits).toEqual([]);
    });

    it('deletes a prize', async () => {
      wheel.addPrize({ name: 'Gone' });
      const res = await moose.delete('/api/gm/wheel/prizes/1').expect(200);
      expect(res.body.prizes).toEqual([]);
      expect(gm.audits[0].log).toMatch(/^DEL 1 "Gone"/);
    });

    it('switches the wheel on and off', async () => {
      expect((await moose.put('/api/gm/wheel/live').send({ live: true }).expect(200)).body.live).toBe(true);
      expect((await player.get('/api/wheel')).body.live).toBe(true);
      expect((await moose.put('/api/gm/wheel/live').send({ live: false }).expect(200)).body.live).toBe(false);
      expect(gm.audits.map((audit) => audit.log)).toEqual(['ON', 'OFF']);
      await moose.put('/api/gm/wheel/live').send({ live: 'yes' }).expect(400);
    });

    it('counts the spins made today', async () => {
      wheel.liveFlag = true;
      wheel.addPrize();
      await player.post('/api/wheel/spin').send({ characterId: 7 }).expect(200);
      expect((await moose.get('/api/gm/wheel')).body.spinsToday).toBe(1);
    });

    it('answers 503 when a change cannot be saved', async () => {
      wheel.failWith = new Error('Invalid object name');
      await moose.put('/api/gm/wheel/live').send({ live: true }).expect(503);
      await moose.post('/api/gm/wheel/prizes').send(prizeBody()).expect(503);
    });

    it('still saves when the audit log cannot be written', async () => {
      gm.failAudit = true;
      await moose.post('/api/gm/wheel/prizes').send(prizeBody()).expect(200);
      expect(wheel.prizeRows).toHaveLength(1);
    });
  });
});
