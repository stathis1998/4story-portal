import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import type { BadgeView, HallEntry, HallOfFame, Leaderboard } from '@4story-portal/shared';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sha1Hex } from '../src/auth/sha1.js';
import { ControlTimeoutError } from '../src/control/control-client.js';
import type { ControlEvent } from '../src/control/control-protocol.js';
import type { CharacterRow, StatRows } from '../src/stats/stats-rules.js';
import { PortalStore, StoreUnavailableError } from '../src/store/portal-store.js';
import { FakeAccountsRepository, FakeControlClient, FakeStatsRepository } from './fakes.js';
import { createTestApp } from './test-app.js';

const at = (value: string) => new Date(`${value}Z`);
const MOOSE = 100;
const PLAYER = 101;
const OTHER = 50;

const character = (overrides: Partial<CharacterRow>): CharacterRow => ({
  id: 1,
  userId: PLAYER,
  name: 'Kaelith',
  classCode: 0,
  raceCode: 0,
  countryCode: 0,
  level: 50,
  exp: 150,
  levelStartExp: 100,
  levelEndExp: 200,
  gold: 12345,
  createdAt: at('2026-01-01T00:00:00'),
  banned: false,
  ...overrides,
});

const session = (charId: number, date: string) => ({
  charId,
  login: at(`${date}T10:00:00`),
  logout: at(`${date}T12:00:00`),
});

const baseRows = (): StatRows => ({
  characters: [
    character({ id: 1, name: 'Kaelith', level: 50, userId: PLAYER }),
    character({ id: 2, name: 'Alt', level: 10, userId: PLAYER }),
    character({ id: 3, name: 'Moosey', level: 93, userId: MOOSE }),
    character({ id: 4, name: 'Rival', level: 60, userId: OTHER }),
    character({ id: 5, name: 'Fourth', level: 40, userId: 51 }),
    character({ id: 6, name: 'Banned', level: 125, userId: 52, banned: true }),
  ],
  sessions: [session(1, '2026-10-30'), session(1, '2026-10-31'), session(3, '2026-10-31')],
  gear: [
    { charId: 1, slot: 0, itemId: 7625, name: 'Sword', upgrade: 24 },
    { charId: 1, slot: 3, itemId: 2, name: '_', upgrade: 0 },
    { charId: 1, slot: 5, itemId: 9, name: null, upgrade: 3 },
  ],
  companions: [{ charId: 1, slot: 0, name: 'Rex', level: 20 }],
  titles: [{ charId: 1, titleId: 1, name: 'Warlord' }],
  titlesTotal: 110,
  social: [],
  combat: [],
  accounts: [
    { userId: MOOSE, username: 'moose' },
    { userId: PLAYER, username: 'friend' },
    { userId: OTHER, username: 'rivalaccount' },
    { userId: 51, username: 'fourthaccount' },
    { userId: 52, username: 'bannedaccount' },
  ],
});

