import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import {
  BRONZE_PER_SILVER,
  SLOT_REEL_STOPS,
  slotJackpotAdd,
  slotMachine,
  slotRoundPayout,
  slotSpin,
  type SlotMachine,
  type SlotSpinOutcome,
  type SlotStops,
} from '@4story-portal/shared';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sha1Hex } from '../src/auth/sha1.js';
import { SlotsService } from '../src/slots/slots.service.js';
import { FakeAccountsRepository, FakeGmRepository, FakeSlotsRepository } from './fakes.js';
import { createTestApp } from './test-app.js';

const shelf = slotMachine('shelf') as SlotMachine;

/** The first stops, counting reel 5 fastest, whose paid spin satisfies `want`. */
function stopsWhere(machine: SlotMachine, want: (out: SlotSpinOutcome) => boolean): SlotStops {
  const stops: SlotStops = [0, 0, 0, 0, 0];
  for (;;) {
    if (want(slotSpin(machine, stops))) return [...stops];
    let reel = 4;
    while (reel >= 0 && stops[reel] === SLOT_REEL_STOPS - 1) stops[reel--] = 0;
    if (reel < 0) throw new Error('No stops satisfy that');
    stops[reel]++;
  }
}

const blank = stopsWhere(shelf, (o) => o.multiple === 0 && o.scatters < 3);
const paying = stopsWhere(shelf, (o) => o.multiple > 0 && o.freeSpins === 0);
const eightFree = stopsWhere(shelf, (o) => o.freeSpins === 8 && o.multiple === 0);
const payingMultiple = slotSpin(shelf, paying).multiple;
const JACKPOT_ROLL = 999_999_999;

