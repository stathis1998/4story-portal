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
        jackpot: { live: true, pot: 0, cap: 50_000, floor: 5_000, last: null },
      });
    });

    it('shows the jackpot with the cap set, before any round has fed it', async () => {
      const res = await player.get('/api/slots').expect(200);
      expect(res.body.jackpot).toEqual({ live: true, pot: 0, cap: 50_000, floor: 5_000, last: null });
    });

    it('shows a pot of odd Bronze as nothing, under the cap set now', async () => {
      slots.potRow = { pot: 284, cap: null };
      slots.settingsRow.jackpot.cap = 80;
      const res = await player.get('/api/slots').expect(200);
      expect(res.body.jackpot).toMatchObject({ pot: 0, cap: 80_000, floor: 8_000 });
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

    it('a lost round adds its share and draws for the jackpot', async () => {
      const calls = roll(1, 0, 0, 999_999_999);
      const res = await spin({ stake: 50 }).expect(200);
      expect(calls).toEqual([32, 32, 32, 1_000_000_000]);
      expect(slots.betCalls[0]).toMatchObject({ add: 2784, cap: 50, roll: 999_999_999 });
      expect(res.body.spin.jackpot).toBe(0);
      expect(res.body.state.jackpot.pot).toBe(2);
    });

    it('a round that pays adds nothing and draws nothing more', async () => {
      const calls = roll(...TINCTURES);
      await spin().expect(200);
      expect(calls).toEqual([32, 32, 32]);
      expect(slots.betCalls[0].add).toBe(0);
    });

    it('the round that drops the pot is paid it', async () => {
      slots.potRow = { pot: 49_999_500, cap: 50_000_000 };
      roll(1, 0, 0, 999_999_999);
      const res = await spin().expect(200);
      expect(res.body.spin).toMatchObject({ payout: 0, jackpot: 50_002 });
      expect(res.body.wallet).toEqual({ gold: 55, silver: 202, copper: 0 });
      expect(res.body.state.jackpot).toMatchObject({ pot: 0, last: { character: 'Mounara', amount: 50_002 } });
      expect(res.body.state.bigWins[0].jackpot).toBe(50_002);
    });

    it('adds nothing while the jackpot is off, and keeps the pot and its cap', async () => {
      slots.settingsRow.jackpot.live = false;
      slots.potRow = { pot: 7_000_000, cap: 50_000_000 };
      const calls = roll(1, 0, 0, 999_999_999);
      const first = await spin().expect(200);
      expect(slots.betCalls[0].add).toBe(0);
      expect(calls).toEqual([32, 32, 32]);
      expect(slots.potRow).toEqual({ pot: 7_000_000, cap: 50_000_000 });
      expect(first.body.state.jackpot.live).toBe(false);

      slots.settingsRow.jackpot.live = true;
      roll(1, 0, 0, 999_999_999);
      await spin().expect(200);
      expect(slots.potRow).toEqual({ pot: 7_002_784, cap: 50_000_000 });
    });

    it('opens without a jackpot when its table cannot be read, and refuses a lost round', async () => {
      slots.potMissing = true;
      const page = await player.get('/api/slots').expect(200);
      expect(page.body.jackpot).toBeNull();
      roll(1, 0, 0, 999_999_999);
      slots.settingsRow.live = true;
      const res = await spin().expect(503);
      expect(res.body.message).toBe('Slots are not available right now');
      untouched();
    });

    it('the spin throttle counts by account', async () => {
      // moose was seeded just before newuser.
      slots.characterRows.push({ level: 60, classCode: 0, copper: 0, online: false, charId: 20, userId: playerId - 1, name: 'Moosey', gold: 5, silver: 250 });
      roll(...LOSS);
      for (let i = 0; i < 30; i++) await spin({ stake: 10 }).expect(200);
      const refused = await spin({ stake: 10 }).expect(429);
      expect(refused.body.message).toBe('Too many attempts. Please try again later.');
      await spin({ characterId: 20, stake: 10 }, moose).expect(200);
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
      expect(slots.potRow).toEqual({ pot: 0, cap: null });
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
      expect(slots.potRow).toEqual({ pot: 0, cap: null });
      untouched();
    });

    it('refuses a stake that was offered before a GM changed the stakes', async () => {
      const calls = roll(...TINCTURES);
      await moose.put('/api/gm/slots/machines/shelf').send(machineBody({ stakes: [20, 40, 80] })).expect(200);

      const res = await spin({ stake: 50 }).expect(422);

      expect(res.body.message).toBe('That stake is no longer offered on this machine');
      expect(slots.betCalls).toEqual([]);
      expect(calls).toEqual([]);
      expect(slots.potRow).toEqual({ pot: 0, cap: null });
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
      expect(slots.potRow).toEqual({ pot: 0, cap: null });
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
      expect(page.body).toMatchObject({ live: false, machines: STARTING, mine: [], bigWins: [], jackpot: null });
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
      // The lost round above drew a fourth number for the jackpot, so the cycle starts again.
      roll(...LOSS);
      await spin({ stake: 10 }).expect(200);

      const res = await moose.get('/api/gm/slots').expect(200);

      expect(res.body.live).toBe(true);
      expect(res.body.machines).toEqual([
        { key: 'shelf', live: true, stakes: [10, 25, 50], today: { spins: 1, staked: 10, paid: 0, added: 0 }, allTime: { spins: 2, staked: 60, paid: 2500, added: 0 } },
        { key: 'armoury', live: true, stakes: [25, 50, 100], today: { spins: 0, staked: 0, paid: 0, added: 0 }, allTime: { spins: 1, staked: 25, paid: 0, added: 1 } },
        { key: 'hoard', live: true, stakes: [50, 100, 200], today: { spins: 0, staked: 0, paid: 0, added: 0 }, allTime: { spins: 0, staked: 0, paid: 0, added: 0 } },
      ]);
      expect(res.body.latest.map((s: { stake: number }) => s.stake)).toEqual([10, 25, 50]);
      expect(res.body.latest[0]).toMatchObject({ character: 'Mounara', machine: 'shelf', stops: LOSS, payout: 0 });
    });

    it('GM: shows the jackpot', async () => {
      slots.settingsRow.live = true;
      slots.potRow = { pot: 49_999_500, cap: 50_000_000 };
      roll(1, 0, 0, 999_999_999);
      await spin().expect(200);
      const res = await moose.get('/api/gm/slots').expect(200);
      expect(res.body.jackpot).toMatchObject({ live: true, setCap: 50, running: { pot: 0, cap: 50_000, floor: 5_000 }, added: 2, paid: 50_002, drops: 1 });
      expect(res.body.jackpot.wins).toHaveLength(1);
      expect(res.body.jackpot.wins[0]).toMatchObject({ character: 'Mounara', jackpot: 50_002 });
      expect(res.body.machines[0].allTime.added).toBe(2);
    });

    it('GM: saves the switch and the cap, and logs it', async () => {
      const res = await moose.put('/api/gm/slots/jackpot').send({ live: false, cap: 80 }).expect(200);
      expect(res.body.jackpot).toMatchObject({ live: false, setCap: 80 });
      expect(slots.settingsRow.jackpot).toEqual({ live: false, cap: 80 });
      expect(gm.audits).toEqual([expect.objectContaining({ gmId: 'moose', command: 'SLOTS', log: 'JACKPOT off cap 80' })]);
    });

    it("GM: a changed cap shows beside the running pot's own", async () => {
      slots.potRow = { pot: 10_000_000, cap: 50_000_000 };
      const res = await moose.put('/api/gm/slots/jackpot').send({ live: true, cap: 80 }).expect(200);
      expect(res.body.jackpot).toMatchObject({ setCap: 80, running: { pot: 10_000, cap: 50_000, floor: 5_000 } });
      expect(gm.audits[0].log).toBe('JACKPOT on cap 80');
    });

    it.each([0, 10_001, 1.5])('GM: refuses a cap of %s', async (cap) => {
      await moose.put('/api/gm/slots/jackpot').send({ live: true, cap }).expect(400);
      expect(slots.settingsRow.jackpot).toEqual({ live: true, cap: 50 });
      expect(gm.audits).toEqual([]);
    });

    it('GM: a non-GM cannot save the jackpot', async () => {
      await player.put('/api/gm/slots/jackpot').send({ live: false, cap: 80 }).expect(403);
      expect(slots.settingsRow.jackpot).toEqual({ live: true, cap: 50 });
    });

    it('still opens, closed and empty, when the tables cannot be read', async () => {
      slots.failing = true;
      const res = await moose.get('/api/gm/slots').expect(200);
      const empty = { spins: 0, staked: 0, paid: 0, added: 0 };
      expect(res.body).toEqual({
        live: false,
        machines: STARTING.map((m) => ({ ...m, today: empty, allTime: empty })),
        latest: [],
        jackpot: { live: true, setCap: 50, running: null, added: 0, paid: 0, drops: 0, wins: [] },
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
