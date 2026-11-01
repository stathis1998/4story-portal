import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import type { GmEventInput } from '@4story-portal/shared';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sha1Hex } from '../src/auth/sha1.js';
import {
  ControlBadReplyError,
  ControlRefusedError,
  ControlTimeoutError,
  ControlUnavailableError,
} from '../src/control/control-client.js';
import { type ControlEvent, EVENT_KIND } from '../src/control/control-protocol.js';
import { FakeAccountsRepository, FakeControlClient, FakeGmRepository } from './fakes.js';
import { createTestApp } from './test-app.js';

const unix = (year: number, month: number, day: number, hour: number, minute: number) =>
  BigInt(new Date(year, month - 1, day, hour, minute).getTime() / 1000);

const wire = (overrides: Partial<ControlEvent> = {}): ControlEvent => ({
  index: 4,
  type: 1,
  state: 0,
  groupId: 1,
  serverType: 3,
  serverId: 0,
  start: unix(2026, 11, 6, 18, 0),
  end: unix(2026, 11, 8, 23, 0),
  value: 100,
  mapId: 255,
  startAlarm: 0,
  endAlarm: 1,
  startMessage: 'On',
  endMessage: 'Off',
  title: 'Weekend',
  partTime: 1,
  lotteryMessage: '',
  cashItems: [],
  monsterStartAction: 0,
  monsterEndAction: 0,
  spawnIds: [],
  regens: [],
  lottery: [],
  ...overrides,
});

const special = wire({
  index: 7,
  type: 12,
  state: 1,
  value: 1,
  title: 'Boss night',
  monsterEndAction: 7,
  spawnIds: [100, 200],
  groupId: 0,
});

const input = (overrides: Partial<GmEventInput> = {}): GmEventInput => ({
  type: 1,
  world: 1,
  title: 'Weekend',
  bonus: 100,
  mapId: null,
  schedule: { mode: 'period', start: '2026-11-06T18:00', end: '2026-11-08T23:00' },
  startMessage: 'On',
  endMessage: 'Off',
  startNoticeMinutes: 0,
  endNoticeMinutes: 1,
  ...overrides,
});

