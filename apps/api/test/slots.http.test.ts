import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import {
  BRONZE_PER_SILVER,
  SLOT_LINE_COUNT,
  SLOT_REEL_STOPS,
  SLOT_REELS,
  slotChain,
  slotJackpotAdds,
  slotMachine,
  slotReplayRound,
  type SlotChain,
  type SlotMachine,
  type SlotPot,
  type SlotStops,
} from '@4story-portal/shared';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sha1Hex } from '../src/auth/sha1.js';
import { SlotsService } from '../src/slots/slots.service.js';
import { FakeAccountsRepository, FakeGmRepository, FakeSlotsRepository, type FakeSlotSpinRow } from './fakes.js';
import { createTestApp } from './test-app.js';

const shelf = slotMachine('shelf') as SlotMachine;
const armoury = slotMachine('armoury') as SlotMachine;

const WINDOWS = SLOT_REEL_STOPS ** SLOT_REELS;
/**
 * The first stops whose paid spin's chain satisfies `want`. Every window is visited once, in a scattered order (an odd
 * step through the 32^5 windows), so a fixture is found in a few windows rather than a few million.
 */
function stopsWhere(machine: SlotMachine, want: (chain: SlotChain) => boolean): SlotStops {
  for (let i = 0; i < WINDOWS; i++) {
    let n = (i * 40_503) % WINDOWS;
    const stops: number[] = [];
    for (let reel = 0; reel < SLOT_REELS; reel++) {
      stops.push(n % SLOT_REEL_STOPS);
      n = Math.floor(n / SLOT_REEL_STOPS);
    }
    if (want(slotChain(machine, stops as SlotStops))) return stops as SlotStops;
  }
  throw new Error('No stops satisfy that');
}

/** How many steps of the chain won something. */
const wins = (chain: SlotChain) => chain.steps.filter((step) => step.lines.length > 0).length;

/** A paid spin that wins nothing and shows no scatter, so it moves no meter either. */
const blank = stopsWhere(shelf, (c) => wins(c) === 0 && c.scatters === 0);
/** One winning step, no scatter. */
const paying = stopsWhere(shelf, (c) => wins(c) === 1 && c.scatters === 0);
/** Three winning steps or more, no scatter. */
const chained = stopsWhere(shelf, (c) => wins(c) >= 3 && c.scatters === 0);
/** Three scatters and no win: 8 free spins, or a retrigger inside a free round. */
const eightFree = stopsWhere(shelf, (c) => wins(c) === 0 && c.scatters === 3);
/** One scatter and no win: one point for the meter. */
const oneScatter = stopsWhere(shelf, (c) => wins(c) === 0 && c.scatters === 1);
/** A lost paid spin on the Armoury, found on its own strips. */
const armouryBlank = stopsWhere(armoury, (c) => wins(c) === 0 && c.scatters === 0);
/** What one paying step pays, in line stakes, before any multiplier. */
const payingMultiple = slotChain(shelf, paying).steps[0].multiple;

/** Three jackpot numbers that make no pot drop. */
const LOSE = [999_999_999, 999_999_999, 999_999_999];
const JACKPOT_DRAWS = [1_000_000_000, 1_000_000_000, 1_000_000_000];
const NO_POTS = { mini: 0, major: 0, giga: 0 };
const CAPS = { mini: 1, major: 10, giga: 50 };

/** What the rules pay for this round, in whole Silver, worked out by replaying it. */
const payoutOf = (
  round: { stops: SlotStops; free?: SlotStops[]; meterFree?: SlotStops[]; meterBefore?: number },
  stake: number,
  machine = shelf,
) => (slotReplayRound(machine, { free: [], meterFree: [], meterBefore: 0, ...round }).lineStakes * stake) / SLOT_LINE_COUNT;
/** Whole Silver a lost round at this stake adds to the three pots together, as the totals round it. */
const addedSilver = (machine: SlotMachine, stake: number) =>
  Math.floor(Object.values(slotJackpotAdds(machine, stake)).reduce((sum, add) => sum + add, 0) / BRONZE_PER_SILVER);

