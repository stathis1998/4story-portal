import { Logger, type INestApplication } from '@nestjs/common';
import type { Achievement, AchievementsOverview, GmAchievements, News } from '@4story-portal/shared';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AchievementAwarder } from '../src/achievements/achievement-awarder.js';
import { ANNOUNCE_SENT, ANNOUNCE_SKIPPED, ANNOUNCE_WAITING } from '../src/achievements/achievements.repository.js';
import { sha1Hex } from '../src/auth/sha1.js';
import { itemIcons } from '../src/gm/game-icons.generated.js';
import type { CharacterRow, StatRows } from '../src/stats/stats-rules.js';
import { serverNow } from '../src/stats/stats.service.js';
import { FakeAccountsRepository, FakeAchievementsRepository, FakeControlClient, FakeStatsRepository } from './fakes.js';
import { createTestApp } from './test-app.js';

const MOOSE = 100;
const PLAYER = 101;
const [itemId] = Object.keys(itemIcons).map(Number);
const MINUTE = 60_000;

const character = (overrides: Partial<CharacterRow>): CharacterRow => ({
  id: 1,
  userId: PLAYER,
  name: 'Kaelith',
  classCode: 0,
  raceCode: 0,
  countryCode: 0,
  level: 1,
  exp: 0,
  levelStartExp: null,
  levelEndExp: null,
  gold: 0,
  createdAt: null,
  banned: false,
  ...overrides,
});

const baseRows = (): StatRows => ({
  // Level 60 is three levels of `level` and one of `roster`; nothing else is reached.
  characters: [character({ id: 1, level: 60 }), character({ id: 3, name: 'Moosey', userId: MOOSE, level: 20 })],
  sessions: [],
  gear: [],
  companions: [],
  titles: [],
  titlesTotal: 110,
  social: [],
  combat: [],
  spending: [],
  soulLottery: [],
  lotteryStreaks: [],
  upgradeAttempts: [],
  upgradeLosses: [],
  upgradeFailures: [],
  progress: [],
  pets: [],
  optionRules: [],
  accounts: [
    { userId: MOOSE, username: 'moose' },
    { userId: PLAYER, username: 'friend' },
  ],
});