describe('/api/gm/events', () => {
  let app: INestApplication;
  let control: FakeControlClient;
  let gm: FakeGmRepository;
  let agent: ReturnType<typeof request.agent>;

  beforeAll(() => Logger.overrideLogger(false));

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 10, 1, 12, 34, 56) });
    const accounts = new FakeAccountsRepository();
    accounts.seed('moose', sha1Hex('secret1'));
    accounts.seed('newuser', sha1Hex('secret1'));
    control = new FakeControlClient();
    gm = new FakeGmRepository();
    app = await createTestApp({ accounts, control, gm });
    agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/login').send({ username: 'moose', password: 'secret1' }).expect(200);
  });

  afterEach(async () => {
    await app.close();
    vi.useRealTimers();
  });

  const routes = [
    ['get', '/api/gm/events'],
    ['post', '/api/gm/events'],
    ['put', '/api/gm/events/4'],
    ['delete', '/api/gm/events/4'],
  ] as const;

  it.each(routes)('%s %s is 401 when logged out', async (method, path) => {
    expect((await request(app.getHttpServer())[method](path)).status).toBe(401);
  });

  it.each(routes)('%s %s is 403 for a non-GM', async (method, path) => {
    const other = request.agent(app.getHttpServer());
    await other.post('/api/auth/login').send({ username: 'newuser', password: 'secret1' }).expect(200);
    expect((await other[method](path)).status).toBe(403);
  });

  describe('GET', () => {
    it('returns the server clock in wall clock time', async () => {
      const res = await agent.get('/api/gm/events');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ serverNow: '2026-11-01T12:34', events: [] });
    });

    it('maps a one period event, with map 255 as null', async () => {
      control.events = [wire({ state: 1 })];
      const res = await agent.get('/api/gm/events');
      expect(res.body.events).toEqual([
        {
          index: 4,
          type: 1,
          typeName: 'EXP',
          editable: true,
          running: true,
          world: 1,
          title: 'Weekend',
          bonus: 100,
          mapId: null,
          schedule: { mode: 'period', start: '2026-11-06T18:00', end: '2026-11-08T23:00' },
          startMessage: 'On',
          endMessage: 'Off',
          startNoticeMinutes: 0,
          endNoticeMinutes: 1,
        },
      ]);
    });

    it('maps a daily drop event on one map', async () => {
      control.events = [wire({ type: 3, mapId: 600, partTime: 0 })];
      const [event] = (await agent.get('/api/gm/events')).body.events;
      expect(event).toMatchObject({ typeName: 'Item drop', mapId: 600, running: false });
      expect(event.schedule.mode).toBe('daily');
    });

    it('ignores the map of a type that has no map', async () => {
      control.events = [wire({ type: 1, mapId: 0 })];
      const [event] = (await agent.get('/api/gm/events')).body.events;
      expect(event.mapId).toBeNull();
    });

    it('shows a special event as stop-only, with no bonus', async () => {
      control.events = [special];
      const [event] = (await agent.get('/api/gm/events')).body.events;
      expect(event).toMatchObject({ typeName: 'Monster spawn', editable: false, bonus: null, mapId: null, world: 0 });
    });

    it('shows a Happy event for all worlds as stop-only, keeping its bonus', async () => {
      control.events = [wire({ groupId: 0 })];
      const [event] = (await agent.get('/api/gm/events')).body.events;
      expect(event).toMatchObject({ editable: false, bonus: 100, world: 0 });
    });

    it('does not talk about a change when the list gets no reply', async () => {
      control.failWith = new ControlTimeoutError();
      const res = await agent.get('/api/gm/events');
      expect(res.status).toBe(503);
      expect(res.body.message).toBe('The game server did not reply.');
    });

    it('names a type it does not know', async () => {
      control.events = [wire({ type: 16 })];
      const [event] = (await agent.get('/api/gm/events')).body.events;
      expect(event).toMatchObject({ typeName: 'Type 16', editable: false, bonus: null });
    });

    it('is 503 while disconnected', async () => {
      control.state = 'disconnected';
      const res = await agent.get('/api/gm/events');
      expect(res.status).toBe(503);
      expect(res.body.message).toBe('Game server is not connected');
    });
  });

  describe('POST', () => {
    it('sends an add with the fixed fields and responds with the assigned index', async () => {
      const res = await agent.post('/api/gm/events').send(input());

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ index: 50, title: 'Weekend', running: false });
      expect(control.changes).toEqual([{ kind: EVENT_KIND.ADD, event: wire({ index: 0 }) }]);
    });

    it('marks a daily event with partTime 0 and sends the first date and last date', async () => {
      await agent
        .post('/api/gm/events')
        .send(input({ schedule: { mode: 'daily', start: '2026-11-02T20:00', end: '2026-11-07T22:00' } }))
        .expect(201);

      expect(control.changes[0].event).toMatchObject({
        partTime: 0,
        start: unix(2026, 11, 2, 20, 0),
        end: unix(2026, 11, 7, 22, 0),
      });
    });

    it('sends 255 for all maps, and the map for a drop event on one', async () => {
      await agent.post('/api/gm/events').send(input({ type: 3 })).expect(201);
      await agent.post('/api/gm/events').send(input({ type: 3, mapId: 0 })).expect(201);

      expect(control.changes.map((change) => change.event.mapId)).toEqual([255, 0]);
    });

    it('sends the notice minutes as alarms', async () => {
      await agent.post('/api/gm/events').send(input({ startNoticeMinutes: 5, endNoticeMinutes: 10 })).expect(201);
      expect(control.changes[0].event).toMatchObject({ startAlarm: 5, endAlarm: 10 });
    });

    it('accepts a start in the past, which is how an event starts now', async () => {
      const schedule = { mode: 'period' as const, start: '2026-11-01T12:34', end: '2026-11-01T12:39' };
      await agent.post('/api/gm/events').send(input({ schedule })).expect(201);
    });

    it('is 400 for an invalid body, with the field named', async () => {
      const res = await agent.post('/api/gm/events').send(input({ title: 'x'.repeat(51) }));
      expect(res.status).toBe(400);
      expect(res.body.fieldErrors.title).toBeDefined();
      expect(control.changes).toEqual([]);
    });

    it('is 422 when the end has passed', async () => {
      const schedule = { mode: 'period' as const, start: '2026-10-01T10:00', end: '2026-11-01T12:34' };
      const res = await agent.post('/api/gm/events').send(input({ schedule }));
      expect(res.status).toBe(422);
      expect(res.body.message).toBe('The end time has already passed');
      expect(control.changes).toEqual([]);
    });

    it('is 422 for a world that is not available', async () => {
      const res = await agent.post('/api/gm/events').send(input({ world: 2 }));
      expect(res.status).toBe(422);
      expect(res.body.message).toBe('That world is not available');
    });

    it('is 503, not a world error, while disconnected', async () => {
      control.state = 'disconnected';
      control.worlds = [];
      expect((await agent.post('/api/gm/events').send(input())).status).toBe(503);
    });

    it('names the event an overlap refusal was about', async () => {
      control.changeResult = 4;
      control.events = [wire({ index: 9, title: 'Already on', start: unix(2026, 11, 8, 23, 0), end: unix(2026, 11, 9, 0, 0) })];

      const res = await agent.post('/api/gm/events').send(input());

      expect(res.status).toBe(409);
      expect(res.body.message).toBe('Overlaps Already on: only one EXP event can be on at a time.');
    });

    it('does not blame an event of another type or at other dates', async () => {
      control.changeResult = 4;
      control.events = [
        wire({ index: 9, type: 3, title: 'Other type' }),
        wire({ index: 10, title: 'Other dates', start: unix(2026, 12, 1, 0, 0), end: unix(2026, 12, 2, 0, 0) }),
      ];

      const res = await agent.post('/api/gm/events').send(input());

      expect(res.status).toBe(409);
      expect(res.body.message).toBe('The game server refused those times.');
    });

    it('does not blame a daily event whose window is at another time', async () => {
      control.changeResult = 4;
      control.events = [
        wire({ index: 9, partTime: 0, title: 'Mornings', start: unix(2026, 11, 2, 8, 0), end: unix(2026, 11, 7, 9, 0) }),
      ];
      const schedule = { mode: 'daily' as const, start: '2026-11-02T20:00', end: '2026-11-07T22:00' };

      const res = await agent.post('/api/gm/events').send(input({ schedule }));

      expect(res.body.message).toBe('The game server refused those times.');
    });

    it('blames a daily event when a one period event overlaps its dates at any time', async () => {
      control.changeResult = 4;
      control.events = [
        wire({ index: 9, partTime: 0, title: 'Mornings', start: unix(2026, 11, 2, 8, 0), end: unix(2026, 11, 7, 9, 0) }),
      ];

      const res = await agent.post('/api/gm/events').send(input());

      expect(res.body.message).toBe('Overlaps Mornings: only one EXP event can be on at a time.');
    });

    it('is 502 for another refusal', async () => {
      control.changeResult = 1;
      const res = await agent.post('/api/gm/events').send(input());
      expect(res.status).toBe(502);
      expect(res.body.message).toBe('The game server could not save the event');
    });
  });

  describe('PUT', () => {
    it('sends an update with state 0 for a running event, so the server restarts it', async () => {
      control.events = [wire({ state: 1 })];

      const res = await agent.put('/api/gm/events/4').send(input({ bonus: 200 }));

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ index: 4, bonus: 200 });
      expect(control.changes).toEqual([{ kind: EVENT_KIND.UPDATE, event: wire({ index: 4, value: 200 }) }]);
    });

    it('is 404 for an event that has gone, and sends nothing that would bring it back', async () => {
      const res = await agent.put('/api/gm/events/4').send(input());
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('That event has already ended or been removed');
      expect(control.changes).toEqual([]);
    });

    it('is 422 for a special event', async () => {
      control.events = [special];
      const res = await agent.put('/api/gm/events/7').send(input());
      expect(res.status).toBe(422);
      expect(res.body.message).toBe('Special events can only be stopped');
    });

    it('is 422 for a Happy event for all worlds', async () => {
      control.events = [wire({ groupId: 0 })];
      const res = await agent.put('/api/gm/events/4').send(input());
      expect(res.status).toBe(422);
      expect(res.body.message).toBe('Events made for all worlds can only be stopped');
      expect(control.changes).toEqual([]);
    });

    it('refuses to change the type, which would leave the old bonus on', async () => {
      control.events = [wire({ state: 1 })];
      const res = await agent.put('/api/gm/events/4').send(input({ type: 3 }));
      expect(res.status).toBe(422);
      expect(res.body.message).toBe('The type of an event cannot be changed');
      expect(control.changes).toEqual([]);
    });

    it('refuses to change the world, which would leave the old bonus on', async () => {
      control.worlds = [
        { id: 1, name: 'Lapiris' },
        { id: 2, name: 'Other' },
      ];
      control.events = [wire({ state: 1 })];
      const res = await agent.put('/api/gm/events/4').send(input({ world: 2 }));
      expect(res.status).toBe(422);
      expect(res.body.message).toBe('The world of an event cannot be changed');
    });

    it('does not blame the event being edited for an overlap', async () => {
      control.changeResult = 4;
      control.events = [wire()];
      const res = await agent.put('/api/gm/events/4').send(input());
      expect(res.body.message).toBe('The game server refused those times.');
    });

    it('is 422 when the end has passed', async () => {
      control.events = [wire()];
      const schedule = { mode: 'period' as const, start: '2026-10-01T10:00', end: '2026-10-02T10:00' };
      expect((await agent.put('/api/gm/events/4').send(input({ schedule }))).status).toBe(422);
    });
  });

  describe('DELETE', () => {
    it('sends a special event back unchanged, so it stops cleanly', async () => {
      control.events = [special];

      const res = await agent.delete('/api/gm/events/7');

      expect(res.status).toBe(204);
      expect(control.changes).toEqual([{ kind: EVENT_KIND.DELETE, event: special }]);
    });

    it('is 404 for an event that has gone', async () => {
      const res = await agent.delete('/api/gm/events/4');
      expect(res.status).toBe(404);
      expect(control.changes).toEqual([]);
    });

    it('is 502 when the server cannot delete it', async () => {
      control.events = [wire()];
      control.changeResult = 1;
      expect((await agent.delete('/api/gm/events/4')).status).toBe(502);
    });
  });

  describe.each(['abc', '0', '2147483648'])('index %s', (index) => {
    it('PUT is 400', async () => {
      expect((await agent.put(`/api/gm/events/${index}`).send(input())).status).toBe(400);
    });

    it('DELETE is 400', async () => {
      expect((await agent.delete(`/api/gm/events/${index}`)).status).toBe(400);
    });
  });

  describe('control server failures', () => {
    it.each([
      [new ControlUnavailableError(), 503, 'Game server is not connected'],
      [
        new ControlTimeoutError(),
        503,
        'The game server did not reply. The change may or may not have applied, so check the list.',
      ],
      [new ControlRefusedError(), 503, "The portal's control account does not have enough authority for events"],
      [new ControlBadReplyError('short'), 502, 'The game server sent a reply the portal could not read'],
    ])('%s becomes %i on a change', async (error, status, message) => {
      control.failWith = error;
      const res = await agent.post('/api/gm/events').send(input());
      expect(res.status).toBe(status);
      expect(res.body.message).toBe(message);
    });

    it('turns a failed list into the same messages', async () => {
      control.failWith = new ControlRefusedError();
      const res = await agent.get('/api/gm/events');
      expect(res.status).toBe(503);
    });

    it('still answers 409 if the overlap lookup fails', async () => {
      control.changeResult = 4;
      control.failWith = undefined;
      const list = vi.spyOn(control, 'listEvents').mockRejectedValue(new ControlTimeoutError());

      const res = await agent.post('/api/gm/events').send(input());

      expect(res.status).toBe(409);
      expect(res.body.message).toBe('The game server refused those times.');
      list.mockRestore();
    });
  });

  describe('audit', () => {
    const logs = () => gm.audits.map((audit) => audit.log);

    it('records a create', async () => {
      await agent.post('/api/gm/events').send(input()).expect(201);
      expect(gm.audits[0]).toMatchObject({ command: 'EVENT', gmId: 'moose' });
      expect(logs()).toEqual(['ADD #50 EXP +100% maps=all period 2026-11-06T18:00 to 2026-11-08T23:00 "Weekend"']);
    });

    it('records an edit, and the map of a drop event', async () => {
      control.events = [wire({ type: 3 })];
      await agent.put('/api/gm/events/4').send(input({ type: 3, mapId: 600 })).expect(200);
      expect(logs()).toEqual(['UPDATE #4 Item drop +100% maps=600 period 2026-11-06T18:00 to 2026-11-08T23:00 "Weekend"']);
    });

    it('records a stop, saying whether it was running', async () => {
      control.events = [special, wire()];
      await agent.delete('/api/gm/events/7').expect(204);
      await agent.delete('/api/gm/events/4').expect(204);
      expect(logs()).toEqual(['STOP #7 Monster spawn "Boss night" running', 'STOP #4 EXP "Weekend" waiting']);
    });

    it.each([
      ['overlap', 4],
      ['server-refused', 1],
    ])('records a %s refusal', async (reason, result) => {
      control.changeResult = result;
      await agent.post('/api/gm/events').send(input());
      expect(logs()).toEqual([
        `REJECTED ${reason}: ADD EXP +100% maps=all period 2026-11-06T18:00 to 2026-11-08T23:00 "Weekend"`,
      ]);
    });

    it('records a refusal before sending', async () => {
      const schedule = { mode: 'period' as const, start: '2026-10-01T10:00', end: '2026-10-02T10:00' };
      await agent.post('/api/gm/events').send(input({ schedule }));
      await agent.put('/api/gm/events/4').send(input());
      await agent.delete('/api/gm/events/4');
      expect(logs()).toEqual([
        'REJECTED end-passed: ADD EXP +100% maps=all period 2026-10-01T10:00 to 2026-10-02T10:00 "Weekend"',
        'REJECTED not-found: UPDATE #4 EXP +100% maps=all period 2026-11-06T18:00 to 2026-11-08T23:00 "Weekend"',
        'REJECTED not-found: STOP #4',
      ]);
    });

    it('records a control failure', async () => {
      control.failWith = new ControlTimeoutError();
      await agent.post('/api/gm/events').send(input());
      expect(logs()[0]).toMatch(/^REJECTED no-reply: ADD EXP/);
    });

    it('does not fail the request when the audit write fails', async () => {
      gm.failAudit = true;
      await agent.post('/api/gm/events').send(input()).expect(201);
    });
  });
});