const STARTING = [
  { key: 'shelf', live: true, stakes: [20, 40, 60] },
  { key: 'armoury', live: true, stakes: [40, 60, 100] },
  { key: 'hoard', live: true, stakes: [60, 100, 200] },
];
/** The three pots before any round has fed them, under their starting caps. */
const STARTING_POTS = [
  { pot: 'mini', live: true, amount: 0, cap: 1_000, floor: 100, last: null },
  { pot: 'major', live: true, amount: 0, cap: 10_000, floor: 1_000, last: null },
  { pot: 'giga', live: true, amount: 0, cap: 50_000, floor: 5_000, last: null },
];
const machineBody = (overrides = {}) => ({ live: true, stakes: [20, 40, 60], ...overrides });
const potsBody = (overrides = {}) => ({ mini: { live: true, cap: 1 }, major: { live: true, cap: 10 }, giga: { live: true, cap: 50 }, ...overrides });

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
  /** The draws for spins played one after another: each one's five stops. */
  const stopsOf = (...spins: SlotStops[]) => spins.flat();
  const many = (count: number, stops: SlotStops) => Array<SlotStops>(count).fill(stops);

  const spin = (body: Record<string, unknown> = {}, who = player) =>
    who.post('/api/slots/spin').send({ characterId: 7, machine: 'shelf', stake: 60, rules: 3, ...body });
  const wallet = () => {
    const { gold, silver, copper } = slots.characterRows[0];
    return { gold, silver, copper };
  };
  const untouched = () => expect(wallet()).toEqual({ gold: 5, silver: 250, copper: 0 });
  const potsUntouched = () =>
    expect(slots.potRows).toEqual({ mini: { amount: 0, cap: null }, major: { amount: 0, cap: null }, giga: { amount: 0, cap: null } });
  /** What the wallet holds after `silver` Silver is added to the starting 5 Gold 250 Silver. */
  const walletAfter = (silver: number) => ({ gold: 5 + Math.floor((250 + silver) / 1000), silver: (250 + silver) % 1000, copper: 0 });
  /** A planted spin row; the player's, today, a lost round at 20 Silver unless told otherwise. */
  const spinRow = (overrides: Partial<FakeSlotSpinRow> = {}): FakeSlotSpinRow => ({
    id: 500,
    userId: playerId,
    character: 'Mounara',
    spunAt: now,
    machine: 'shelf',
    stops: blank,
    free: [],
    meterFree: [],
    meterBefore: 0,
    stake: 20,
    payout: 0,
    jackpot: 0,
    pots: { ...NO_POTS },
    multiple: 0,
    added: 0,
    ...overrides,
  });
  const plantRounds = (count: number, overrides: Partial<FakeSlotSpinRow> = {}) => {
    for (let i = 0; i < count; i++) slots.spinRows.push(spinRow({ id: 10_000 + slots.spinRows.length, ...overrides }));
  };

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
        jackpots: STARTING_POTS,
        meters: [],
        daily: { limit: 1_500, played: 0 },
      });
    });

    it('shows the three jackpots with the caps set, before any round has fed them', async () => {
      const res = await player.get('/api/slots').expect(200);
      expect(res.body.jackpots).toEqual(STARTING_POTS);
    });

    it('shows a pot of odd Bronze as nothing, under the cap set now', async () => {
      slots.potRows.giga = { amount: 284, cap: null };
      slots.settingsRow.pots.giga.cap = 80;
      const res = await player.get('/api/slots').expect(200);
      expect(res.body.jackpots[2]).toMatchObject({ pot: 'giga', amount: 0, cap: 80_000, floor: 8_000 });
    });

    it('answers the state with three pots, the meters and the day', async () => {
      slots.settingsRow.pots.major.live = false;
      slots.potRows = {
        mini: { amount: 123_456, cap: 2_000_000 },
        major: { amount: 4_000_999, cap: null },
        giga: { amount: 7_000_999, cap: 60_000_000 },
      };
      slots.meterRows = [
        { userId: playerId, machine: 'shelf', stake: 40, points: 12 },
        { userId: playerId, machine: 'armoury', stake: 60, points: 7 },
        { userId: playerId, machine: 'shelf', stake: 20, points: 3 },
        // A machine the code no longer has, and someone else's meter: neither is shown.
        { userId: playerId, machine: 'vault', stake: 40, points: 5 },
        { userId: playerId - 1, machine: 'shelf', stake: 40, points: 9 },
      ];
      // Today's rounds of every rules number count; yesterday's and other accounts' do not.
      plantRounds(2);
      plantRounds(1, { rules: 2 });
      plantRounds(1, { spunAt: new Date('2026-11-13T10:00:00Z') });
      plantRounds(1, { userId: playerId - 1, character: 'Moosey' });
      const wonAt = new Date('2026-11-14T09:00:00Z');
      slots.spinRows.push(spinRow({ id: 900, userId: playerId - 1, character: 'Moosey', spunAt: wonAt, jackpot: 450, pots: { mini: 450, major: 0, giga: 0 } }));

      const res = await player.get('/api/slots').expect(200);

      expect(res.body.jackpots).toEqual([
        { pot: 'mini', live: true, amount: 123, cap: 2_000, floor: 200, last: { character: 'Moosey', amount: 450, at: wonAt.toISOString() } },
        { pot: 'major', live: false, amount: 4_000, cap: 10_000, floor: 1_000, last: null },
        { pot: 'giga', live: true, amount: 7_000, cap: 60_000, floor: 6_000, last: null },
      ]);
      expect(res.body.meters).toEqual([
        { machine: 'armoury', stake: 60, points: 7 },
        { machine: 'shelf', stake: 20, points: 3 },
        { machine: 'shelf', stake: 40, points: 12 },
      ]);
      expect(res.body.daily).toEqual({ limit: 1_500, played: 3 });
    });

    it('the page still opens when the pots cannot be read', async () => {
      slots.potMissing = true;
      slots.meterRows = [{ userId: playerId, machine: 'shelf', stake: 40, points: 12 }];
      const res = await player.get('/api/slots').expect(200);
      expect(res.body).toMatchObject({
        live: false,
        machines: STARTING,
        jackpots: [],
        meters: [{ machine: 'shelf', stake: 40, points: 12 }],
        daily: { limit: 1_500, played: 0 },
      });
      expect(res.body.characters).toHaveLength(2);
      // The GM page lists every pot, with nothing running.
      const gmPage = await moose.get('/api/gm/slots').expect(200);
      expect(gmPage.body.jackpots.map((p: { pot: SlotPot; running: unknown }) => [p.pot, p.running])).toEqual([
        ['mini', null],
        ['major', null],
        ['giga', null],
      ]);
    });
  });

  describe('POST /slots/spin', () => {
    beforeEach(() => {
      slots.settingsRow.live = true;
    });

    it('a paying round answers its five stops and pays the lines', async () => {
      const calls = draws(...paying);

      const res = await spin().expect(200);

      const payout = payoutOf({ stops: paying }, 60);
      expect(payout).toBe((payingMultiple * 60) / 20);
      expect(payout).toBeGreaterThan(0);
      // One draw per reel, each from the 32 stops, and nothing more.
      expect(calls).toEqual([32, 32, 32, 32, 32]);
      expect(res.body.spin).toMatchObject({
        machine: 'shelf',
        stops: paying,
        free: [],
        meterFree: [],
        meterBefore: 0,
        stake: 60,
        payout,
        character: 'Mounara',
        jackpot: 0,
        pots: NO_POTS,
      });
      expect(res.body.wallet).toEqual(walletAfter(payout - 60));
      expect(res.body.state.characters[0].wallet).toEqual(walletAfter(payout - 60));
      expect(res.body.state.mine).toEqual([res.body.spin]);
      expect(res.body.meter).toEqual({ machine: 'shelf', stake: 60, points: 0 });
      // The repository was handed whole Silver, the five stops, the meter, the day's limit and no pot add.
      expect(slots.betCalls).toEqual([
        {
          userId: playerId,
          charId: 7,
          machine: 'shelf',
          stops: paying,
          free: [],
          meterFree: [],
          stake: 60,
          payout,
          multiple: Math.floor(payout / 60),
          meterBefore: 0,
          meterAfter: 0,
          daily: 1_500,
          adds: NO_POTS,
          caps: CAPS,
          rolls: NO_POTS,
        },
      ]);
    });

    it('a round with a chain pays the chain with its step multipliers', async () => {
      const calls = draws(...chained);

      const res = await spin({ stake: 40 }).expect(200);

      const chain = slotChain(shelf, chained);
      const lineStakes = slotReplayRound(shelf, { stops: chained, free: [], meterFree: [], meterBefore: 0 }).lineStakes;
      // Step j pays times min(j, 5), so the chain pays more than its steps' lines alone.
      expect(lineStakes).toBe(chain.steps.reduce((sum, step, i) => sum + step.multiple * Math.min(i + 1, 5), 0));
      expect(lineStakes).toBeGreaterThan(chain.steps.reduce((sum, step) => sum + step.multiple, 0));
      const payout = (lineStakes * 40) / 20;
      expect(calls).toHaveLength(5);
      expect(res.body.spin).toMatchObject({ stops: chained, free: [], meterFree: [], payout });
      expect(slots.betCalls[0]).toMatchObject({ payout, multiple: Math.floor(payout / 40), adds: NO_POTS, rolls: NO_POTS });
      expect(res.body.wallet).toEqual(walletAfter(payout - 40));
    });

    it('takes the stake on a lost round', async () => {
      draws(...blank, ...LOSE);
      const res = await spin({ stake: 20 }).expect(200);
      expect(res.body.spin).toMatchObject({ stops: blank, free: [], meterFree: [], stake: 20, payout: 0 });
      expect(res.body.wallet).toEqual(walletAfter(-20));
      expect(wallet()).toEqual(walletAfter(-20));
    });

    it('a lost round with all pots on draws three jackpot numbers last', async () => {
      const calls = draws(...blank, 11, 22, 33);

      const res = await spin({ stake: 40 }).expect(200);

      // The five stops, then Mini's, Major's and Giga's numbers.
      expect(calls).toEqual([32, 32, 32, 32, 32, ...JACKPOT_DRAWS]);
      const adds = slotJackpotAdds(shelf, 40);
      expect(Object.values(adds).every((add) => add > 0)).toBe(true);
      expect(slots.betCalls[0]).toMatchObject({ payout: 0, multiple: 0, adds, caps: CAPS, rolls: { mini: 11, major: 22, giga: 33 } });
      expect(res.body.spin).toMatchObject({ jackpot: 0, pots: NO_POTS });
      expect(res.body.state.jackpots.map((p: { amount: number }) => p.amount)).toEqual([
        Math.floor(adds.mini / BRONZE_PER_SILVER),
        Math.floor(adds.major / BRONZE_PER_SILVER),
        Math.floor(adds.giga / BRONZE_PER_SILVER),
      ]);
    });

    it('a lost round with only the Giga on still draws three numbers and adds only to the Giga', async () => {
      slots.settingsRow.pots.mini.live = false;
      slots.settingsRow.pots.major.live = false;
      slots.potRows.mini = { amount: 900_000, cap: 1_000_000 };
      const calls = draws(...blank, 11, 22, 33);

      const res = await spin({ stake: 40 }).expect(200);

      expect(calls).toEqual([32, 32, 32, 32, 32, ...JACKPOT_DRAWS]);
      const giga = slotJackpotAdds(shelf, 40).giga;
      expect(slots.betCalls[0]).toMatchObject({ adds: { mini: 0, major: 0, giga }, rolls: { mini: 11, major: 22, giga: 33 } });
      // A pot switched off keeps its money and its cap, and takes nothing.
      expect(slots.potRows).toEqual({ mini: { amount: 900_000, cap: 1_000_000 }, major: { amount: 0, cap: null }, giga: { amount: giga, cap: 50_000_000 } });
      expect(res.body.state.jackpots.map((p: { live: boolean }) => p.live)).toEqual([false, false, true]);
    });

    it('a round that pays adds nothing and draws nothing more', async () => {
      const calls = draws(...paying);
      await spin().expect(200);
      expect(calls).toHaveLength(5);
      expect(slots.betCalls[0]).toMatchObject({ adds: NO_POTS, rolls: NO_POTS });
    });

    it('lists the round under mine, and under big wins only from 50 times the stake', async () => {
      draws(...paying);
      const small = await spin().expect(200);
      expect(small.body.state.mine).toHaveLength(1);
      expect(small.body.state.bigWins).toEqual([]);

      // A big win is planted: the paying stops pay far below 50 times the stake.
      slots.spinRows.push(spinRow({ stops: paying, payout: 1000, multiple: 50 }));
      const page = await player.get('/api/slots').expect(200);
      expect(page.body.mine.map((s: { id: number }) => s.id)).toEqual([500, small.body.spin.id]);
      expect(page.body.bigWins.map((s: { id: number }) => s.id)).toEqual([500]);
      // Everyone sees the big win, but only the spinner sees the round under mine.
      const other = await moose.get('/api/slots').expect(200);
      expect(other.body.bigWins).toEqual(page.body.bigWins);
      expect(other.body.mine).toEqual([]);
    });

    it('three scatters play eight free spins in the same round', async () => {
      const calls = draws(...stopsOf(eightFree, ...many(8, paying)));

      const res = await spin({ stake: 40 }).expect(200);

      // The paid spin paid nothing itself, and the free spins pay at a multiplier that climbs from times 2.
      expect(wins(slotChain(shelf, eightFree))).toBe(0);
      const payout = payoutOf({ stops: eightFree, free: many(8, paying) }, 40);
      expect(payout).toBe((payingMultiple * (2 + 3 + 4 + 5 + 6 + 7 + 8 + 9) * 40) / 20);
      expect(res.body.spin.free).toEqual(many(8, paying));
      expect(res.body.spin).toMatchObject({ stops: eightFree, meterFree: [], payout });
      expect(res.body.wallet).toEqual(walletAfter(payout - 40));
      // One money step, 5 + 8 x 5 = 45 draws, and no pot add although the paid spin paid nothing.
      expect(slots.betCalls).toHaveLength(1);
      expect(calls).toHaveLength(45);
      expect(slots.betCalls[0]).toMatchObject({ payout, multiple: Math.floor(payout / 40), adds: NO_POTS, rolls: NO_POTS, meterAfter: 0 });
      expect(slots.betCalls[0].free).toEqual(many(8, paying));
      expect(res.body.state.mine).toEqual([res.body.spin]);
    });

    it('a round with free spins and a retrigger draws them in play order', async () => {
      // The second free spin shows three scatters and adds 5: 13 free spins in all.
      const free = [paying, eightFree, chained, ...many(10, blank)];
      const calls = draws(...stopsOf(eightFree, ...free));

      const res = await spin({ stake: 40 }).expect(200);

      expect(calls).toHaveLength(5 + 13 * 5);
      expect(res.body.spin.free).toEqual(free);
      expect(slots.betCalls[0].free).toEqual(free);
      const payout = payoutOf({ stops: eightFree, free }, 40);
      expect(payout).toBeGreaterThan(0);
      // The order matters: the chained spin played second would pay at a lower multiplier.
      expect(payoutOf({ stops: eightFree, free: [chained, eightFree, paying, ...many(10, blank)] }, 40)).not.toBe(payout);
      expect(res.body.spin.payout).toBe(payout);
      expect(res.body.wallet).toEqual(walletAfter(payout - 40));
    });

    it('answers the round with its free spins when the new row is not in the list read back', async () => {
      draws(...stopsOf(eightFree, ...many(8, paying)));
      // A read that misses the row just written: the answer is made from the round itself.
      slots.spinsOf = async () => [];

      const res = await spin({ stake: 40 }).expect(200);

      const payout = payoutOf({ stops: eightFree, free: many(8, paying) }, 40);
      expect(res.body.state.mine).toEqual([]);
      expect(res.body.spin).toEqual({
        id: slots.spinRows[0].id,
        at: expect.any(String),
        character: 'Mounara',
        machine: 'shelf',
        stops: eightFree,
        free: many(8, paying),
        meterFree: [],
        meterBefore: 0,
        stake: 40,
        payout,
        jackpot: 0,
        pots: NO_POTS,
      });
      expect(res.body.wallet).toEqual(walletAfter(payout - 40));
    });

    it('free spins that all pay nothing make a lost round', async () => {
      const calls = draws(...stopsOf(eightFree, ...many(8, blank)), ...LOSE);

      const res = await spin({ stake: 40 }).expect(200);

      expect(calls).toEqual([...Array(45).fill(32), ...JACKPOT_DRAWS]);
      expect(res.body.spin).toMatchObject({ payout: 0, free: many(8, blank) });
      expect(slots.betCalls[0]).toMatchObject({ payout: 0, multiple: 0, adds: slotJackpotAdds(shelf, 40), rolls: { mini: LOSE[0], major: LOSE[1], giga: LOSE[2] } });
    });

    it('scatters in a free spin add five more, never past 50 in the round', async () => {
      // Every free spin retriggers: 8, then 5 at a time, up to 50.
      const calls = draws(...stopsOf(eightFree, ...many(50, eightFree)), ...LOSE);

      const res = await spin({ stake: 40 }).expect(200);

      expect(res.body.spin.free).toEqual(many(50, eightFree));
      expect(calls).toHaveLength(5 + 50 * 5 + 3);
      expect(slots.betCalls[0].free).toHaveLength(50);
    });

    it('a free spin that pays makes a round that pays, and the pot is not fed', async () => {
      const calls = draws(...stopsOf(eightFree, paying, ...many(7, blank)));
      await spin({ stake: 40 }).expect(200);
      expect(calls).toHaveLength(45);
      expect(slots.betCalls[0]).toMatchObject({ payout: (2 * payingMultiple * 40) / 20, adds: NO_POTS, rolls: NO_POTS });
    });

    it('sends the multiple as whole stakes won', async () => {
      // The column holds a SMALLINT; the service caps what it sends at 32767.
      draws(...stopsOf(eightFree, ...many(8, paying)));
      await spin({ stake: 20 }).expect(200);
      const payout = payoutOf({ stops: eightFree, free: many(8, paying) }, 20);
      expect(slots.betCalls[0].multiple).toBe(Math.min(32_767, Math.floor(payout / 20)));
    });

    it('a paid spin with one scatter adds a point to the meter for its machine and stake', async () => {
      slots.meterRows = [{ userId: playerId, machine: 'shelf', stake: 20, points: 4 }];
      const calls = draws(...oneScatter, ...LOSE);

      const res = await spin({ stake: 40 }).expect(200);

      expect(calls).toHaveLength(8);
      expect(slots.betCalls[0]).toMatchObject({ meterBefore: 0, meterAfter: 1, meterFree: [] });
      expect(res.body.meter).toEqual({ machine: 'shelf', stake: 40, points: 1 });
      expect(res.body.state.meters).toEqual([
        { machine: 'shelf', stake: 20, points: 4 },
        { machine: 'shelf', stake: 40, points: 1 },
      ]);
    });

    it('a round that fills the meter plays 8 meter free spins after the paid spin', async () => {
      const before = shelf.meterSize - 1;
      slots.meterRows = [{ userId: playerId, machine: 'shelf', stake: 40, points: before }];
      const calls = draws(...stopsOf(oneScatter, ...many(8, paying)));

      const res = await spin({ stake: 40 }).expect(200);

      // The paid spin's five stops, then the meter's eight free spins.
      expect(calls).toHaveLength(5 + 40);
      const payout = payoutOf({ stops: oneScatter, meterFree: many(8, paying), meterBefore: before }, 40);
      expect(payout).toBe((payingMultiple * (2 + 3 + 4 + 5 + 6 + 7 + 8 + 9) * 40) / 20);
      expect(res.body.spin).toMatchObject({ stops: oneScatter, free: [], meterFree: many(8, paying), meterBefore: before, payout });
      expect(slots.betCalls[0]).toMatchObject({ meterBefore: before, meterAfter: 0, meterFree: many(8, paying), payout, adds: NO_POTS });
      // The meter keeps the points over its size: none.
      expect(res.body.meter).toEqual({ machine: 'shelf', stake: 40, points: 0 });
      expect(slots.meterRows).toEqual([{ userId: playerId, machine: 'shelf', stake: 40, points: 0 }]);
      expect(res.body.wallet).toEqual(walletAfter(payout - 40));
      expect(res.body.state.mine).toEqual([res.body.spin]);
    });

    it('the round that drops the pot is paid it', async () => {
      slots.potRows.giga = { amount: 49_999_900, cap: 50_000_000 };
      draws(...blank, ...LOSE);
      const res = await spin().expect(200);
      const jackpot = Math.floor((49_999_900 + slotJackpotAdds(shelf, 60).giga) / BRONZE_PER_SILVER);
      expect(res.body.spin).toMatchObject({ payout: 0, jackpot, pots: { mini: 0, major: 0, giga: jackpot } });
      expect(res.body.wallet).toEqual(walletAfter(jackpot - 60));
      expect(res.body.state.jackpots[2]).toMatchObject({ pot: 'giga', amount: 0, last: { character: 'Mounara', amount: jackpot } });
      expect(res.body.state.bigWins[0].jackpot).toBe(jackpot);
    });

    it('one lost round can win two pots, and is paid both', async () => {
      slots.potRows.mini = { amount: 999_900, cap: 1_000_000 };
      slots.potRows.giga = { amount: 49_999_900, cap: 50_000_000 };
      draws(...blank, ...LOSE);
      const res = await spin().expect(200);
      const adds = slotJackpotAdds(shelf, 60);
      const mini = Math.floor((999_900 + adds.mini) / BRONZE_PER_SILVER);
      const giga = Math.floor((49_999_900 + adds.giga) / BRONZE_PER_SILVER);
      expect(res.body.spin).toMatchObject({ jackpot: mini + giga, pots: { mini, major: 0, giga } });
      expect(res.body.wallet).toEqual(walletAfter(mini + giga - 60));
    });

    it('adds nothing while every pot is off, and keeps the pots and their caps', async () => {
      for (const pot of ['mini', 'major', 'giga'] as const) slots.settingsRow.pots[pot].live = false;
      slots.potRows.giga = { amount: 7_000_000, cap: 50_000_000 };
      const calls = draws(...blank);
      const first = await spin().expect(200);
      // No pot is on, so no jackpot number is drawn.
      expect(calls).toHaveLength(5);
      expect(slots.betCalls[0]).toMatchObject({ adds: NO_POTS, rolls: NO_POTS });
      expect(slots.potRows.giga).toEqual({ amount: 7_000_000, cap: 50_000_000 });
      expect(first.body.state.jackpots.map((p: { live: boolean }) => p.live)).toEqual([false, false, false]);

      slots.settingsRow.pots.giga.live = true;
      draws(...blank, ...LOSE);
      await spin().expect(200);
      expect(slots.potRows.giga).toEqual({ amount: 7_000_000 + slotJackpotAdds(shelf, 60).giga, cap: 50_000_000 });
    });

    it('opens without the jackpots when their table cannot be read, and refuses a lost round', async () => {
      slots.potMissing = true;
      const page = await player.get('/api/slots').expect(200);
      expect(page.body.jackpots).toEqual([]);
      draws(...blank, ...LOSE);
      const res = await spin().expect(503);
      expect(res.body.message).toBe('Slots are not available right now');
      untouched();
      expect(slots.spinRows).toEqual([]);
    });

    it('the spin throttle counts by account', async () => {
      // moose was seeded just before newuser.
      slots.characterRows.push({ level: 60, classCode: 0, copper: 0, online: false, charId: 20, userId: playerId - 1, name: 'Moosey', gold: 5, silver: 250 });
      draws(...Array.from({ length: 46 }, () => [...blank, ...LOSE]).flat());
      for (let i = 0; i < 45; i++) await spin({ stake: 20 }).expect(200);
      const refused = await spin({ stake: 20 }).expect(429);
      expect(refused.body.message).toBe('Too many attempts. Please try again later.');
      await spin({ characterId: 20, stake: 20 }, moose).expect(200);
    });

    it("refuses round 1,501 with 403 and the daily message, after drawing only the round", async () => {
      // 1,499 rounds today, of both rules numbers, and some from yesterday that do not count.
      plantRounds(1_000);
      plantRounds(499, { rules: 2 });
      plantRounds(30, { spunAt: new Date('2026-11-13T10:00:00Z') });
      draws(...paying);
      await spin().expect(200);
      expect(slots.betCalls[0].daily).toBe(1_500);
      const played = wallet();

      // A lost round with a scatter: it would move the wallet, the meter and the pots.
      const calls = draws(...oneScatter, ...LOSE);
      const res = await spin().expect(403);

      expect(res.body.message).toBe("You have played today's 1,500 rounds. The slots open again for you tomorrow.");
      expect(calls).toHaveLength(8);
      expect(slots.betCalls).toHaveLength(2);
      expect(wallet()).toEqual(played);
      expect(slots.spinRows).toHaveLength(1_530);
      expect(slots.meterRows).toEqual([]);
      potsUntouched();
      const page = await player.get('/api/slots').expect(200);
      expect(page.body.daily).toEqual({ limit: 1_500, played: 1_500 });
    });

    it('the daily message names the limit a GM set, and the next day plays', async () => {
      slots.settingsRow.daily = 2_000;
      plantRounds(2_000);
      draws(...paying);
      const res = await spin().expect(403);
      expect(res.body.message).toBe("You have played today's 2,000 rounds. The slots open again for you tomorrow.");
      untouched();

      now = new Date('2026-11-15T00:00:01Z');
      draws(...paying);
      await spin().expect(200);
    });

    it('refuses a changed meter with 409 and the meter message', async () => {
      slots.meterRows = [{ userId: playerId, machine: 'shelf', stake: 40, points: 5 }];
      // Another tab plays a point onto this meter between this spin's read and its money step.
      const read = slots.meter.bind(slots);
      slots.meter = async (...args) => {
        const points = await read(...args);
        slots.meterRows[0].points = 6;
        return points;
      };
      const calls = draws(...oneScatter, ...LOSE);

      const res = await spin({ stake: 40 }).expect(409);

      expect(res.body.message).toBe('Your meter changed. Press Spin again.');
      expect(calls).toHaveLength(8);
      expect(slots.betCalls[0]).toMatchObject({ meterBefore: 5, meterAfter: 6 });
      untouched();
      expect(slots.spinRows).toEqual([]);
      expect(slots.meterRows).toEqual([{ userId: playerId, machine: 'shelf', stake: 40, points: 6 }]);
      potsUntouched();

      // The next press reads the meter again and plays.
      slots.meter = read;
      draws(...oneScatter, ...LOSE);
      const again = await spin({ stake: 40 }).expect(200);
      expect(again.body.meter).toEqual({ machine: 'shelf', stake: 40, points: 7 });
    });

    it('refuses a spin before anything is drawn when the meter cannot be read', async () => {
      // A database without the meter table: the round could not be played honestly.
      slots.meter = async () => {
        throw new Error("Invalid object name 'TPORTALSLOTMETER'");
      };
      const calls = draws(...paying);
      const res = await spin().expect(503);
      expect(res.body.message).toBe('Slots are not available right now');
      expect(calls).toEqual([]);
      expect(slots.betCalls).toEqual([]);
      untouched();
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
      potsUntouched();
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
      draws(...armouryBlank, ...LOSE);
      await spin({ machine: 'armoury', stake: 40 }).expect(200);
      expect(slots.betCalls[0]).toMatchObject({ machine: 'armoury', adds: slotJackpotAdds(armoury, 40) });
    });

    it('refuses a stake the machine does not offer', async () => {
      const calls = draws(...paying);
      // 20 is a shelf stake, but not one of the armoury's (40, 60, 100).
      const res = await spin({ machine: 'armoury', stake: 20 }).expect(422);
      expect(res.body.message).toBe('That stake is no longer offered on this machine');
      await spin({ stake: 80 }).expect(422);
      expect(slots.betCalls).toEqual([]);
      expect(calls).toEqual([]);
      potsUntouched();
      untouched();
    });

    it('refuses a stake that was offered before a GM changed the stakes', async () => {
      draws(...paying);
      await moose.put('/api/gm/slots/machines/shelf').send(machineBody({ stakes: [20, 40, 80] })).expect(200);

      const res = await spin({ stake: 60 }).expect(422);

      expect(res.body.message).toBe('That stake is no longer offered on this machine');
      expect(slots.betCalls).toEqual([]);
      potsUntouched();
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

    it('refuses a stake above 5 Gold before anything is drawn', async () => {
      // Even on a machine whose saved stakes would offer it.
      slots.settingsRow.machines.shelf.stakes = [20, 5_000, 5_020];
      const calls = draws(...paying);
      await spin({ stake: 5_020 }).expect(400);
      expect(calls).toEqual([]);
      expect(slots.betCalls).toEqual([]);
      untouched();
    });

    it('refuses a spin from a page that plays older rules with 400, telling it to reload, before anything is drawn', async () => {
      const calls = draws(...paying);
      for (const rules of [undefined, 2]) {
        const res = await spin({ rules }).expect(400);
        expect(res.body.message).toBe('The slots have changed. Reload the page to keep playing.');
      }
      expect(calls).toEqual([]);
      expect(slots.betCalls).toEqual([]);
      expect(slots.spinRows).toEqual([]);
      potsUntouched();
      untouched();
      // The page of today sends rules 3 and plays.
      await spin().expect(200);
    });

    it('refuses with 400 an unknown machine, a stake of 0 and a missing character', async () => {
      const calls = draws(...paying);
      await spin({ machine: 'casino' }).expect(400);
      await spin({ stake: 0 }).expect(400);
      await spin({ stake: 10.5 }).expect(400);
      await spin({ characterId: undefined }).expect(400);
      expect(slots.betCalls).toEqual([]);
      expect(calls).toEqual([]);
      potsUntouched();
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
      const calls = draws(...paying);
      const res = await spin().expect(503);
      expect(res.body.message).toBe('Slots are not available right now');
      expect(calls).toEqual([]);
      // failing is the slots' own tables only: the account's characters come from the wallets, which still read.
      const page = await player.get('/api/slots').expect(200);
      expect(page.body).toMatchObject({
        live: false,
        machines: STARTING,
        mine: [],
        bigWins: [],
        jackpots: [],
        meters: [],
        daily: { limit: 1_500, played: 0 },
      });
      expect(page.body.characters.map((c: { name: string }) => c.name)).toEqual(['Mounara', 'Busy']);
      untouched();
    });

    it('refuses a spin with nothing taken when the columns are not there, and still opens the page', async () => {
      // The new API on a spin table from before the cascades: the settings read, the bet and the lists do not.
      slots.columnsMissing = true;
      draws(...paying);
      const res = await spin({ stake: 20 }).expect(503);
      expect(res.body.message).toBe('Slots are not available right now');
      expect(slots.betCalls).toHaveLength(1);
      expect(slots.spinRows).toEqual([]);
      untouched();
      const page = await player.get('/api/slots').expect(200);
      expect(page.body).toMatchObject({ live: true, machines: STARTING, mine: [], bigWins: [], daily: { limit: 1_500, played: 0 } });
      expect(page.body.characters.map((c: { name: string }) => c.name)).toEqual(['Mounara', 'Busy']);
    });

    it('opens the page on a database without any of the new reads', async () => {
      // The meters, the lists, the pots and their wins fail; the settings and the day's count still read.
      const fail = async () => {
        throw new Error("Invalid column name 'szMeterFree'.");
      };
      slots.meters = fail;
      slots.pots = fail;
      slots.jackpotWins = fail;
      slots.jackpotTotals = fail;
      slots.columnsMissing = true;
      const page = await player.get('/api/slots').expect(200);
      expect(page.body).toMatchObject({ live: true, machines: STARTING, mine: [], bigWins: [], jackpots: [], meters: [], daily: { limit: 1_500, played: 0 } });
      const gmPage = await moose.get('/api/gm/slots').expect(200);
      expect(gmPage.body.jackpots).toEqual(
        (['mini', 'major', 'giga'] as const).map((pot) => ({ pot, live: true, setCap: CAPS[pot], running: null, added: 0, paid: 0, drops: 0, wins: [] })),
      );
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
      const stray = { stake: 60, payout: 3000, multiple: 50 };
      slots.spinRows.push(
        spinRow({ ...stray, id: 100, machine: 'vault', stops: [1, 2, 3, 4, 5] }),
        spinRow({ ...stray, id: 101, stops: [1, 2, 3, 4, 32] }),
        spinRow({ ...stray, id: 102, stops: [-1, 2, 3, 4, 5] }),
        spinRow({ ...stray, id: 103, stops: [1, 2, 3] as unknown as SlotStops }),
        spinRow({ ...stray, id: 104, stops: [1, 2, 3, 4, 5], free: [[1, 2, 3, 4, 32]] }),
        spinRow({ ...stray, id: 105, stops: [1, 2, 3, 4, 5], meterFree: [[1, 2, 3, 4, 32]] }),
        // Stops in range that the rules cannot replay: free spins won but not held, held but not won, a meter that did not fill.
        spinRow({ ...stray, id: 106, stops: eightFree }),
        spinRow({ ...stray, id: 107, stops: blank, free: [paying] }),
        spinRow({ ...stray, id: 108, stops: oneScatter, meterFree: many(8, paying), meterBefore: 0 }),
      );

      const page = await player.get('/api/slots').expect(200);
      expect(page.body.mine).toEqual([real.body.spin]);
      // The stray rows are all big wins, and the real one is not.
      expect(page.body.bigWins).toEqual([]);
      const gmPage = await moose.get('/api/gm/slots').expect(200);
      expect(gmPage.body.latest).toEqual([real.body.spin]);
      // Only the three machines the code has are listed, whatever the table holds.
      expect(gmPage.body.machines.map((m: { key: string }) => m.key)).toEqual(['shelf', 'armoury', 'hoard']);
    });
  });

  describe('the fake repository', () => {
    const input = () => ({
      userId: playerId,
      charId: 7,
      machine: 'shelf' as const,
      stops: [1, 0, 0, 0, 0] as SlotStops,
      free: [],
      meterFree: [],
      stake: 20,
      payout: 0,
      multiple: 0,
      meterBefore: 0,
      meterAfter: 0,
      daily: 1_500,
      adds: { ...NO_POTS },
      caps: { ...CAPS },
      rolls: { ...NO_POTS },
    });

    it('refuses a negative stake or payout like the real batch', async () => {
      slots.settingsRow.live = true;
      await expect(slots.bet({ ...input(), stake: -1 })).rejects.toThrow('cannot be negative');
      await expect(slots.bet({ ...input(), payout: -1 })).rejects.toThrow('cannot be negative');
      untouched();
    });

    it('refuses a closed floor', async () => {
      expect(await slots.bet(input())).toEqual({ code: 1, name: null });
      untouched();
    });
  });

  describe('GM routes', () => {
    it('keeps a player out of the GM routes', async () => {
      await player.get('/api/gm/slots').expect(403);
      await player.put('/api/gm/slots/floor').send({ live: true }).expect(403);
      await player.put('/api/gm/slots/machines/shelf').send(machineBody({ live: false })).expect(403);
      await player.put('/api/gm/slots/jackpots').send(potsBody({ mini: { live: false, cap: 2 } })).expect(403);
      await player.put('/api/gm/slots/daily').send({ rounds: 200 }).expect(403);
      expect(slots.settingsRow.live).toBe(false);
      expect(slots.settingsRow.machines.shelf.live).toBe(true);
      expect(slots.settingsRow.pots.mini).toEqual({ live: true, cap: 1 });
      expect(slots.settingsRow.daily).toBe(1_500);
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
      ['a stake above 5 Gold', { stakes: [20, 40, 5_020] }],
      ['a stake above the old largest', { stakes: [20, 40, 100_020] }],
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
      draws(...armouryBlank, ...LOSE);
      await spin({ machine: 'armoury', stake: 40 }).expect(200);
      // An older day only counts toward all time.
      now = new Date('2026-11-15T10:00:00Z');
      draws(...blank, ...LOSE);
      await spin({ stake: 20 }).expect(200);

      const res = await moose.get('/api/gm/slots').expect(200);

      const paid = payoutOf({ stops: paying }, 60);
      const armouryAdded = addedSilver(armoury, 40);
      const shelfAdded = addedSilver(shelf, 20);
      expect(res.body.live).toBe(true);
      expect(res.body.machines).toEqual([
        { key: 'shelf', live: true, stakes: [20, 40, 60], today: { spins: 1, staked: 20, paid: 0, added: shelfAdded }, allTime: { spins: 2, staked: 80, paid, added: shelfAdded } },
        { key: 'armoury', live: true, stakes: [40, 60, 100], today: { spins: 0, staked: 0, paid: 0, added: 0 }, allTime: { spins: 1, staked: 40, paid: 0, added: armouryAdded } },
        { key: 'hoard', live: true, stakes: [60, 100, 200], today: { spins: 0, staked: 0, paid: 0, added: 0 }, allTime: { spins: 0, staked: 0, paid: 0, added: 0 } },
      ]);
      expect(res.body.latest.map((s: { stake: number }) => s.stake)).toEqual([20, 40, 60]);
      expect(res.body.latest[0]).toMatchObject({ character: 'Mounara', machine: 'shelf', stops: blank, free: [], meterFree: [], payout: 0 });
      expect(res.body.daily).toEqual({ limit: 1_500 });
    });

    it('GM: shows the three jackpots', async () => {
      slots.settingsRow.live = true;
      slots.potRows.giga = { amount: 49_999_900, cap: 50_000_000 };
      draws(...blank, ...LOSE);
      await spin().expect(200);
      const adds = slotJackpotAdds(shelf, 60);
      const won = Math.floor((49_999_900 + adds.giga) / BRONZE_PER_SILVER);

      const res = await moose.get('/api/gm/slots').expect(200);

      expect(res.body.jackpots.map((p: { pot: SlotPot }) => p.pot)).toEqual(['mini', 'major', 'giga']);
      expect(res.body.jackpots[0]).toEqual({
        pot: 'mini',
        live: true,
        setCap: 1,
        running: { pot: Math.floor(adds.mini / BRONZE_PER_SILVER), cap: 1_000, floor: 100 },
        added: Math.floor(adds.mini / BRONZE_PER_SILVER),
        paid: 0,
        drops: 0,
        wins: [],
      });
      expect(res.body.jackpots[1]).toMatchObject({ pot: 'major', setCap: 10, running: { cap: 10_000, floor: 1_000 }, drops: 0 });
      expect(res.body.jackpots[2]).toMatchObject({
        pot: 'giga',
        live: true,
        setCap: 50,
        running: { pot: 0, cap: 50_000, floor: 5_000 },
        added: Math.floor(adds.giga / BRONZE_PER_SILVER),
        paid: won,
        drops: 1,
      });
      expect(res.body.jackpots[2].wins).toHaveLength(1);
      expect(res.body.jackpots[2].wins[0]).toMatchObject({ character: 'Mounara', jackpot: won, pots: { mini: 0, major: 0, giga: won } });
      expect(res.body.machines[0].allTime.added).toBe(addedSilver(shelf, 60));
    });

    it('the GM saves three pots and the daily limit, and refuses caps out of order', async () => {
      const first = await moose.put('/api/gm/slots/jackpots').send(potsBody()).expect(200);
      expect(first.body.jackpots.map((p: { live: boolean; setCap: number }) => [p.live, p.setCap])).toEqual([
        [true, 1],
        [true, 10],
        [true, 50],
      ]);
      const res = await moose
        .put('/api/gm/slots/jackpots')
        .send(potsBody({ mini: { live: false, cap: 2 }, major: { live: true, cap: 20 }, giga: { live: true, cap: 80 } }))
        .expect(200);
      expect(res.body.jackpots.map((p: { live: boolean; setCap: number }) => [p.live, p.setCap])).toEqual([
        [false, 2],
        [true, 20],
        [true, 80],
      ]);
      expect(slots.settingsRow.pots).toEqual({ mini: { live: false, cap: 2 }, major: { live: true, cap: 20 }, giga: { live: true, cap: 80 } });

      const daily = await moose.put('/api/gm/slots/daily').send({ rounds: 1_500 }).expect(200);
      expect(daily.body.daily).toEqual({ limit: 1_500 });
      const more = await moose.put('/api/gm/slots/daily').send({ rounds: 2_000 }).expect(200);
      expect(more.body.daily).toEqual({ limit: 2_000 });
      expect(slots.settingsRow.daily).toBe(2_000);
      expect(gm.audits.map((a) => [a.gmId, a.command, a.log])).toEqual([
        ['moose', 'SLOTS', 'JACKPOTS mini on 1 major on 10 giga on 50'],
        ['moose', 'SLOTS', 'JACKPOTS mini off 2 major on 20 giga on 80'],
        ['moose', 'SLOTS', 'DAILY 1500'],
        ['moose', 'SLOTS', 'DAILY 2000'],
      ]);

      // Caps out of order are refused whole.
      await moose.put('/api/gm/slots/jackpots').send(potsBody({ major: { live: true, cap: 1 } })).expect(400);
      await moose.put('/api/gm/slots/jackpots').send(potsBody({ giga: { live: true, cap: 10 } })).expect(400);
      expect(slots.settingsRow.pots).toEqual({ mini: { live: false, cap: 2 }, major: { live: true, cap: 20 }, giga: { live: true, cap: 80 } });
      expect(gm.audits).toHaveLength(4);
    });

    it("GM: a changed cap shows beside the running pot's own", async () => {
      slots.potRows.giga = { amount: 10_000_000, cap: 50_000_000 };
      const res = await moose.put('/api/gm/slots/jackpots').send(potsBody({ giga: { live: true, cap: 80 } })).expect(200);
      expect(res.body.jackpots[2]).toMatchObject({ setCap: 80, running: { pot: 10_000, cap: 50_000, floor: 5_000 } });
      expect(gm.audits[0].log).toBe('JACKPOTS mini on 1 major on 10 giga on 80');
    });

    it.each([0, 10_001, 1.5])('GM: refuses a cap of %s', async (cap) => {
      await moose.put('/api/gm/slots/jackpots').send(potsBody({ giga: { live: true, cap } })).expect(400);
      expect(slots.settingsRow.pots.giga).toEqual({ live: true, cap: 50 });
      expect(gm.audits).toEqual([]);
    });

    it('GM: refuses a pot without its switch, and a body without a pot', async () => {
      await moose.put('/api/gm/slots/jackpots').send(potsBody({ mini: { cap: 1 } })).expect(400);
      await moose.put('/api/gm/slots/jackpots').send({ mini: { live: true, cap: 1 }, giga: { live: true, cap: 50 } }).expect(400);
      expect(gm.audits).toEqual([]);
    });

    it.each([99, 10_001, 1_500.5, undefined])('GM: refuses a daily limit of %s', async (rounds) => {
      await moose.put('/api/gm/slots/daily').send({ rounds }).expect(400);
      expect(slots.settingsRow.daily).toBe(1_500);
      expect(gm.audits).toEqual([]);
    });

    it('GM: the one pot route is gone', async () => {
      await moose.put('/api/gm/slots/jackpot').send({ live: false, cap: 80 }).expect(404);
      expect(slots.settingsRow.pots.giga).toEqual({ live: true, cap: 50 });
    });

    it('still opens, closed and empty, when the tables cannot be read', async () => {
      slots.failing = true;
      const res = await moose.get('/api/gm/slots').expect(200);
      const empty = { spins: 0, staked: 0, paid: 0, added: 0 };
      expect(res.body).toEqual({
        live: false,
        machines: STARTING.map((m) => ({ ...m, today: empty, allTime: empty })),
        latest: [],
        jackpots: (['mini', 'major', 'giga'] as const).map((pot) => ({ pot, live: true, setCap: CAPS[pot], running: null, added: 0, paid: 0, drops: 0, wins: [] })),
        daily: { limit: 1_500 },
      });
    });

    it('answers 503 when the settings cannot be saved', async () => {
      slots.failing = true;
      const floor = await moose.put('/api/gm/slots/floor').send({ live: true }).expect(503);
      expect(floor.body.message).toBe('Slots are not available right now');
      await moose.put('/api/gm/slots/machines/shelf').send(machineBody()).expect(503);
      await moose.put('/api/gm/slots/jackpots').send(potsBody()).expect(503);
      await moose.put('/api/gm/slots/daily').send({ rounds: 2_000 }).expect(503);
      expect(gm.audits).toEqual([]);
    });
  });
});
