import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sha1Hex } from '../src/auth/sha1.js';
import { RouletteService } from '../src/roulette/roulette.service.js';
import { FakeAccountsRepository, FakeGmRepository, FakeRouletteRepository } from './fakes.js';
import { createTestApp } from './test-app.js';

const settingsBody = (overrides = {}) => ({ live: true, minBet: 10, maxNumber: 2000, maxOutside: 10_000, ...overrides });

describe('/api/roulette', () => {
  let app: INestApplication;
  let roulette: FakeRouletteRepository;
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
    roulette = new FakeRouletteRepository();
    now = new Date('2026-11-14T10:00:00Z');
    roulette.now = () => now;
    const base = { level: 60, classCode: 0, copper: 0, online: false };
    roulette.characterRows = [
      { ...base, charId: 7, userId: playerId, name: 'Mounara', gold: 5, silver: 250 },
      { ...base, charId: 8, userId: playerId, name: 'Busy', gold: 5, silver: 0, online: true },
      { ...base, charId: 9, userId: playerId + 50, name: 'Stranger', gold: 5, silver: 0 },
    ];
    gm = new FakeGmRepository();
    app = await createTestApp({ accounts, gm, roulette, wallets: roulette.wallets });
    player = request.agent(app.getHttpServer());
    await player.post('/api/auth/login').send({ username: 'newuser', password: 'secret1' }).expect(200);
    moose = request.agent(app.getHttpServer());
    await moose.post('/api/auth/login').send({ username: 'moose', password: 'secret1' }).expect(200);
  });

  afterEach(() => app.close());

  /** Makes the next spins land on this pocket. */
  const roll = (value: number) => {
    const calls: number[] = [];
    app.get(RouletteService).random = (max) => {
      calls.push(max);
      return value;
    };
    return calls;
  };

  const spin = (bets: { spot: string; amount: number }[], characterId = 7) =>
    player.post('/api/roulette/spin').send({ characterId, bets });
  const wallet = () => {
    const { gold, silver, copper } = roulette.characterRows[0];
    return { gold, silver, copper };
  };

  describe('GET /roulette', () => {
    it('needs a login', async () => {
      await request(app.getHttpServer()).get('/api/roulette').expect(401);
    });

    it("shows a closed table with the starting limits and the account's own characters", async () => {
      const res = await player.get('/api/roulette').expect(200);
      expect(res.body).toEqual({
        live: false,
        limits: { minBet: 10, maxNumber: 1000, maxOutside: 10_000 },
        characters: [
          { id: 7, name: 'Mounara', level: 60, className: expect.any(String), online: false, wallet: { gold: 5, silver: 250, copper: 0 } },
          { id: 8, name: 'Busy', level: 60, className: expect.any(String), online: true, wallet: { gold: 5, silver: 0, copper: 0 } },
        ],
        mine: [],
        bigWins: [],
      });
    });
  });

  describe('POST /roulette/spin', () => {
    beforeEach(() => {
      roulette.settingsRow = { live: true, minBet: 10, maxNumber: 1000, maxOutside: 10_000 };
    });

    it('pays a winning number and returns the new wallet', async () => {
      const calls = roll(17);

      const res = await spin([
        { spot: 'n17', amount: 100 },
        { spot: 'red', amount: 500 },
      ]).expect(200);

      expect(calls).toEqual([37]);
      expect(res.body.spin).toMatchObject({ pocket: 17, stake: 600, payout: 3600, character: 'Mounara' });
      expect(res.body.winning).toEqual(['n17']);
      expect(res.body.wallet).toEqual({ gold: 8, silver: 250, copper: 0 });
      expect(res.body.state.characters[0].wallet).toEqual({ gold: 8, silver: 250, copper: 0 });
      expect(res.body.state.mine).toEqual([res.body.spin]);
      // The repository was handed whole Silver and the bets in the stored text form.
      expect(roulette.betCalls).toEqual([
        { userId: playerId, charId: 7, pocket: 17, stake: 600, payout: 3600, bets: 'n17:100,red:500', numberHit: true },
      ]);
    });

    it('takes the stake on a loss', async () => {
      roll(0);
      const res = await spin([{ spot: 'red', amount: 500 }]).expect(200);
      expect(res.body.spin).toMatchObject({ pocket: 0, stake: 500, payout: 0 });
      expect(res.body.winning).toEqual([]);
      expect(res.body.wallet).toEqual({ gold: 4, silver: 750, copper: 0 });
    });

    it('lists the spin under mine, and under big wins only when a number hit', async () => {
      roll(18);
      const outside = await spin([{ spot: 'red', amount: 100 }]).expect(200);
      expect(outside.body.state.mine).toHaveLength(1);
      expect(outside.body.state.bigWins).toEqual([]);

      roll(17);
      const number = await spin([{ spot: 'n17', amount: 100 }]).expect(200);
      expect(number.body.state.mine.map((s: { id: number }) => s.id)).toEqual([number.body.spin.id, outside.body.spin.id]);
      expect(number.body.state.bigWins).toEqual([number.body.spin]);
      // Everyone sees the big win, but only the spinner sees the spin under mine.
      const other = await moose.get('/api/roulette').expect(200);
      expect(other.body.bigWins).toEqual([number.body.spin]);
      expect(other.body.mine).toEqual([]);
    });

    it.each([
      ['a bet under the smallest', [{ spot: 'red', amount: 9 }], 'The smallest bet is 10 Silver'],
      ['a number over its limit', [{ spot: 'n5', amount: 1001 }], 'The largest bet on a number is 1 Gold'],
      ['an outside spot over its limit', [{ spot: 'odd', amount: 10_001 }], 'The largest bet on Odd is 10 Gold'],
      [
        'the same spot twice',
        [
          { spot: 'red', amount: 100 },
          { spot: 'red', amount: 100 },
        ],
        'Each spot can only be bet on once',
      ],
    ])('refuses %s with 422 and takes nothing', async (_name, bets, message) => {
      const calls = roll(17);
      const res = await spin(bets).expect(422);
      expect(res.body.message).toBe(message);
      // A refused spin never reaches the repository, which would move money on whatever it is given.
      expect(roulette.betCalls).toEqual([]);
      expect(calls).toEqual([]);
      expect(wallet()).toEqual({ gold: 5, silver: 250, copper: 0 });
      expect(roulette.spinRows).toEqual([]);
    });

    it('refuses with 400 a spot that is not on the table, and an empty list', async () => {
      await spin([{ spot: 'n37', amount: 100 }]).expect(400);
      await spin([{ spot: 'green', amount: 100 }]).expect(400);
      await spin([]).expect(400);
      await spin([{ spot: 'red', amount: 0 }]).expect(400);
      await spin([{ spot: 'red', amount: 10.5 }]).expect(400);
      expect(roulette.betCalls).toEqual([]);
    });

    it('refuses while the table is closed, GMs included', async () => {
      roulette.settingsRow.live = false;
      roll(17);
      const res = await spin([{ spot: 'red', amount: 100 }]).expect(503);
      expect(res.body.message).toBe('The table is not open yet');
      const gmRes = await moose
        .post('/api/roulette/spin')
        .send({ characterId: 7, bets: [{ spot: 'red', amount: 100 }] })
        .expect(503);
      expect(gmRes.body.message).toBe('The table is not open yet');
      expect(wallet()).toEqual({ gold: 5, silver: 250, copper: 0 });
    });

    it('refuses a character in the game by name', async () => {
      roll(17);
      const res = await spin([{ spot: 'red', amount: 100 }], 8).expect(409);
      expect(res.body.message).toBe('Log out of Busy in the game first');
      expect(roulette.spinRows).toEqual([]);
    });

    it("refuses someone else's character", async () => {
      roll(17);
      const res = await spin([{ spot: 'red', amount: 100 }], 9).expect(422);
      expect(res.body.message).toBe('Pick one of your own characters');
      expect(roulette.characterRows[2].gold).toBe(5);
    });

    it('refuses a stake the wallet cannot cover', async () => {
      roll(17);
      const res = await spin([
        { spot: 'odd', amount: 3000 },
        { spot: 'even', amount: 3000 },
      ]).expect(422);
      expect(res.body.message).toBe('Not enough money in that wallet');
      expect(wallet()).toEqual({ gold: 5, silver: 250, copper: 0 });
      expect(roulette.spinRows).toEqual([]);
    });

    it('refuses bets that were allowed before a GM lowered the limit', async () => {
      roll(17);
      await moose.put('/api/gm/roulette/settings').send(settingsBody({ maxNumber: 50 })).expect(200);
      const res = await spin([{ spot: 'n17', amount: 100 }]).expect(422);
      expect(res.body.message).toBe('The largest bet on a number is 50 Silver');
      expect(wallet()).toEqual({ gold: 5, silver: 250, copper: 0 });
      expect(roulette.betCalls).toEqual([]);
    });

    it('answers 503 when the tables are missing, and still serves a closed page', async () => {
      roulette.failing = true;
      const res = await spin([{ spot: 'red', amount: 100 }]).expect(503);
      expect(res.body.message).toBe('Roulette is not available right now');
      const page = await player.get('/api/roulette').expect(200);
      expect(page.body).toMatchObject({
        live: false,
        limits: { minBet: 10, maxNumber: 1000, maxOutside: 10_000 },
        characters: [],
        mine: [],
        bigWins: [],
      });
    });

    it('answers 503 when the bet itself throws', async () => {
      roll(17);
      roulette.bet = async () => {
        throw new Error('deadlock');
      };
      const res = await spin([{ spot: 'red', amount: 100 }]).expect(503);
      expect(res.body.message).toBe('Roulette is not available right now');
    });
  });

  describe('the fake repository', () => {
    it('refuses a negative stake or payout like the real batch', async () => {
      const input = { userId: playerId, charId: 7, pocket: 1, stake: 10, payout: 0, bets: 'red:10', numberHit: false };
      await expect(roulette.bet({ ...input, stake: -1 })).rejects.toThrow('cannot be negative');
      await expect(roulette.bet({ ...input, payout: -1 })).rejects.toThrow('cannot be negative');
      expect(wallet()).toEqual({ gold: 5, silver: 250, copper: 0 });
    });
  });

  describe('GM routes', () => {
    it('keeps a player out of the GM routes', async () => {
      await player.get('/api/gm/roulette').expect(403);
      await player.put('/api/gm/roulette/settings').send(settingsBody()).expect(403);
      expect(roulette.settingsRow.live).toBe(false);
    });

    it('saves the switch and limits and writes a ROULETTE audit row', async () => {
      const res = await moose.put('/api/gm/roulette/settings').send(settingsBody()).expect(200);
      expect(res.body).toMatchObject({ live: true, limits: { minBet: 10, maxNumber: 2000, maxOutside: 10_000 } });
      expect(roulette.settingsRow).toEqual({ live: true, minBet: 10, maxNumber: 2000, maxOutside: 10_000 });
      expect(gm.audits).toEqual([
        expect.objectContaining({ gmId: 'moose', command: 'ROULETTE', log: 'SET on min 10 number 2000 outside 10000' }),
      ]);
      await moose.put('/api/gm/roulette/settings').send(settingsBody({ live: false })).expect(200);
      expect(gm.audits[1].log).toBe('SET off min 10 number 2000 outside 10000');
    });

    it.each([
      ['a limit above 1,000 Gold', { maxNumber: 1_000_001 }],
      ['a smallest bet above a largest', { minBet: 3000 }],
      ['a limit of zero', { maxOutside: 0 }],
      ['a fractional limit', { minBet: 10.5 }],
    ])('refuses %s', async (_name, overrides) => {
      await moose.put('/api/gm/roulette/settings').send(settingsBody(overrides)).expect(400);
      expect(roulette.settingsRow.live).toBe(false);
      expect(gm.audits).toEqual([]);
    });

    it("shows a GM today's and all-time totals and the latest spins", async () => {
      roulette.settingsRow.live = true;
      roll(17);
      await spin([{ spot: 'n17', amount: 100 }]).expect(200);
      roll(0);
      await spin([{ spot: 'red', amount: 500 }]).expect(200);
      // An older day only counts toward all time.
      now = new Date('2026-11-15T10:00:00Z');
      await spin([{ spot: 'red', amount: 50 }]).expect(200);

      const res = await moose.get('/api/gm/roulette').expect(200);

      expect(res.body.live).toBe(true);
      expect(res.body.today).toEqual({ spins: 1, staked: 50, paid: 0 });
      expect(res.body.allTime).toEqual({ spins: 3, staked: 650, paid: 3600 });
      expect(res.body.latest.map((s: { stake: number }) => s.stake)).toEqual([50, 500, 100]);
      expect(res.body.latest[0]).toMatchObject({ character: 'Mounara', pocket: 0, payout: 0 });
    });

    it('still opens, closed and empty, when the tables cannot be read', async () => {
      roulette.failing = true;
      const res = await moose.get('/api/gm/roulette').expect(200);
      expect(res.body).toEqual({
        live: false,
        limits: { minBet: 10, maxNumber: 1000, maxOutside: 10_000 },
        today: { spins: 0, staked: 0, paid: 0 },
        allTime: { spins: 0, staked: 0, paid: 0 },
        latest: [],
      });
    });

    it('answers 503 when the settings cannot be saved', async () => {
      roulette.failing = true;
      const res = await moose.put('/api/gm/roulette/settings').send(settingsBody()).expect(503);
      expect(res.body.message).toBe('Roulette is not available right now');
      expect(gm.audits).toEqual([]);
    });
  });
});