describe('achievement routes', () => {
  let app: INestApplication;
  let stats: FakeStatsRepository;
  let repo: FakeAchievementsRepository;
  let control: FakeControlClient;
  let awarder: AchievementAwarder;
  let moose: ReturnType<typeof request.agent>;
  let player: ReturnType<typeof request.agent>;

  beforeAll(() => Logger.overrideLogger(false));

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 10, 13, 16, 30) });
    const accounts = new FakeAccountsRepository();
    accounts.seed('moose', sha1Hex('secret1'));
    accounts.seed('friend', sha1Hex('secret1'));
    stats = new FakeStatsRepository();
    stats.rows = baseRows();
    repo = new FakeAchievementsRepository();
    repo.now = serverNow;
    repo.recipientRows = [
      { userId: PLAYER, charId: 1, name: 'Kaelith' },
      { userId: MOOSE, charId: 3, name: 'Moosey' },
    ];
    repo.items = [{ itemId, name: 'Potion', stack: 20 }];
    control = new FakeControlClient();
    app = await createTestApp({ accounts, control, stats, achievements: repo });
    awarder = app.get(AchievementAwarder);
    const login = async (username: string) => {
      const agent = request.agent(app.getHttpServer());
      await agent.post('/api/auth/login').send({ username, password: 'secret1' }).expect(200);
      return agent;
    };
    moose = await login('moose');
    player = await login('friend');
  });

  afterEach(async () => {
    await app.close();
    vi.useRealTimers();
  });

  /** Moves the clock past the stats cache, so changed rows are read. */
  const advance = (ms = MINUTE + 1) => vi.setSystemTime(Date.now() + ms);
  const overview = async (agent = player) => (await agent.get('/api/me/achievements').expect(200)).body as AchievementsOverview;
  const achievement = async (id: string, agent = player): Promise<Achievement> =>
    (await overview(agent)).achievements.find((entry) => entry.id === id)!;
  const goLive = () => moose.put('/api/gm/achievements/live').send({ live: true }).expect(200);
  const awardsOf = (userId: number) => repo.rows.filter((row) => row.userId === userId).map((row) => `${row.achievementId}:${row.level}`);

  describe('access', () => {
    const routes = [
      ['get', '/api/me/achievements'],
      ['get', '/api/news'],
      ['get', '/api/gm/achievements'],
      ['put', '/api/gm/achievements/rewards'],
      ['put', '/api/gm/achievements/live'],
      ['post', '/api/gm/achievements/test-announcement'],
    ] as const;

    it.each(routes)('%s %s is 401 when logged out', async (method, path) => {
      expect((await request(app.getHttpServer())[method](path)).status).toBe(401);
    });

    it.each(routes.slice(2))('%s %s is 403 for a player', async (method, path) => {
      expect((await player[method](path).send({})).status).toBe(403);
    });
  });

  describe('GET /me/achievements', () => {
    it('shows each achievement as one block with its levels', async () => {
      const level = await achievement('level');
      expect(level).toMatchObject({ name: 'Adventurer', category: 'progress', value: 60, valueText: '60', levelsDone: 3 });
      expect(level.levels.map((entry) => [entry.level, entry.threshold, entry.done])).toEqual([
        [1, 20, true],
        [2, 40, true],
        [3, 60, true],
        [4, 80, false],
        [5, 90, false],
      ]);
      expect(level.levels[3]).toMatchObject({ goal: 'Reach level 80', thresholdText: '80', reward: null, earnedAt: null });
    });

    it('writes thresholds the way it writes the value', async () => {
      expect((await achievement('damage')).levels.map((entry) => entry.thresholdText)).toEqual(['1M', '10M', '100M', '1B', '5B']);
      expect((await achievement('upgrade')).levels[0].thresholdText).toBe('+18');
      expect((await achievement('kills')).levels[1].thresholdText).toBe('10,000');
    });

    it('says rewards are off, and still shows levels, when the switch cannot be read', async () => {
      repo.failWith = new Error('Invalid object name');
      expect(await overview()).toMatchObject({ live: false, levelsDone: 4 });
    });

    it('counts the levels done and how many players have each', async () => {
      const body = await overview();
      expect(body).toMatchObject({ levelsDone: 4, players: 2, live: false });
      expect(body.levelsTotal).toBeGreaterThan(150);
      const level = body.achievements.find((entry) => entry.id === 'level')!;
      // Moose's level 20 character has the first level too.
      expect(level.levels.map((entry) => entry.holders)).toEqual([2, 1, 1, 0, 0]);
    });

    it('is all zeros for an account with no characters', async () => {
      stats.rows = { ...baseRows(), characters: [character({ id: 3, userId: MOOSE, level: 20 })] };
      const body = await overview();
      expect(body.levelsDone).toBe(0);
      expect(body.achievements.every((entry) => entry.value === 0)).toBe(true);
    });

    it('still shows levels when the awards cannot be read', async () => {
      repo.failWith = new Error('Invalid object name');
      expect((await overview()).levelsDone).toBe(4);
    });
  });

  describe('the awarder', () => {
    it('does nothing until rewards are switched on', async () => {
      expect(await awarder.tick()).toEqual({ awarded: 0, announced: 0 });
      expect(repo.sent).toEqual([]);
      expect(control.announcements).toEqual([]);
    });

    it('awards every level already reached, lowest levels first, each with a letter and an announcement', async () => {
      await goLive();
      expect(await awarder.tick()).toEqual({ awarded: 5, announced: 5 });
      expect(awardsOf(PLAYER)).toEqual(['level:1', 'roster:1', 'level:2', 'level:3']);
      expect(awardsOf(MOOSE)).toEqual(['level:1']);

      const third = repo.sent.find((sent) => sent.achievementId === 'level' && sent.level === 3)!;
      expect(third).toMatchObject({
        userId: PLAYER,
        charId: 1,
        sender: 'Achievements',
        title: 'Achievement: Adventurer III',
        message: 'You completed Adventurer III: Reach level 60.',
        rewardNote: ' Your reward is attached.',
        text: 'Kaelith completed Adventurer III: Reach level 60',
      });
      // No reward is set, so the letter says nothing about one.
      expect(repo.letters.find((letter) => letter.title === 'Achievement: Adventurer III')).toEqual({
        charId: 1,
        title: 'Achievement: Adventurer III',
        message: 'You completed Adventurer III: Reach level 60.',
        reward: null,
      });
      expect(control.announcements).toContain('Kaelith completed Adventurer III: Reach level 60');
      expect(repo.rows.every((row) => row.announced === ANNOUNCE_SENT)).toBe(true);
    });

    it('never awards a level twice', async () => {
      await goLive();
      await awarder.tick();
      expect(await awarder.tick()).toEqual({ awarded: 0, announced: 0 });
      expect(repo.rows).toHaveLength(5);
      // Not even asked for again: the awarder knows what has been given.
      expect(repo.sent).toHaveLength(5);
      expect(control.announcements).toHaveLength(5);
    });

    it('attaches the reward a GM set for the level', async () => {
      const reward = { gold: 25, silver: 500, copper: 0, items: [{ itemId, count: 3 }] };
      await moose.put('/api/gm/achievements/rewards').send({ achievementId: 'level', level: 2, reward }).expect(200);
      await goLive();
      await awarder.tick();
      expect(repo.letters.find((letter) => letter.charId === 1 && letter.title === 'Achievement: Adventurer II')).toMatchObject({
        message: 'You completed Adventurer II: Reach level 40. Your reward is attached.',
        reward: { achievementId: 'level', level: 2, ...reward },
      });
    });

    it('stops in the middle of a batch when rewards are switched off', async () => {
      await goLive();
      repo.onAward = () => {
        if (repo.rows.length === 2) repo.liveFlag = false;
      };
      expect(await awarder.tick()).toEqual({ awarded: 2, announced: 0 });
      expect(repo.sent).toHaveLength(3);
      expect(control.announcements).toEqual([]);
    });

    it('carries on past an award that fails, and gives it on a later tick', async () => {
      await goLive();
      repo.failAward = (input) => input.achievementId === 'roster';
      expect(await awarder.tick()).toEqual({ awarded: 4, announced: 4 });
      expect(awardsOf(PLAYER)).toEqual(['level:1', 'level:2', 'level:3']);

      repo.failAward = undefined;
      expect(await awarder.tick()).toEqual({ awarded: 1, announced: 1 });
      expect(awardsOf(PLAYER)).toContain('roster:1');
    });

    it('does not announce what another portal process has already taken', async () => {
      await goLive();
      repo.claimedElsewhere = true;
      expect(await awarder.tick()).toEqual({ awarded: 5, announced: 0 });
      expect(control.announcements).toEqual([]);
    });

    it('runs one tick at a time', async () => {
      await goLive();
      const [first, second] = await Promise.all([awarder.tick(), awarder.tick()]);
      expect([first.awarded, second.awarded]).toEqual([5, 0]);
      expect(repo.sent).toHaveLength(5);
    });

    it('names a single-level achievement without a numeral', async () => {
      stats.rows = { ...baseRows(), social: [{ charId: 1, friends: 0, inGuild: true, leadsGuild: false, duelWins: 0 }] };
      await goLive();
      await awarder.tick();
      expect(repo.sent.find((sent) => sent.achievementId === 'guild-member')).toMatchObject({
        title: 'Achievement: Guild Member',
        text: 'Kaelith completed Guild Member: Join a guild',
      });
    });

    it('awards at most 20 levels a tick and carries on in the next', async () => {
      // Level 90 with 10,000 gold: 5 + 1 + 5 levels, and a million kills dealing 5 billion: 5 + 5.
      stats.rows = {
        ...baseRows(),
        characters: [character({ id: 1, level: 90, gold: 10_000 })],
        combat: [{ charId: 1, kills: 1_000_000, damageDealt: 5_000_000_000 }],
      };
      await goLive();
      expect(await awarder.tick()).toEqual({ awarded: 20, announced: 20 });
      // Nobody online any more: the backlog still drains.
      repo.active = false;
      expect(await awarder.tick()).toEqual({ awarded: 1, announced: 1 });
      expect(repo.rows.map((row) => row.level)).toEqual(repo.rows.map((row) => row.level).sort((a, b) => a - b));
    });

    it('skips an account with no character to write to: all banned, or gone', async () => {
      // The database only offers characters that are neither banned nor deleted.
      repo.recipientRows = [];
      await goLive();
      await awarder.tick();
      expect(repo.sent).toEqual([]);
      // The tick ran to its end: it did not just fail on the account with nobody to write to.
      expect(awarder.lastCheck()).not.toBeNull();
    });

    it('does not look while nobody has played, and looks again when someone has', async () => {
      await goLive();
      await awarder.tick();
      stats.rows = { ...baseRows(), characters: [character({ id: 1, level: 80 }), character({ id: 3, name: 'Moosey', userId: MOOSE, level: 20 })] };
      advance();

      repo.active = false;
      expect(await awarder.tick()).toEqual({ awarded: 0, announced: 0 });
      repo.active = true;
      expect(await awarder.tick()).toEqual({ awarded: 1, announced: 1 });
      expect(awardsOf(PLAYER)).toContain('level:4');
    });

    it('keeps announcements waiting while the control server is down, then sends them', async () => {
      control.state = 'disconnected';
      await goLive();
      expect(await awarder.tick()).toEqual({ awarded: 5, announced: 0 });
      expect(repo.rows.every((row) => row.announced === ANNOUNCE_WAITING)).toBe(true);

      control.state = 'connected';
      repo.active = false;
      expect(await awarder.tick()).toEqual({ awarded: 0, announced: 5 });
      expect(control.announcements).toHaveLength(5);
    });

    it('skips announcements that waited more than 10 minutes', async () => {
      control.state = 'disconnected';
      await goLive();
      await awarder.tick();
      control.state = 'connected';
      advance(11 * MINUTE);
      expect(await awarder.tick()).toEqual({ awarded: 0, announced: 0 });
      expect(control.announcements).toEqual([]);
      expect(repo.rows.every((row) => row.announced === ANNOUNCE_SKIPPED)).toBe(true);
    });

    it('tries again next tick after a database error', async () => {
      await goLive();
      repo.failWith = new Error('connection lost');
      expect(await awarder.tick()).toEqual({ awarded: 0, announced: 0 });
      repo.failWith = undefined;
      expect(await awarder.tick()).toEqual({ awarded: 5, announced: 5 });
    });

    it('records when it last looked', async () => {
      expect(awarder.lastCheck()).toBeNull();
      await goLive();
      await awarder.tick();
      expect(awarder.lastCheck()).toEqual(serverNow());
    });
  });

  describe('after an award', () => {
    beforeEach(async () => {
      repo.rewardRows = [{ achievementId: 'gold-held', level: 1, gold: 5, silver: 0, copper: 0, items: [] }];
      stats.rows = { ...baseRows(), characters: [character({ id: 1, level: 60, gold: 150 })] };
      await goLive();
      await awarder.tick();
    });

    it('dates the level', async () => {
      const held = await achievement('gold-held');
      expect(held.levels[0]).toMatchObject({ done: true, earnedAt: serverNow().toISOString(), reward: { gold: 5, silver: 0, copper: 0, items: [] } });
    });

    it('keeps the level when the number behind it drops again', async () => {
      stats.rows = { ...baseRows(), characters: [character({ id: 1, level: 60, gold: 0 })] };
      advance();
      const held = await achievement('gold-held');
      expect(held).toMatchObject({ value: 0, levelsDone: 1 });
      expect(held.levels[0]).toMatchObject({ done: true, holders: 1 });
    });
  });

  describe('GET /news', () => {
    it('is empty before anything is awarded', async () => {
      const news = (await player.get('/api/news').expect(200)).body as News;
      expect(news).toEqual({ serverNow: serverNow().toISOString(), items: [] });
    });

    it('lists the newest awards first and marks the viewer own', async () => {
      await goLive();
      await awarder.tick();
      const { items } = (await player.get('/api/news').expect(200)).body as News;
      expect(items).toHaveLength(5);
      expect(items[0]).toMatchObject({ text: 'Kaelith completed Adventurer III: Reach level 60', mine: true, at: serverNow().toISOString() });
      expect(items.find((item) => item.text.startsWith('Moosey'))).toMatchObject({ mine: false });
      expect(items.map((item) => item.id)).toEqual(items.map((item) => item.id).sort((a, b) => b - a));
    });

    it('shows at most 20', async () => {
      stats.rows = {
        ...baseRows(),
        characters: [character({ id: 1, level: 90, gold: 10_000 })],
        combat: [{ charId: 1, kills: 1_000_000, damageDealt: 5_000_000_000 }],
      };
      await goLive();
      await awarder.tick();
      await awarder.tick();
      expect(repo.rows).toHaveLength(21);
      expect(((await player.get('/api/news')).body as News).items).toHaveLength(20);
    });
  });

  describe('GM settings', () => {
    const gm = async () => (await moose.get('/api/gm/achievements').expect(200)).body as GmAchievements;
    const setReward = (body: object) => moose.put('/api/gm/achievements/rewards').send(body);
    const money = { gold: 0, silver: 0, copper: 0 };

    it('starts switched off, with every achievement and no rewards', async () => {
      const body = await gm();
      expect(body).toMatchObject({ live: false, control: 'connected', awards: 0, pendingAnnouncements: 0, lastCheck: null });
      const level = body.achievements.find((entry) => entry.id === 'level')!;
      expect(level.levels).toHaveLength(5);
      expect(level.levels[0]).toEqual({ level: 1, goal: 'Reach level 20', reward: null });
    });

    it('switches rewards on and off, and logs who did', async () => {
      expect((await goLive()).body.live).toBe(true);
      expect(repo.liveFlag).toBe(true);
      expect((await moose.put('/api/gm/achievements/live').send({ live: false }).expect(200)).body.live).toBe(false);
      expect(repo.liveChanges).toEqual([
        { live: true, changedBy: 'moose' },
        { live: false, changedBy: 'moose' },
      ]);
    });

    it('saves a reward with money and items, and shows it to players', async () => {
      const res = await setReward({ achievementId: 'kills', level: 2, reward: { gold: 100, silver: 0, copper: 0, items: [{ itemId, count: 5 }] } });
      expect(res.status).toBe(200);
      const expected = { gold: 100, silver: 0, copper: 0, items: [{ itemId, count: 5, name: 'Potion', icon: itemIcons[itemId] }] };
      expect((res.body as GmAchievements).achievements.find((entry) => entry.id === 'kills')!.levels[1].reward).toEqual(expected);
      expect((await achievement('kills')).levels[1].reward).toEqual(expected);
    });

    it('clears a reward saved as nothing', async () => {
      await setReward({ achievementId: 'kills', level: 2, reward: { ...money, gold: 100 } }).expect(200);
      await setReward({ achievementId: 'kills', level: 2, reward: money }).expect(200);
      expect((await achievement('kills')).levels[1].reward).toBeNull();
      expect(repo.rewardRows).toEqual([]);
    });

    it('is 404 for an achievement or level that does not exist', async () => {
      expect((await setReward({ achievementId: 'nope', level: 1, reward: money })).status).toBe(404);
      expect((await setReward({ achievementId: 'guild-member', level: 2, reward: money })).status).toBe(404);
    });

    it.each([
      ['an unknown item', { itemId: 32000, count: 1 }, 'Unknown items: 32000'],
      ['more than the item stacks to', { itemId, count: 21 }, 'Potion stacks to 20'],
    ])('refuses %s', async (_name, item, message) => {
      const res = await setReward({ achievementId: 'kills', level: 1, reward: { ...money, items: [item] } });
      expect(res.status).toBe(422);
      expect(res.body.message).toBe(message);
      expect(repo.rewardRows).toEqual([]);
    });

    it('refuses an item the game client does not have', async () => {
      const missing = [...Array(32000).keys()].find((id) => id > 0 && !Object.hasOwn(itemIcons, id))!;
      repo.items.push({ itemId: missing, name: 'Ghost', stack: 1 });
      const res = await setReward({ achievementId: 'kills', level: 1, reward: { ...money, items: [{ itemId: missing, count: 1 }] } });
      expect(res.status).toBe(422);
      expect(res.body.message).toBe(`Not in the game client: ${missing}`);
    });

    it.each([
      ['more than 3 items', { ...money, items: Array(4).fill({ itemId, count: 1 }) }],
      ['more gold than a letter carries', { ...money, gold: 10_001 }],
      ['silver past 999', { ...money, silver: 1000 }],
    ])('is 400 for %s', async (_name, reward) => {
      expect((await setReward({ achievementId: 'kills', level: 1, reward })).status).toBe(400);
    });

    it('counts awards and announcements still waiting', async () => {
      control.state = 'disconnected';
      await goLive();
      await awarder.tick();
      expect(await gm()).toMatchObject({ live: true, control: 'disconnected', awards: 5, pendingAnnouncements: 5, lastCheck: serverNow().toISOString() });
    });

    it('sends a test announcement', async () => {
      await moose.post('/api/gm/achievements/test-announcement').expect(204);
      expect(control.announcements).toEqual(['Test announcement from the portal, sent by moose']);
    });

    it('is 503 when the switch or a reward cannot be saved', async () => {
      repo.failWith = new Error('Invalid object name');
      expect((await moose.put('/api/gm/achievements/live').send({ live: true })).status).toBe(503);
      expect((await setReward({ achievementId: 'kills', level: 1, reward: { ...money, gold: 1 } })).status).toBe(503);
    });

    it('is 503 for a test announcement while the control server is down', async () => {
      control.state = 'disconnected';
      const res = await moose.post('/api/gm/achievements/test-announcement');
      expect(res.status).toBe(503);
      expect(res.body.message).toBe('The control server is not connected');
    });
  });
});