const STARTING = [
  { key: 'shelf', live: true, stakes: [20, 40, 60] },
  { key: 'armoury', live: true, stakes: [40, 60, 100] },
  { key: 'hoard', live: true, stakes: [60, 100, 200] },
];
const machineBody = (overrides = {}) => ({ live: true, stakes: [20, 40, 60], ...overrides });

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

  /**
   * Makes the next draws come out as these numbers, in order; a draw past the last one fails the request.
   * Returns the `max` each draw was asked for, so a test can count the draws.
   */
  const draws = (...values: number[]) => {
    const calls: number[] = [];
    app.get(SlotsService).random = (max) => {
      if (calls.length >= values.length) throw new Error(`Drew ${calls.length + 1} numbers, planned ${values.length}`);
      calls.push(max);
      return values[calls.length - 1];
    };
    return calls;
  };
  /** The draws for rounds played one after another: each paid spin's stops, then its free spins' stops. */
  const stopsOf = (...spins: SlotStops[]) => spins.flat();

  const spin = (body: Record<string, unknown> = {}, who = player) =>
    who.post('/api/slots/spin').send({ characterId: 7, machine: 'shelf', stake: 60, ...body });
  const wallet = () => {
    const { gold, silver, copper } = slots.characterRows[0];
    return { gold, silver, copper };
  };
  const untouched = () => expect(wallet()).toEqual({ gold: 5, silver: 250, copper: 0 });
  /** What the wallet holds after `silver` Silver is added to the starting 5 Gold 250 Silver. */
  const walletAfter = (silver: number) => ({ gold: 5 + Math.floor((250 + silver) / 1000), silver: (250 + silver) % 1000, copper: 0 });

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

    it('a paying round answers its five stops and pays the lines', async () => {
      const calls = draws(...paying);

      const res = await spin().expect(200);

      const payout = slotRoundPayout(shelf, { stops: paying, free: [] }, 60);
      expect(payout).toBeGreaterThan(0);
      // One draw per reel, each from the 32 stops, and nothing more.
      expect(calls).toEqual([32, 32, 32, 32, 32]);
      expect(res.body.spin).toMatchObject({ machine: 'shelf', stops: paying, free: [], stake: 60, payout, character: 'Mounara' });
      expect(res.body.wallet).toEqual(walletAfter(payout - 60));
      expect(res.body.state.characters[0].wallet).toEqual(walletAfter(payout - 60));
      expect(res.body.state.mine).toEqual([res.body.spin]);
      // The repository was handed whole Silver, the five stops, and no pot add.
      expect(slots.betCalls).toEqual([
        { userId: playerId, charId: 7, machine: 'shelf', stops: paying, free: [], stake: 60, payout, multiple: Math.floor(payout / 60), add: 0, cap: 50, roll: 0 },
      ]);
    });

    it('takes the stake on a lost round', async () => {
      draws(...blank, 0);
      const res = await spin({ stake: 20 }).expect(200);
      expect(res.body.spin).toMatchObject({ stops: blank, free: [], stake: 20, payout: 0 });
      expect(res.body.wallet).toEqual(walletAfter(-20));
      expect(wallet()).toEqual(walletAfter(-20));
    });

    it('a lost round feeds the pot and draws the jackpot number', async () => {
      const calls = draws(...blank, JACKPOT_ROLL);
      const res = await spin({ stake: 40 }).expect(200);
      expect(calls).toEqual([32, 32, 32, 32, 32, 1_000_000_000]);
      const add = slotJackpotAdd(shelf, 40);
      expect(add).toBeGreaterThan(0);
      expect(slots.betCalls[0]).toMatchObject({ add, cap: 50, roll: JACKPOT_ROLL, payout: 0, multiple: 0, free: [] });
      expect(res.body.spin.jackpot).toBe(0);
      expect(res.body.state.jackpot.pot).toBe(Math.floor(add / BRONZE_PER_SILVER));
    });

    it('a round that pays adds nothing and draws nothing more', async () => {
      const calls = draws(...paying);
      await spin().expect(200);
      expect(calls).toHaveLength(5);
      expect(slots.betCalls[0].add).toBe(0);
    });

    it('lists the round under mine, and under big wins only from 50 times the stake', async () => {
      draws(...paying);
      const small = await spin().expect(200);
      expect(small.body.state.mine).toHaveLength(1);
      expect(small.body.state.bigWins).toEqual([]);

      // A big win is planted: the best round the paying stops can make is far below 50 times the stake.
      slots.spinRows.push({
        id: 500,
        userId: playerId,
        character: 'Mounara',
        spunAt: now,
        machine: 'shelf',
        stops: paying,
        free: [],
        stake: 20,
        payout: 1000,
        multiple: 50,
        jackpot: 0,
        added: 0,
      });
      const page = await player.get('/api/slots').expect(200);
      expect(page.body.mine.map((s: { id: number }) => s.id)).toEqual([500, small.body.spin.id]);
      expect(page.body.bigWins.map((s: { id: number }) => s.id)).toEqual([500]);
      // Everyone sees the big win, but only the spinner sees the round under mine.
      const other = await moose.get('/api/slots').expect(200);
      expect(other.body.bigWins).toEqual(page.body.bigWins);
      expect(other.body.mine).toEqual([]);
    });

    it('three scatters play eight free spins in the same round', async () => {
      const calls = draws(...stopsOf(eightFree, ...Array<SlotStops>(8).fill(paying)));

      const res = await spin({ stake: 40 }).expect(200);

      // The paid spin paid nothing itself, and the free spins pay double.
      expect(slotSpin(shelf, eightFree).multiple).toBe(0);
      const payout = (8 * 2 * payingMultiple * 40) / 20;
      expect(res.body.spin.free).toEqual(Array(8).fill(paying));
      expect(res.body.spin).toMatchObject({ stops: eightFree, payout });
      expect(res.body.wallet).toEqual(walletAfter(payout - 40));
      // One money step, 5 + 8 x 5 = 45 draws, and no pot add although the paid spin paid nothing.
      expect(slots.betCalls).toHaveLength(1);
      expect(calls).toHaveLength(45);
      expect(slots.betCalls[0]).toMatchObject({ payout, multiple: Math.floor(payout / 40), add: 0, roll: 0 });
      expect(slots.betCalls[0].free).toEqual(Array(8).fill(paying));
      expect(res.body.state.mine).toEqual([res.body.spin]);
    });

    it('free spins that all pay nothing make a lost round', async () => {
      const calls = draws(...stopsOf(eightFree, ...Array<SlotStops>(8).fill(blank)), JACKPOT_ROLL);

      const res = await spin({ stake: 40 }).expect(200);

      expect(calls).toHaveLength(46);
      expect(res.body.spin).toMatchObject({ payout: 0, free: Array(8).fill(blank) });
      expect(slots.betCalls[0]).toMatchObject({ payout: 0, multiple: 0, add: slotJackpotAdd(shelf, 40), roll: JACKPOT_ROLL });
      expect(slots.betCalls[0].add).toBeGreaterThan(0);
    });

    it('scatters in a free spin give no more free spins', async () => {
      const calls = draws(...stopsOf(eightFree, ...Array<SlotStops>(8).fill(eightFree)), JACKPOT_ROLL);

      const res = await spin({ stake: 40 }).expect(200);

      expect(res.body.spin.free).toEqual(Array(8).fill(eightFree));
      expect(calls).toHaveLength(46);
    });

    it('a free spin that pays makes a round that pays, and the pot is not fed', async () => {
      const calls = draws(...stopsOf(eightFree, paying, ...Array<SlotStops>(7).fill(blank)));
      await spin({ stake: 40 }).expect(200);
      expect(calls).toHaveLength(45);
      expect(slots.betCalls[0]).toMatchObject({ payout: (2 * payingMultiple * 40) / 20, add: 0, roll: 0 });
    });

    it('sends the multiple as whole stakes won', async () => {
      // The column holds a SMALLINT; the service caps what it sends at 32767.
      draws(...stopsOf(eightFree, ...Array<SlotStops>(8).fill(paying)));
      await spin({ stake: 20 }).expect(200);
      const payout = 8 * 2 * payingMultiple;
      expect(slots.betCalls[0].multiple).toBe(Math.min(32_767, Math.floor(payout / 20)));
    });

    it('the round that drops the pot is paid it', async () => {
      slots.potRow = { pot: 49_999_900, cap: 50_000_000 };
      draws(...blank, JACKPOT_ROLL);
      const res = await spin().expect(200);
      const jackpot = Math.floor((49_999_900 + slotJackpotAdd(shelf, 60)) / BRONZE_PER_SILVER);
      expect(res.body.spin).toMatchObject({ payout: 0, jackpot });
      expect(res.body.wallet).toEqual(walletAfter(jackpot - 60));
      expect(res.body.state.jackpot).toMatchObject({ pot: 0, last: { character: 'Mounara', amount: jackpot } });
      expect(res.body.state.bigWins[0].jackpot).toBe(jackpot);
    });

    it('adds nothing while the jackpot is off, and keeps the pot and its cap', async () => {
      slots.settingsRow.jackpot.live = false;
      slots.potRow = { pot: 7_000_000, cap: 50_000_000 };
      const calls = draws(...blank);
      const first = await spin().expect(200);
      expect(slots.betCalls[0].add).toBe(0);
      expect(calls).toHaveLength(5);
      expect(slots.potRow).toEqual({ pot: 7_000_000, cap: 50_000_000 });
      expect(first.body.state.jackpot.live).toBe(false);

      slots.settingsRow.jackpot.live = true;
      draws(...blank, JACKPOT_ROLL);
      await spin().expect(200);
      expect(slots.potRow).toEqual({ pot: 7_000_000 + slotJackpotAdd(shelf, 60), cap: 50_000_000 });
    });

    it('opens without a jackpot when its table cannot be read, and refuses a lost round', async () => {
      slots.potMissing = true;
      const page = await player.get('/api/slots').expect(200);
      expect(page.body.jackpot).toBeNull();
      draws(...blank, JACKPOT_ROLL);
      slots.settingsRow.live = true;
      const res = await spin().expect(503);
      expect(res.body.message).toBe('Slots are not available right now');
      untouched();
    });

    it('the spin throttle counts by account', async () => {
      // moose was seeded just before newuser.
      slots.characterRows.push({ level: 60, classCode: 0, copper: 0, online: false, charId: 20, userId: playerId - 1, name: 'Moosey', gold: 5, silver: 250 });
      draws(...Array.from({ length: 46 }, () => [...blank, JACKPOT_ROLL]).flat());
      for (let i = 0; i < 45; i++) await spin({ stake: 20 }).expect(200);
      const refused = await spin({ stake: 20 }).expect(429);
      expect(refused.body.message).toBe('Too many attempts. Please try again later.');
      await spin({ characterId: 20, stake: 20 }, moose).expect(200);
    });

    it('refuses while the floor is closed, GMs included', async () => {
      slots.settingsRow.live = false;
      const calls = draws(...paying);
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
      const calls = draws(...paying);
      const res = await spin().expect(409);
      expect(res.body.message).toBe('That machine is closed');
      // The repository would take the stake and pay on any machine it is given.
      expect(slots.betCalls).toEqual([]);
      expect(calls).toEqual([]);
      expect(slots.spinRows).toEqual([]);
      untouched();
      // The other machines are not affected.
      draws(...blank, 0);
      await spin({ machine: 'armoury', stake: 40 }).expect(200);
    });

    it('refuses a stake the machine does not offer', async () => {
      const calls = draws(...paying);
      // 20 is a shelf stake, but not one of the armoury's (40, 60, 100).
      const res = await spin({ machine: 'armoury', stake: 20 }).expect(422);
      expect(res.body.message).toBe('That stake is no longer offered on this machine');
      await spin({ stake: 80 }).expect(422);
      expect(slots.betCalls).toEqual([]);
      expect(calls).toEqual([]);
      expect(slots.potRow).toEqual({ pot: 0, cap: null });
      untouched();
    });

    it('refuses a stake that was offered before a GM changed the stakes', async () => {
      draws(...paying);
      await moose.put('/api/gm/slots/machines/shelf').send(machineBody({ stakes: [20, 40, 80] })).expect(200);

      const res = await spin({ stake: 60 }).expect(422);

      expect(res.body.message).toBe('That stake is no longer offered on this machine');
      expect(slots.betCalls).toEqual([]);
      expect(slots.potRow).toEqual({ pot: 0, cap: null });
      untouched();
      // The new stakes work.
      const ok = await spin({ stake: 80 }).expect(200);
      expect(ok.body.spin.stake).toBe(80);
    });

    it('refuses a stake that is not a multiple of 20 before anything is drawn', async () => {
      const calls = draws(...paying);
      // The request's schema answers 400, as it does for every malformed body.
      await spin({ stake: 50 }).expect(400);
      expect(calls).toEqual([]);
      expect(slots.betCalls).toEqual([]);
      untouched();
    });

    it('refuses with 400 an unknown machine, a stake of 0 and a missing character', async () => {
      const calls = draws(...paying);
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
      draws(...paying);
      const res = await spin({ characterId: 8 }).expect(409);
      expect(res.body.message).toBe('Log out of Busy in the game first');
      expect(slots.spinRows).toEqual([]);
    });

    it("refuses someone else's character", async () => {
      draws(...paying);
      const res = await spin({ characterId: 9 }).expect(422);
      expect(res.body.message).toBe('Pick one of your own characters');
      expect(slots.characterRows[2].gold).toBe(5);
      expect(slots.spinRows).toEqual([]);
    });

    it('refuses a stake the wallet cannot cover', async () => {
      draws(...paying);
      slots.characterRows[0].gold = 0;
      slots.characterRows[0].silver = 40;
      const res = await spin({ stake: 60 }).expect(422);
      expect(res.body.message).toBe('Not enough money in that wallet');
      expect(wallet()).toEqual({ gold: 0, silver: 40, copper: 0 });
      expect(slots.spinRows).toEqual([]);
    });

    it('answers 503 when the tables are missing, and still serves a closed page', async () => {
      slots.failing = true;
      draws(...paying);
      const res = await spin().expect(503);
      expect(res.body.message).toBe('Slots are not available right now');
      // failing is the slots' own tables only: the account's characters come from the wallets, which still read.
      const page = await player.get('/api/slots').expect(200);
      expect(page.body).toMatchObject({ live: false, machines: STARTING, mine: [], bigWins: [], jackpot: null });
      expect(page.body.characters.map((c: { name: string }) => c.name)).toEqual(['Mounara', 'Busy']);
      untouched();
    });

    it('refuses a spin with nothing taken when the columns are not there, and still opens the page', async () => {
      // The new API on a spin table from before the five reels: the settings read, the bet and the lists do not.
      slots.columnsMissing = true;
      draws(...paying);
      const res = await spin({ stake: 20 }).expect(503);
      expect(res.body.message).toBe('Slots are not available right now');
      expect(slots.betCalls).toHaveLength(1);
      expect(slots.spinRows).toEqual([]);
      untouched();
      const page = await player.get('/api/slots').expect(200);
      expect(page.body).toMatchObject({ live: true, machines: STARTING, mine: [], bigWins: [] });
      expect(page.body.characters.map((c: { name: string }) => c.name)).toEqual(['Mounara', 'Busy']);
    });

    it('serves the page without characters when the wallets cannot be read', async () => {
      slots.wallets.failing = true;
      const page = await player.get('/api/slots').expect(200);
      expect(page.body).toMatchObject({ live: true, machines: STARTING, characters: [] });
    });

    it('answers 503 when the bet itself throws', async () => {
      draws(...paying);
      slots.bet = async () => {
        throw new Error('deadlock');
      };
      const res = await spin().expect(503);
      expect(res.body.message).toBe('Slots are not available right now');
    });

    it('leaves a spin for a machine it does not know, or with stops it cannot show, out of the lists', async () => {
      draws(...paying);
      const real = await spin().expect(200);
      const stray = { userId: playerId, character: 'Mounara', spunAt: now, stake: 60, payout: 3000, multiple: 50, jackpot: 0, added: 0, free: [] };
      slots.spinRows.push(
        { ...stray, id: 100, machine: 'vault', stops: [1, 2, 3, 4, 5] },
        { ...stray, id: 101, machine: 'shelf', stops: [1, 2, 3, 4, 32] },
        { ...stray, id: 102, machine: 'shelf', stops: [-1, 2, 3, 4, 5] },
        { ...stray, id: 103, machine: 'shelf', stops: [1, 2, 3] as unknown as SlotStops },
        { ...stray, id: 104, machine: 'shelf', stops: [1, 2, 3, 4, 5], free: [[1, 2, 3, 4, 32]] },
      );

      const page = await player.get('/api/slots').expect(200);
      expect(page.body.mine).toEqual([real.body.spin]);
      const gmPage = await moose.get('/api/gm/slots').expect(200);
      expect(gmPage.body.latest).toEqual([real.body.spin]);
      // Only the three machines the code has are listed, whatever the table holds.
      expect(gmPage.body.machines.map((m: { key: string }) => m.key)).toEqual(['shelf', 'armoury', 'hoard']);
    });
  });

  describe('the fake repository', () => {
    it('refuses a negative stake or payout like the real batch', async () => {
      slots.settingsRow.live = true;
      const input = { userId: playerId, charId: 7, machine: 'shelf' as const, stops: [1, 0, 0, 0, 0] as SlotStops, free: [], stake: 20, payout: 0, multiple: 0, add: 0, cap: 50, roll: 0 };
      await expect(slots.bet({ ...input, stake: -1 })).rejects.toThrow('cannot be negative');
      await expect(slots.bet({ ...input, payout: -1 })).rejects.toThrow('cannot be negative');
      untouched();
    });

    it('refuses a closed floor', async () => {
      const input = { userId: playerId, charId: 7, machine: 'shelf' as const, stops: [1, 0, 0, 0, 0] as SlotStops, free: [], stake: 20, payout: 0, multiple: 0, add: 0, cap: 50, roll: 0 };
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
      expect(slots.settingsRow.machines.shelf).toEqual({ live: true, stakes: [20, 40, 60] });
      expect(slots.settingsRow.live).toBe(false);
      expect(gm.audits).toEqual([expect.objectContaining({ gmId: 'moose', command: 'SLOTS', log: 'SET armoury off stakes 20,40,80' })]);
    });

    it.each([
      ['equal stakes', { stakes: [20, 20, 60] }],
      ['falling stakes', { stakes: [60, 40, 20] }],
      ['two stakes', { stakes: [20, 40] }],
      ['a stake of zero', { stakes: [0, 40, 60] }],
      ['a stake above the largest', { stakes: [20, 40, 100_020] }],
      ['a fractional stake', { stakes: [20, 40.5, 60] }],
      ['a stake that is not a multiple of 20', { stakes: [20, 30, 60] }],
      ['no switch', { live: undefined }],
    ])('refuses %s', async (_name, overrides) => {
      await moose.put('/api/gm/slots/machines/shelf').send(machineBody(overrides)).expect(400);
      expect(slots.settingsRow.machines.shelf).toEqual({ live: true, stakes: [20, 40, 60] });
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
      draws(...paying);
      await spin().expect(200);
      draws(...blank, JACKPOT_ROLL);
      await spin({ machine: 'armoury', stake: 40 }).expect(200);
      // An older day only counts toward all time.
      now = new Date('2026-11-15T10:00:00Z');
      draws(...blank, JACKPOT_ROLL);
      await spin({ stake: 20 }).expect(200);

      const res = await moose.get('/api/gm/slots').expect(200);

      const paid = slotRoundPayout(shelf, { stops: paying, free: [] }, 60);
      const armouryAdded = Math.floor(slotJackpotAdd(slotMachine('armoury') as SlotMachine, 40) / BRONZE_PER_SILVER);
      const shelfAdded = Math.floor(slotJackpotAdd(shelf, 20) / BRONZE_PER_SILVER);
      expect(res.body.live).toBe(true);
      expect(res.body.machines).toEqual([
        { key: 'shelf', live: true, stakes: [20, 40, 60], today: { spins: 1, staked: 20, paid: 0, added: shelfAdded }, allTime: { spins: 2, staked: 80, paid, added: shelfAdded } },
        { key: 'armoury', live: true, stakes: [40, 60, 100], today: { spins: 0, staked: 0, paid: 0, added: 0 }, allTime: { spins: 1, staked: 40, paid: 0, added: armouryAdded } },
        { key: 'hoard', live: true, stakes: [60, 100, 200], today: { spins: 0, staked: 0, paid: 0, added: 0 }, allTime: { spins: 0, staked: 0, paid: 0, added: 0 } },
      ]);
      expect(res.body.latest.map((s: { stake: number }) => s.stake)).toEqual([20, 40, 60]);
      expect(res.body.latest[0]).toMatchObject({ character: 'Mounara', machine: 'shelf', stops: blank, free: [], payout: 0 });
    });

    it('GM: shows the jackpot', async () => {
      slots.settingsRow.live = true;
      slots.potRow = { pot: 49_999_900, cap: 50_000_000 };
      draws(...blank, JACKPOT_ROLL);
      await spin().expect(200);
      const added = slotJackpotAdd(shelf, 60);
      const won = Math.floor((49_999_900 + added) / BRONZE_PER_SILVER);
      const res = await moose.get('/api/gm/slots').expect(200);
      expect(res.body.jackpot).toMatchObject({ live: true, setCap: 50, running: { pot: 0, cap: 50_000, floor: 5_000 }, added: Math.floor(added / BRONZE_PER_SILVER), paid: won, drops: 1 });
      expect(res.body.jackpot.wins).toHaveLength(1);
      expect(res.body.jackpot.wins[0]).toMatchObject({ character: 'Mounara', jackpot: won });
      expect(res.body.machines[0].allTime.added).toBe(Math.floor(added / BRONZE_PER_SILVER));
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