describe('player stats routes', () => {
  let app: INestApplication;
  let repo: FakeStatsRepository;
  let store: PortalStore;
  let control: FakeControlClient;
  let moose: ReturnType<typeof request.agent>;
  let player: ReturnType<typeof request.agent>;
  let empty: ReturnType<typeof request.agent>;

  beforeAll(() => Logger.overrideLogger(false));

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 10, 1, 16, 30) });
    const accounts = new FakeAccountsRepository();
    accounts.seed('moose', sha1Hex('secret1'));
    accounts.seed('friend', sha1Hex('secret1'));
    accounts.seed('newbie', sha1Hex('secret1'));
    repo = new FakeStatsRepository();
    repo.rows = baseRows();
    store = new PortalStore(':memory:');
    control = new FakeControlClient();
    app = await createTestApp({ accounts, control, stats: repo, store });
    const login = async (username: string) => {
      const agent = request.agent(app.getHttpServer());
      await agent.post('/api/auth/login').send({ username, password: 'secret1' }).expect(200);
      return agent;
    };
    moose = await login('moose');
    player = await login('friend');
    empty = await login('newbie');
  });

  afterEach(async () => {
    await app.close();
    store.close();
    vi.useRealTimers();
  });

  const advance = (ms: number) => vi.setSystemTime(Date.now() + ms);

  const routes = [
    ['get', '/api/me/overview'],
    ['get', '/api/characters/1/profile'],
    ['get', '/api/hall-of-fame'],
    ['get', '/api/leaderboard'],
    ['get', '/api/events/active'],
    ['put', '/api/gm/hall-of-fame/settings'],
  ] as const;

  it.each(routes)('%s %s is 401 when logged out', async (method, path) => {
    expect((await request(app.getHttpServer())[method](path)).status).toBe(401);
  });

  describe('GET /me/overview', () => {
    it('sums up the account', async () => {
      const res = await player.get('/api/me/overview');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        today: '2026-11-01',
        hoursPlayed: 4,
        daysPlayed: 2,
        currentStreak: 2,
        longestStreak: 2,
        activity: [
          { date: '2026-10-30', minutes: 120 },
          { date: '2026-10-31', minutes: 120 },
        ],
      });
      expect(res.body.characters).toEqual([
        { id: 1, progress: 0.5, hoursPlayed: 4 },
        { id: 2, progress: 0.5, hoursPlayed: 0 },
      ]);
    });

    it('lists every badge, marked earned or not, with its rarity', async () => {
      const { badges } = (await player.get('/api/me/overview')).body as { badges: BadgeView[] };
      const byId = new Map(badges.map((badge) => [badge.id, badge]));

      // The account with only a banned character counts in neither number.
      expect(byId.get('level-50')).toMatchObject({ name: 'Level 50', earned: true, holders: 3, players: 4 });
      expect(byId.get('level-90')).toMatchObject({ earned: false, holders: 1, players: 4 });
      expect(byId.get('upgrade-20')).toMatchObject({ earned: true, holders: 1 });
    });

    it('files each badge under a category', async () => {
      const { badges } = (await player.get('/api/me/overview')).body as { badges: BadgeView[] };
      const byId = new Map(badges.map((badge) => [badge.id, badge]));
      expect(byId.get('level-50')).toMatchObject({ category: 'progress', comingSoon: false });
      expect(byId.get('upgrade-20')).toMatchObject({ category: 'gear', comingSoon: false });
    });

    it('lists coming soon badges that nobody holds and that are never stored', async () => {
      const { badges } = (await player.get('/api/me/overview')).body as { badges: BadgeView[] };
      const deaths = badges.find((badge) => badge.id === 'deaths-1');
      expect(deaths).toMatchObject({ category: 'misfortune', comingSoon: true, earned: false, holders: 0, firstSeen: null, isNew: false, firstToEarn: false });
      const stored = store.badgeUnlocks();
      expect(stored.length).toBeGreaterThan(0);
      expect(stored.some((unlock) => unlock.badgeId === 'deaths-1')).toBe(false);
    });

    it('gives zeros to a player with no characters, with rarity still known', async () => {
      const res = await empty.get('/api/me/overview');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ hoursPlayed: 0, daysPlayed: 0, currentStreak: 0, activity: [], characters: [] });
      expect(res.body.badges.every((badge: BadgeView) => !badge.earned)).toBe(true);
      expect(res.body.badges[0].players).toBe(4);
    });

    it('is a 500 when the game database fails', async () => {
      repo.failWith = new Error('database down');
      expect((await player.get('/api/me/overview')).status).toBe(500);
    });

    it('tries the database again after a failed load', async () => {
      repo.failWith = new Error('database down');
      await player.get('/api/me/overview');
      repo.failWith = undefined;
      expect((await player.get('/api/me/overview')).status).toBe(200);
    });
  });

  describe('badge dates', () => {
    const badge = async (id: string) => {
      const { badges } = (await player.get('/api/me/overview')).body as { badges: BadgeView[] };
      return badges.find((b) => b.id === id)!;
    };

    const earnLevel90 = (id: number) => {
      repo.rows = {
        ...repo.rows,
        characters: repo.rows.characters.map((c) => (c.id === id ? { ...c, level: 90 } : c)),
      };
    };

    it('shows no date for a badge held when tracking started', async () => {
      expect(await badge('level-50')).toMatchObject({ firstSeen: null, isNew: false, firstToEarn: false });
    });

    it('dates a badge earned later, marks it new, and first to earn', async () => {
      await badge('level-50');
      advance(61_000);
      earnLevel90(1);

      // Moosey at 93 holds this from the first recording, so nobody can be sure who was first.
      expect(await badge('level-90')).toMatchObject({ firstSeen: '2026-11-01', isNew: true, firstToEarn: false });
    });

    it('is first to earn when it holds the earliest date and nobody has a blank one', async () => {
      repo.rows = { ...repo.rows, gear: [] };
      await badge('upgrade-10');
      advance(61_000);
      repo.rows = { ...repo.rows, gear: baseRows().gear };

      expect(await badge('upgrade-10')).toMatchObject({ firstSeen: '2026-11-01', isNew: true, firstToEarn: true });
    });

    it('stops being new after 7 days', async () => {
      const dated = (firstSeen: string) => [{ userId: PLAYER, badgeId: 'upgrade-10', firstSeen }];
      const unlocks = vi.spyOn(store, 'badgeUnlocks');

      unlocks.mockReturnValue(dated('2026-10-26'));
      expect(await badge('upgrade-10')).toMatchObject({ firstSeen: '2026-10-26', isNew: true, firstToEarn: true });

      advance(61_000);
      unlocks.mockReturnValue(dated('2026-10-25'));
      expect(await badge('upgrade-10')).toMatchObject({ firstSeen: '2026-10-25', isNew: false, firstToEarn: true });
    });

    it('is first to earn even if someone who held it earlier has since lost it', async () => {
      repo.rows = {
        ...repo.rows,
        characters: repo.rows.characters.map((c) => ({ ...c, gold: c.userId === PLAYER ? 1000 : 0 })),
      };
      vi.spyOn(store, 'badgeUnlocks').mockReturnValue([
        { userId: OTHER, badgeId: 'wealth-1000', firstSeen: null },
        { userId: PLAYER, badgeId: 'wealth-1000', firstSeen: '2026-10-30' },
      ]);

      expect(await badge('wealth-1000')).toMatchObject({ earned: true, holders: 1, firstToEarn: true });
    });

    it('still works with no dates when the store is broken', async () => {
      vi.spyOn(store, 'badgeUnlocks').mockReturnValue([]);
      expect(await badge('level-50')).toMatchObject({ earned: true, firstSeen: null, isNew: false, firstToEarn: false });
    });
  });

  describe('GET /characters/:id/profile', () => {
    it('returns your character', async () => {
      const res = await player.get('/api/characters/1/profile');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: 1,
        name: 'Kaelith',
        level: 50,
        className: expect.any(String),
        progress: 0.5,
        ageDays: 304,
        hoursPlayed: 4,
        daysPlayed: 2,
        longestStreak: 2,
        longestSessionMinutes: 120,
        companions: [{ slot: 0, name: 'Rex', level: 20 }],
        titles: ['Warlord'],
        titlesTotal: 110,
        ranked: true,
      });
    });

    it('lists gear by slot, naming items with no usable name', async () => {
      const { gear } = (await player.get('/api/characters/1/profile')).body;
      expect(gear.map(({ slot, slotName, name, upgrade }: Record<string, unknown>) => [slot, slotName, name, upgrade])).toEqual([
        [0, 'Main weapon', 'Sword', 24],
        [3, 'Head', 'Item #2', 0],
        [5, 'Body', 'Item #9', 3],
      ]);
    });

    it('shows your place in each category you appear in', async () => {
      const { rankings } = (await player.get('/api/characters/1/profile')).body;
      expect(rankings).toContainEqual({ category: 'level', label: 'Highest level', place: 3, display: 'Lv. 50' });
      expect(rankings).toContainEqual({ category: 'item', label: 'Best item', place: 1, display: '+24' });
      expect(rankings.map((r: { category: string }) => r.category)).not.toContain('streak-unknown');
    });

    it('leaves out a category a character has nothing in', async () => {
      const { rankings } = (await player.get('/api/characters/2/profile')).body;
      expect(rankings.map((r: { category: string }) => r.category)).not.toContain('item');
    });

    it("gives the same 404 for another player's character and one that doesn't exist", async () => {
      const others = await player.get('/api/characters/3/profile');
      const missing = await player.get('/api/characters/999/profile');
      expect(others.status).toBe(404);
      expect(missing.status).toBe(404);
      expect(others.body.message).toBe(missing.body.message);
    });

    it.each(['abc', '0', '2147483648'])('is 400 for id %s', async (id) => {
      expect((await player.get(`/api/characters/${id}/profile`)).status).toBe(400);
    });

    it('gives empty lists to a character with nothing yet', async () => {
      const { body } = await player.get('/api/characters/2/profile');
      expect(body).toMatchObject({ gear: [], companions: [], titles: [], hoursPlayed: 0, longestSessionMinutes: 0 });
    });

    it('has no progress without a level chart row', async () => {
      repo.rows = { ...repo.rows, characters: [character({ id: 1, levelEndExp: null })] };
      expect((await player.get('/api/characters/1/profile')).body.progress).toBeNull();
    });
  });

  describe('GET /hall-of-fame', () => {
    const hall = async (agent: ReturnType<typeof request.agent>) => (await agent.get('/api/hall-of-fame')).body as HallOfFame;
    const category = (body: HallOfFame, id: string) => body.categories.find((c) => c.id === id)!;

    it('lists the top three per category', async () => {
      const level = category(await hall(player), 'level');
      expect(level.label).toBe('Highest level');
      expect(level.entries.map(({ place, name, display }) => [place, name, display])).toEqual([
        [1, 'Moosey', 'Lv. 93'],
        [2, 'Rival', 'Lv. 60'],
        [3, 'Kaelith', 'Lv. 50'],
      ]);
    });

    it('has all seven categories', async () => {
      expect((await hall(player)).categories.map((c) => c.id)).toEqual(['level', 'hours', 'streak', 'item', 'titles', 'companion', 'badges']);
    });

    it('marks your best character', async () => {
      const level = category(await hall(player), 'level');
      expect(level.entries.filter((entry) => entry.mine).map((entry) => entry.name)).toEqual(['Kaelith']);
      expect(level.you).toBeNull();
    });

    it('shows your place below the list when you are not in it', async () => {
      repo.rows = {
        ...repo.rows,
        characters: [...repo.rows.characters, character({ id: 7, name: 'Top', level: 80, userId: 53 })],
      };
      const level = category(await hall(player), 'level');
      expect(level.entries).toHaveLength(3);
      expect(level.you).toEqual({ place: 4, name: 'Kaelith', display: 'Lv. 50' });
    });

    it('leaves out banned characters and zero values', async () => {
      const body = await hall(player);
      expect(JSON.stringify(body)).not.toContain('Banned');
      expect(category(body, 'item').entries.map((entry) => entry.name)).toEqual(['Kaelith']);
    });

    it('shows the item behind a best item entry', async () => {
      expect(category(await hall(player), 'item').entries[0]).toMatchObject({ display: '+24', detail: 'Sword' });
    });

    it('shares places on a tie, at most five rows', async () => {
      repo.rows = {
        ...repo.rows,
        characters: [1, 2, 3, 4, 5, 6, 7].map((id) => character({ id, name: `Same${id}`, level: 50, userId: id + 200 })),
      };
      const level = category(await hall(player), 'level');
      expect(level.entries).toHaveLength(5);
      expect(level.entries.every((entry) => entry.place === 1)).toBe(true);
    });

    it('shows most achievements under the account highest level character', async () => {
      const badges = category(await hall(player), 'badges');
      const names = badges.entries.map((entry) => entry.name);
      expect(names).toContain('Kaelith');
      expect(names).not.toContain('Alt');
    });

    it('never gives away account names or gold', async () => {
      const text = JSON.stringify(await hall(player));
      for (const account of ['friend', 'moose', 'rivalaccount', 'fourthaccount', 'bannedaccount']) expect(text).not.toContain(account);
      expect(text).not.toContain('12345');
      expect(text).not.toContain('gold');
    });

    it('only tells GMs about the switch', async () => {
      expect((await hall(player)).gm).toBeNull();
      expect((await hall(moose)).gm).toEqual({ hideGms: false });
    });

    it('includes GMs by default', async () => {
      const body = await hall(moose);
      expect(body.ranked).toBe(true);
      expect(category(body, 'level').entries[0].name).toBe('Moosey');
    });

    it('works for a player with no characters', async () => {
      const body = await hall(empty);
      expect(body.ranked).toBe(true);
      expect(category(body, 'level').you).toBeNull();
      expect(category(body, 'level').entries.some((entry) => entry.mine)).toBe(false);
    });
  });

  describe('GET /leaderboard', () => {
    const load = async (agent: ReturnType<typeof request.agent>) => (await agent.get('/api/leaderboard')).body as Leaderboard;
    const board = (body: Leaderboard, id: string) => body.categories.find((c) => c.id === id)!;
    const places = (entries: HallEntry[]) => entries.map(({ place, name, display }) => [place, name, display]);

    beforeEach(() => {
      repo.rows.combat = [
        { charId: 1, kills: 120, damageDealt: 5_000_000_000 },
        { charId: 2, kills: 300, damageDealt: 1_000 },
        { charId: 3, kills: 1, damageDealt: 1 },
        { charId: 4, kills: 120, damageDealt: 7_000 },
        { charId: 5, kills: 0, damageDealt: 0 },
        { charId: 6, kills: 999, damageDealt: 999_999 },
      ];
    });

    it('ranks damage dealt on its own, past the Hall of Fame top three', async () => {
      expect(places(board(await load(player), 'damage').entries)).toEqual([
        [1, 'Kaelith', '5,000,000,000'],
        [2, 'Rival', '7,000'],
        [3, 'Alt', '1,000'],
        [4, 'Moosey', '1'],
      ]);
    });

    it('ranks kills on its own, with ties sharing a place', async () => {
      expect(places(board(await load(player), 'kills').entries)).toEqual([
        [1, 'Alt', '300'],
        [2, 'Kaelith', '120'],
        [2, 'Rival', '120'],
        [4, 'Moosey', '1'],
      ]);
    });

    it('lists every ranked character, however many there are', async () => {
      for (let id = 10; id < 18; id++) {
        repo.rows.characters.push(character({ id, name: `Extra${id}`, userId: 51 }));
        repo.rows.combat.push({ charId: id, kills: id, damageDealt: id });
      }
      expect(board(await load(player), 'kills').entries).toHaveLength(12);
    });

    it('leaves out banned characters and those with nothing to rank', async () => {
      const text = JSON.stringify(await load(player));
      expect(text).not.toContain('Banned');
      expect(text).not.toContain('Fourth');
    });

    it('is empty until the game has recorded something', async () => {
      repo.rows.combat = [];
      const body = await load(player);
      expect(body.categories.map((c) => [c.id, c.entries])).toEqual([
        ['damage', []],
        ['kills', []],
      ]);
    });

    it('describes each entry, marking all of your characters and nobody else', async () => {
      const entries = board(await load(player), 'damage').entries;
      expect(entries[0]).toMatchObject({ name: 'Kaelith', level: 50, detail: null, mine: true });
      expect(entries.filter((entry) => entry.mine).map((entry) => entry.name)).toEqual(['Kaelith', 'Alt']);
    });

    it('never shows account names or gold', async () => {
      const text = JSON.stringify(await load(player));
      expect(text).not.toContain('rivalaccount');
      expect(text).not.toContain('12345');
    });

    it('drops GMs at once when they are hidden, and tells the GM', async () => {
      expect(JSON.stringify(await load(player))).toContain('Moosey');

      await moose.put('/api/gm/hall-of-fame/settings').send({ hideGms: true }).expect(200);

      expect(JSON.stringify(await load(player))).not.toContain('Moosey');
      const body = await load(moose);
      expect(body.ranked).toBe(false);
      expect(body.categories.every((c) => c.entries.every((entry) => !entry.mine))).toBe(true);
    });
  });

  describe('hiding GM accounts', () => {
    const hide = (agent: ReturnType<typeof request.agent>, hideGms: unknown) =>
      agent.put('/api/gm/hall-of-fame/settings').send({ hideGms });

    it('is refused for a player', async () => {
      expect((await hide(player, true)).status).toBe(403);
      expect(store.hideGms()).toBe(false);
    });

    it('is 400 for a bad body', async () => {
      expect((await hide(moose, 'yes')).status).toBe(400);
    });

    it('takes effect at once for every list and rarity count, and can be undone', async () => {
      const before = (await player.get('/api/hall-of-fame')).body as HallOfFame;
      expect(JSON.stringify(before)).toContain('Moosey');

      const res = await hide(moose, true);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ hideGms: true });

      const after = (await player.get('/api/hall-of-fame')).body as HallOfFame;
      expect(JSON.stringify(after)).not.toContain('Moosey');
      const { badges } = (await player.get('/api/me/overview')).body as { badges: BadgeView[] };
      expect(badges.find((b) => b.id === 'level-50')).toMatchObject({ holders: 2, players: 3 });

      await hide(moose, false);
      expect(JSON.stringify((await player.get('/api/hall-of-fame')).body)).toContain('Moosey');
    });

    it('records who changed it', async () => {
      await hide(moose, true);
      expect(store.settingChanges()[0]).toMatchObject({ value: 'true', changedBy: 'moose' });
    });

    it('tells a hidden GM they are not ranked, keeping their own stats', async () => {
      await hide(moose, true);

      const body = (await moose.get('/api/hall-of-fame')).body as HallOfFame;
      expect(body).toMatchObject({ ranked: false, gm: { hideGms: true } });
      expect(body.categories.every((c) => c.you === null && c.entries.every((entry) => !entry.mine))).toBe(true);

      const overview = (await moose.get('/api/me/overview')).body;
      expect(overview.hoursPlayed).toBe(2);
      expect(overview.badges.find((b: BadgeView) => b.id === 'level-90')).toMatchObject({ earned: true, holders: 0, players: 3 });

      const profile = (await moose.get('/api/characters/3/profile')).body;
      expect(profile).toMatchObject({ name: 'Moosey', ranked: false, rankings: [] });
    });

    it('says when it could not be saved, and stats keep working', async () => {
      vi.spyOn(store, 'setHideGms').mockImplementation(() => {
        throw new StoreUnavailableError();
      });

      const res = await hide(moose, true);

      expect(res.status).toBe(503);
      expect(res.body.message).toBe('Settings could not be saved');
      expect((await player.get('/api/hall-of-fame')).status).toBe(200);
    });
  });

  describe('caching', () => {
    it('reads the database once within a minute, then again', async () => {
      await player.get('/api/me/overview');
      await player.get('/api/hall-of-fame');
      expect(repo.loads).toBe(1);

      advance(61_000);
      await player.get('/api/hall-of-fame');
      expect(repo.loads).toBe(2);
    });

    it('shares one load between requests at the same time', async () => {
      await Promise.all([player.get('/api/me/overview'), player.get('/api/hall-of-fame'), moose.get('/api/hall-of-fame')]);
      expect(repo.loads).toBe(1);
    });
  });

  describe('GET /events/active', () => {
    const event = (overrides: Partial<ControlEvent> = {}): ControlEvent => ({
      index: 4,
      type: 1,
      state: 1,
      groupId: 1,
      serverType: 3,
      serverId: 0,
      start: BigInt(new Date(2026, 10, 1, 12, 0).getTime() / 1000),
      end: BigInt(new Date(2026, 10, 3, 23, 0).getTime() / 1000),
      value: 100,
      mapId: 255,
      startAlarm: 0,
      endAlarm: 1,
      startMessage: 'secret start message',
      endMessage: 'secret end message',
      title: 'Secret GM title',
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

    it('shows running percentage events, and nothing internal', async () => {
      control.events = [event()];
      const res = await player.get('/api/events/active');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        serverNow: '2026-11-01T16:30',
        events: [{ type: 1, typeName: 'EXP', bonus: 100, mapName: null, endsAt: '2026-11-03T23:00' }],
      });
    });

    it('leaves out waiting and special events', async () => {
      control.events = [event({ state: 0 }), event({ index: 5, type: 12 })];
      expect((await player.get('/api/events/active')).body.events).toEqual([]);
    });

    it('names the map of a drop event on one map', async () => {
      control.events = [event({ type: 3, mapId: 0 }), event({ index: 5, type: 11, mapId: 1234 })];
      const { events } = (await player.get('/api/events/active')).body;
      expect(events[0].mapName).toEqual(expect.any(String));
      expect(events[1].mapName).toBe('Map 1234');
    });

    it("ends a daily event at today's window", async () => {
      control.events = [
        event({
          partTime: 0,
          start: BigInt(new Date(2026, 10, 1, 12, 0).getTime() / 1000),
          end: BigInt(new Date(2026, 10, 7, 22, 0).getTime() / 1000),
        }),
      ];
      expect((await player.get('/api/events/active')).body.events[0].endsAt).toBe('2026-11-01T22:00');
    });

    it('is empty when the control server fails, and tries again after 30 seconds', async () => {
      control.failWith = new ControlTimeoutError();
      const res = await player.get('/api/events/active');
      expect(res.status).toBe(200);
      expect(res.body.events).toEqual([]);

      control.failWith = undefined;
      control.events = [event()];
      expect((await player.get('/api/events/active')).body.events).toEqual([]);

      advance(31_000);
      expect((await player.get('/api/events/active')).body.events).toHaveLength(1);
    });

    it('asks the control server once in 30 seconds, whoever asks', async () => {
      const list = vi.spyOn(control, 'listEvents');
      await Promise.all([player.get('/api/events/active'), moose.get('/api/events/active'), empty.get('/api/events/active')]);
      await player.get('/api/events/active');
      expect(list).toHaveBeenCalledTimes(1);
    });
  });
});
