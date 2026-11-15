import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sha1Hex } from '../src/auth/sha1.js';
import { SlotsService } from '../src/slots/slots.service.js';
import { FakeAccountsRepository, FakeGmRepository, FakeSlotsRepository } from './fakes.js';
import { createTestApp } from './test-app.js';

// Stops on Tranus's Shelf, found from its reels: three Survival Tinctures (50 times), three Serendipity
// potions (25 times), two Healing Potions (2 times) and a loss.
const TINCTURES = [4, 4, 16];
const SERENDIPITY = [8, 6, 2];
const TWO_HEALING = [0, 0, 1];
const LOSS = [1, 0, 0];

const STARTING = [
  { key: 'shelf', live: true, stakes: [10, 25, 50] },
  { key: 'armoury', live: true, stakes: [25, 50, 100] },
  { key: 'hoard', live: true, stakes: [50, 100, 200] },
];
const machineBody = (overrides = {}) => ({ live: true, stakes: [10, 25, 50], ...overrides });

describe('/api/slots', () => {
  let app: INestApplication;
  let slots: FakeSlotsRepository;
  let gm: FakeGmRepository;
  let player: ReturnType<typeof request.agent>;
  let moose: ReturnType<typeof request.agent>;
  let playerId: number;
  let now: Date;

  beforeAll(() => Logger.overrideLogger(false));

  beforeEach(async () => {
    const accounts = new FakeAccountsRepository();
    accounts.seed('moose', sha1Hex('secret1'));
    playerId = accounts.seed('newuser', sha1Hex('secret1')).userId;
    slots = new FakeSlotsRepository();
    now = new Date('2026-11-14T10:00:00Z');
    slots.now = () => now;
    const base = { level: 60, classCode: 0, copper: 0, online: false };
    slots.characterRows = [
      { ...base, charId: 7, userId: playerId, name: 'Mounara', gold: 5, silver: 250 },
      { ...base, charId: 8, userId: playerId, name: 'Busy', gold: 5, silver: 0, online: true },
      { ...base, charId: 9, userId: playerId + 50, name: 'Stranger', gold: 5, silver: 0 },
    ];
    gm = new FakeGmRepository();
    // No wallets override: the app must use the slots fake's own wallets.
    app = await createTestApp({ accounts, gm, slots });
    player = request.agent(app.getHttpServer());
    await player.post('/api/auth/login').send({ username: 'newuser', password: 'secret1' }).expect(200);
    moose = request.agent(app.getHttpServer());
    await moose.post('/api/auth/login').send({ username: 'moose', password: 'secret1' }).expect(200);
  });

  afterEach(() => app.close());

  /** Makes the next spins land on these stops, reel 1 first; returns the `max` each draw was asked for. */
  const roll = (...values: number[]) => {
    const calls: number[] = [];
    let next = 0;
    app.get(SlotsService).random = (max) => {
      calls.push(max);
      return values[next++ % values.length];
    };
    return calls;
  };

  const spin = (body: Record<string, unknown> = {}, who = player) =>
    who.post('/api/slots/spin').send({ characterId: 7, machine: 'shelf', stake: 50, ...body });
  const wallet = () => {
    const { gold, silver, copper } = slots.characterRows[0];
    return { gold, silver, copper };
  };
  const untouched = () => expect(wallet()).toEqual({ gold: 5, silver: 250, copper: 0 });

  describe('GET /slots', () => {
    it('needs a login', async () => {
      await request(app.getHttpServer()).get('/api/slots').expect(401);
    });

    it("shows a closed floor, three open machines with their starting stakes, and the account's own characters", async () => {
      const res = await player.get('/api/slots').expect(200);
      expect(res.body).toEqual({
        live: false,
        machines: STARTING,
        characters: [
          { id: 7, name: 'Mounara', level: 60, className: expect.any(String), online: false, wallet: { gold: 5, silver: 250, copper: 0 } },
          { id: 8, name: 'Busy', level: 60, className: expect.any(String), online: true, wallet: { gold: 5, silver: 0, copper: 0 } },
        ],
        mine: [],
        bigWins: [],
      });
    });
  });

  describe('POST /slots/spin', () => {
    beforeEach(() => {
      slots.settingsRow.live = true;
    });

    it('pays three of a kind and returns the new wallet', async () => {
      const calls = roll(...TINCTURES);

      const res = await spin().expect(200);

      // One draw per reel, each from the 32 stops.
      expect(calls).toEqual([32, 32, 32]);
      expect(res.body.spin).toMatchObject({ machine: 'shelf', stops: TINCTURES, stake: 50, payout: 2500, character: 'Mounara' });
      expect(res.body.wallet).toEqual({ gold: 7, silver: 700, copper: 0 });
      expect(res.body.state.characters[0].wallet).toEqual({ gold: 7, silver: 700, copper: 0 });
      expect(res.body.state.mine).toEqual([res.body.spin]);
      // The repository was handed whole Silver and the prize's multiple.
      expect(slots.betCalls).toEqual([
        { userId: playerId, charId: 7, machine: 'shelf', stops: TINCTURES, stake: 50, payout: 2500, multiple: 50, add: 0, cap: 50, roll: 0 },
      ]);
    });

    it('pays two lucky symbols', async () => {
      roll(...TWO_HEALING);
      const res = await spin({ stake: 25 }).expect(200);
      expect(res.body.spin).toMatchObject({ stops: TWO_HEALING, stake: 25, payout: 50 });
      // 5 Gold 250 Silver, less 25, plus 50.
      expect(res.body.wallet).toEqual({ gold: 5, silver: 275, copper: 0 });
    });

    it('takes the stake on a loss', async () => {
      roll(...LOSS);
      const res = await spin({ stake: 10 }).expect(200);
      expect(res.body.spin).toMatchObject({ stops: LOSS, stake: 10, payout: 0 });
      expect(res.body.wallet).toEqual({ gold: 5, silver: 240, copper: 0 });
      expect(wallet()).toEqual({ gold: 5, silver: 240, copper: 0 });
    });

    it('lists the spin under mine, and under big wins only from 50 times the stake', async () => {
      roll(...SERENDIPITY);
      const small = await spin({ stake: 10 }).expect(200);
      expect(small.body.spin.payout).toBe(250);
      expect(small.body.state.mine).toHaveLength(1);
      expect(small.body.state.bigWins).toEqual([]);

      roll(...TINCTURES);
      const big = await spin().expect(200);
      expect(big.body.state.mine.map((s: { id: number }) => s.id)).toEqual([big.body.spin.id, small.body.spin.id]);
      expect(big.body.state.bigWins).toEqual([big.body.spin]);
      // Everyone sees the big win, but only the spinner sees the spin under mine.
      const other = await moose.get('/api/slots').expect(200);
      expect(other.body.bigWins).toEqual([big.body.spin]);
      expect(other.body.mine).toEqual([]);
    });

    it('refuses while the floor is closed, GMs included', async () => {
      slots.settingsRow.live = false;
      const calls = roll(...TINCTURES);
      const res = await spin().expect(503);
      expect(res.body.message).toBe('The slots are not open yet');
      const gmRes = await spin({}, moose).expect(503);
      expect(gmRes.body.message).toBe('The slots are not open yet');
      expect(slots.betCalls).toEqual([]);
      expect(calls).toEqual([]);
      untouched();
    });

    it('refuses a closed machine and takes nothing', async () => {
      slots.settingsRow.machines.shelf.live = false;
      const calls = roll(...TINCTURES);
      const res = await spin().expect(409);
      expect(res.body.message).toBe('That machine is closed');
      // The repository would take the stake and pay on any machine it is given.
      expect(slots.betCalls).toEqual([]);
      expect(calls).toEqual([]);
      expect(slots.spinRows).toEqual([]);
      untouched();
      // The other machines are not affected.
      roll(...LOSS);
      await spin({ machine: 'armoury', stake: 25 }).expect(200);
    });

    it('refuses a stake the machine does not offer', async () => {
      const calls = roll(...TINCTURES);
      // 10 is a shelf stake, but not one of the armoury's (25, 50, 100).
      const res = await spin({ machine: 'armoury', stake: 10 }).expect(422);
      expect(res.body.message).toBe('That stake is no longer offered on this machine');
      await spin({ stake: 51 }).expect(422);
      expect(slots.betCalls).toEqual([]);
      expect(calls).toEqual([]);
      untouched();
    });

    it('refuses a stake that was offered before a GM changed the stakes', async () => {
      const calls = roll(...TINCTURES);
      await moose.put('/api/gm/slots/machines/shelf').send(machineBody({ stakes: [20, 40, 80] })).expect(200);

      const res = await spin({ stake: 50 }).expect(422);

      expect(res.body.message).toBe('That stake is no longer offered on this machine');
      expect(slots.betCalls).toEqual([]);
      expect(calls).toEqual([]);
      untouched();
      // The new stakes work.
      const ok = await spin({ stake: 40 }).expect(200);
      expect(ok.body.spin.stake).toBe(40);
    });

    it('refuses with 400 an unknown machine, a stake of 0 and a missing character', async () => {
      const calls = roll(...TINCTURES);
      await spin({ machine: 'casino' }).expect(400);
      await spin({ stake: 0 }).expect(400);
      await spin({ stake: 10.5 }).expect(400);
      await spin({ characterId: undefined }).expect(400);
      expect(slots.betCalls).toEqual([]);
      expect(calls).toEqual([]);
      untouched();
    });

    it('refuses a character in the game by name', async () => {
      roll(...TINCTURES);
      const res = await spin({ characterId: 8 }).expect(409);
      expect(res.body.message).toBe('Log out of Busy in the game first');
      expect(slots.spinRows).toEqual([]);
    });

    it("refuses someone else's character", async () => {
      roll(...TINCTURES);
      const res = await spin({ characterId: 9 }).expect(422);
      expect(res.body.message).toBe('Pick one of your own characters');
      expect(slots.characterRows[2].gold).toBe(5);
      expect(slots.spinRows).toEqual([]);
    });

    it('refuses a stake the wallet cannot cover', async () => {
      roll(...TINCTURES);
      slots.characterRows[0].gold = 0;
      slots.characterRows[0].silver = 40;
      const res = await spin({ stake: 50 }).expect(422);
      expect(res.body.message).toBe('Not enough money in that wallet');
      expect(wallet()).toEqual({ gold: 0, silver: 40, copper: 0 });
      expect(slots.spinRows).toEqual([]);
    });

    it('answers 503 when the tables are missing, and still serves a closed page', async () => {
      slots.failing = true;
      roll(...TINCTURES);
      const res = await spin().expect(503);
      expect(res.body.message).toBe('Slots are not available right now');
      // failing is the slots' own tables only: the account's characters come from the wallets, which still read.
      const page = await player.get('/api/slots').expect(200);
      expect(page.body).toMatchObject({ live: false, machines: STARTING, mine: [], bigWins: [] });
      expect(page.body.characters.map((c: { name: string }) => c.name)).toEqual(['Mounara', 'Busy']);
      untouched();
    });

    it('serves the page without characters when the wallets cannot be read', async () => {
      slots.wallets.failing = true;
      const page = await player.get('/api/slots').expect(200);
      expect(page.body).toMatchObject({ live: true, machines: STARTING, characters: [] });
    });

    it('answers 503 when the bet itself throws', async () => {
      roll(...TINCTURES);
      slots.bet = async () => {
        throw new Error('deadlock');
      };
      const res = await spin().expect(503);
      expect(res.body.message).toBe('Slots are not available right now');
    });

    it('leaves out of the lists a spin for a machine the code no longer has', async () => {
      roll(...TINCTURES);
      const real = await spin().expect(200);
      const stray = { userId: playerId, character: 'Mounara', spunAt: now, stake: 50, payout: 2500, multiple: 50, jackpot: 0, added: 0 };
      slots.spinRows.push(
        { ...stray, id: 100, machine: 'vault', stops: [1, 2, 3] },
        { ...stray, id: 101, machine: 'shelf', stops: [1, 2, 32] },
        { ...stray, id: 102, machine: 'shelf', stops: [-1, 2, 3] },
      );

      const page = await player.get('/api/slots').expect(200);
      expect(page.body.mine).toEqual([real.body.spin]);
      expect(page.body.bigWins).toEqual([real.body.spin]);
      const gmPage = await moose.get('/api/gm/slots').expect(200);
      expect(gmPage.body.latest).toEqual([real.body.spin]);
      // Only the three machines the code has are listed, whatever the table holds.
      expect(gmPage.body.machines.map((m: { key: string }) => m.key)).toEqual(['shelf', 'armoury', 'hoard']);
    });
  });

  describe('the fake repository', () => {
    it('refuses a negative stake or payout like the real batch', async () => {
      slots.settingsRow.live = true;
      const input = { userId: playerId, charId: 7, machine: 'shelf' as const, stops: [1, 0, 0] as [number, number, number], stake: 10, payout: 0, multiple: 0, add: 0, cap: 50, roll: 0 };
      await expect(slots.bet({ ...input, stake: -1 })).rejects.toThrow('cannot be negative');
      await expect(slots.bet({ ...input, payout: -1 })).rejects.toThrow('cannot be negative');
      untouched();
    });

    it('refuses a closed floor', async () => {
      const input = { userId: playerId, charId: 7, machine: 'shelf' as const, stops: [1, 0, 0] as [number, number, number], stake: 10, payout: 0, multiple: 0, add: 0, cap: 50, roll: 0 };
      expect(await slots.bet(input)).toEqual({ code: 1, name: null });
      untouched();
    });
  });

  describe('GM routes', () => {
    it('keeps a player out of the GM routes', async () => {
      await player.get('/api/gm/slots').expect(403);
      await player.put('/api/gm/slots/floor').send({ live: true }).expect(403);
      await player.put('/api/gm/slots/machines/shelf').send(machineBody({ live: false })).expect(403);
      expect(slots.settingsRow.live).toBe(false);
      expect(slots.settingsRow.machines.shelf.live).toBe(true);
      expect(gm.audits).toEqual([]);
    });

    it('opens the floor and writes a SLOTS audit row', async () => {
      const res = await moose.put('/api/gm/slots/floor').send({ live: true }).expect(200);
      expect(res.body.live).toBe(true);
      expect(slots.settingsRow.live).toBe(true);
      expect(gm.audits).toEqual([expect.objectContaining({ gmId: 'moose', command: 'SLOTS', log: 'FLOOR on' })]);
      await moose.put('/api/gm/slots/floor').send({ live: false }).expect(200);
      expect(gm.audits[1].log).toBe('FLOOR off');
      expect(slots.settingsRow.live).toBe(false);
    });

    it("saves a machine's switch and stakes and writes a SLOTS audit row", async () => {
      const res = await moose.put('/api/gm/slots/machines/armoury').send(machineBody({ live: false, stakes: [20, 40, 80] })).expect(200);
      expect(res.body.machines.find((m: { key: string }) => m.key === 'armoury')).toMatchObject({ live: false, stakes: [20, 40, 80] });
      expect(slots.settingsRow.machines.armoury).toEqual({ live: false, stakes: [20, 40, 80] });
      // The other machines and the floor are left as they were.
      expect(slots.settingsRow.machines.shelf).toEqual({ live: true, stakes: [10, 25, 50] });
      expect(slots.settingsRow.live).toBe(false);
      expect(gm.audits).toEqual([expect.objectContaining({ gmId: 'moose', command: 'SLOTS', log: 'SET armoury off stakes 20,40,80' })]);
    });

    it.each([
      ['equal stakes', { stakes: [10, 10, 50] }],
      ['falling stakes', { stakes: [50, 25, 10] }],
      ['two stakes', { stakes: [10, 25] }],
      ['a stake of zero', { stakes: [0, 25, 50] }],
      ['a stake above the largest', { stakes: [10, 25, 100_001] }],
      ['a fractional stake', { stakes: [10, 25.5, 50] }],
      ['no switch', { live: undefined }],
    ])('refuses %s', async (_name, overrides) => {
      await moose.put('/api/gm/slots/machines/shelf').send(machineBody(overrides)).expect(400);
      expect(slots.settingsRow.machines.shelf).toEqual({ live: true, stakes: [10, 25, 50] });
      expect(gm.audits).toEqual([]);
    });

    it('refuses an unknown machine with 404 and a floor without a switch with 400', async () => {
      await moose.put('/api/gm/slots/machines/casino').send(machineBody()).expect(404);
      await moose.put('/api/gm/slots/floor').send({}).expect(400);
      expect(Object.keys(slots.settingsRow.machines)).toEqual(['shelf', 'armoury', 'hoard']);
      expect(gm.audits).toEqual([]);
    });

    it("shows a GM each machine's totals for today and all time, and the latest spins", async () => {
      slots.settingsRow.live = true;
      roll(...TINCTURES);
      await spin().expect(200);
      roll(...LOSS);
      await spin({ machine: 'armoury', stake: 25 }).expect(200);
      // An older day only counts toward all time.
      now = new Date('2026-11-15T10:00:00Z');
      await spin({ stake: 10 }).expect(200);

      const res = await moose.get('/api/gm/slots').expect(200);

      expect(res.body.live).toBe(true);
      expect(res.body.machines).toEqual([
        { key: 'shelf', live: true, stakes: [10, 25, 50], today: { spins: 1, staked: 10, paid: 0 }, allTime: { spins: 2, staked: 60, paid: 2500 } },
        { key: 'armoury', live: true, stakes: [25, 50, 100], today: { spins: 0, staked: 0, paid: 0 }, allTime: { spins: 1, staked: 25, paid: 0 } },
        { key: 'hoard', live: true, stakes: [50, 100, 200], today: { spins: 0, staked: 0, paid: 0 }, allTime: { spins: 0, staked: 0, paid: 0 } },
      ]);
      expect(res.body.latest.map((s: { stake: number }) => s.stake)).toEqual([10, 25, 50]);
      expect(res.body.latest[0]).toMatchObject({ character: 'Mounara', machine: 'shelf', stops: LOSS, payout: 0 });
    });

    it('still opens, closed and empty, when the tables cannot be read', async () => {
      slots.failing = true;
      const res = await moose.get('/api/gm/slots').expect(200);
      const empty = { spins: 0, staked: 0, paid: 0 };
      expect(res.body).toEqual({
        live: false,
        machines: STARTING.map((m) => ({ ...m, today: empty, allTime: empty })),
        latest: [],
      });
    });

    it('answers 503 when the settings cannot be saved', async () => {
      slots.failing = true;
      const floor = await moose.put('/api/gm/slots/floor').send({ live: true }).expect(503);
      expect(floor.body.message).toBe('Slots are not available right now');
      await moose.put('/api/gm/slots/machines/shelf').send(machineBody()).expect(503);
      expect(gm.audits).toEqual([]);
    });
  });
});
