import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import type { CharacterInspect, CharacterSearchResult, HallOfFame, Leaderboard } from '@4story-portal/shared';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sha1Hex } from '../src/auth/sha1.js';
import type { CharacterRow, StatRows } from '../src/stats/stats-rules.js';
import { type RawGearRow, toGearRow } from '../src/stats/stats.repository.js';
import { PortalStore } from '../src/store/portal-store.js';
import { FakeAccountsRepository, FakeControlClient, FakeStatsRepository } from './fakes.js';
import { gearDefaults } from './fixtures.js';
import { createTestApp } from './test-app.js';

const MOOSE = 100;
const PLAYER = 101;
const RIVAL = 50;
const BANNED = 52;

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
  createdAt: new Date('2026-01-01T00:00:00Z'),
  banned: false,
  ...overrides,
});

const rows = (): StatRows => ({
  characters: [
    character({ id: 1, name: 'Kaelith', userId: PLAYER }),
    character({ id: 2, name: 'Rival', level: 60, userId: RIVAL }),
    character({ id: 3, name: 'Moosey', level: 93, userId: MOOSE }),
    character({ id: 4, name: 'Outcast', userId: BANNED, banned: true }),
    character({ id: 5, name: 'MyBannedAlt', userId: PLAYER, banned: true }),
    character({ id: 6, name: 'rival', level: 12, userId: RIVAL }),
    character({ id: 7, name: 'Rivalry', level: 20, userId: RIVAL }),
  ],
  sessions: [],
  gear: [
    { ...gearDefaults, charId: 2, slot: 4, itemId: 1602, name: "Warlord's Cloak", upgrade: 24, gem: 5 },
    { ...gearDefaults, charId: 2, slot: 0, itemId: 1, name: 'Unknown thing', upgrade: 0 },
  ],
  companions: [{ charId: 2, slot: 0, name: 'Rex', level: 20 }],
  titles: [{ charId: 2, titleId: 1, name: 'Warlord' }],
  titlesTotal: 110,
  social: [],
  combat: [],
  spending: [],
  soulLottery: [],
  optionRules: [],
  accounts: [
    { userId: MOOSE, username: 'moose' },
    { userId: PLAYER, username: 'friend' },
    { userId: RIVAL, username: 'rivalaccount' },
    { userId: BANNED, username: 'bannedaccount' },
  ],
});

describe('inspecting characters', () => {
  let app: INestApplication;
  let store: PortalStore;
  let repo: FakeStatsRepository;
  let player: ReturnType<typeof request.agent>;

  beforeAll(() => Logger.overrideLogger(false));

  beforeEach(async () => {
    const accounts = new FakeAccountsRepository();
    accounts.seed('moose', sha1Hex('secret1'));
    accounts.seed('friend', sha1Hex('secret1'));
    repo = new FakeStatsRepository();
    repo.rows = rows();
    store = new PortalStore(':memory:');
    app = await createTestApp({ accounts, control: new FakeControlClient(), stats: repo, store });
    player = request.agent(app.getHttpServer());
    await player.post('/api/auth/login').send({ username: 'friend', password: 'secret1' }).expect(200);
  });

  afterEach(async () => {
    await app.close();
    store.close();
  });

  describe('GET /characters/:id/inspect', () => {
    it('shows another player only their public details', async () => {
      const { body } = await player.get('/api/characters/2/inspect').expect(200);
      expect(Object.keys(body).sort()).toEqual(['className', 'country', 'gear', 'id', 'level', 'name', 'race']);
      expect(body).toMatchObject({ id: 2, name: 'Rival', level: 60 });
    });

    it('builds the in-game tooltip for each item, sorted by slot', async () => {
      const { gear } = (await player.get('/api/characters/2/inspect')).body as CharacterInspect;
      expect(gear.map(({ slot }) => slot)).toEqual([0, 4]);
      expect(gear[1].tooltip.title.text).toBe("Warlord's Cloak (+24)");
      expect(gear[1].tooltip.quality).toBe('grade');
      expect(gear[1].tooltip.lines.map(({ text }) => text)).toContain('Type : Cloak');
    });

    it('needs a login', async () => {
      await request(app.getHttpServer()).get('/api/characters/2/inspect').expect(401);
    });

    it.each([
      ['a banned character', 4],
      ['a character that does not exist', 999],
    ])('answers not found for %s', async (_name, id) => {
      const { body } = await player.get(`/api/characters/${id}/inspect`).expect(404);
      expect(body.message).toBe('Character not found');
    });

    it('lets you open your own banned character', async () => {
      await player.get('/api/characters/5/inspect').expect(200);
    });

    it('hides a GM while GMs are hidden, and shows them when not', async () => {
      store.setHideGms(true, 'test');
      await player.get('/api/characters/3/inspect').expect(404);
      store.setHideGms(false, 'test');
      await player.get('/api/characters/3/inspect').expect(200);
    });

    it('rejects a malformed ID', async () => {
      await player.get('/api/characters/abc/inspect').expect(400);
    });
  });

  it('still keeps the full profile to its owner', async () => {
    await player.get('/api/characters/2/profile').expect(404);
    const { body } = await player.get('/api/characters/1/profile').expect(200);
    expect(body).toHaveProperty('hoursPlayed');
  });

  describe('GET /characters/search', () => {
    const search = async (q: string) => (await player.get('/api/characters/search').query({ q }).expect(200)).body as CharacterSearchResult[];

    it('matches any part of a name, ignoring case', async () => {
      expect((await search('AELI')).map(({ name }) => name)).toEqual(['Kaelith']);
    });

    it('returns only the public summary', async () => {
      expect(await search('Kaelith')).toEqual([{ id: 1, name: 'Kaelith', level: 50, className: expect.any(String) }]);
    });

    it('puts exact matches first, then sorts by name', async () => {
      const names = (await search('rival')).map(({ name }) => name);
      expect(names.slice(2)).toEqual(['Rivalry']);
      expect(new Set(names.slice(0, 2))).toEqual(new Set(['Rival', 'rival']));
    });

    it('leaves out banned characters', async () => {
      expect(await search('Outcast')).toEqual([]);
    });

    it('leaves out hidden GMs', async () => {
      store.setHideGms(true, 'test');
      expect(await search('Moosey')).toEqual([]);
    });

    it('stops at 20 results', async () => {
      repo.rows = {
        ...rows(),
        characters: Array.from({ length: 30 }, (_, i) => character({ id: 100 + i, name: `Clone${i}`, userId: RIVAL })),
      };
      expect(await search('Clone')).toHaveLength(20);
    });

    it('trims the search', async () => {
      expect((await search('  Kaelith  ')).map(({ id }) => id)).toEqual([1]);
    });

    it.each(['a', ' a ', 'x'.repeat(17), ''])('rejects the search %j', async (q) => {
      await player.get('/api/characters/search').query({ q }).expect(400);
    });

    it('needs a login', async () => {
      await request(app.getHttpServer()).get('/api/characters/search').query({ q: 'Rival' }).expect(401);
    });
  });

  it('gives every ranking entry its character ID', async () => {
    const hall = (await player.get('/api/hall-of-fame')).body as HallOfFame;
    const level = hall.categories.find(({ id }) => id === 'level')!;
    expect(level.entries[0]).toMatchObject({ name: 'Moosey', characterId: 3 });

    const board = (await player.get('/api/leaderboard')).body as Leaderboard;
    expect(board.categories[0].entries.every(({ characterId }) => characterId > 0)).toBe(true);
  });
});

describe('toGearRow', () => {
  const raw = (over: Partial<RawGearRow> = {}): RawGearRow => ({
    charId: 1,
    slot: 0,
    itemId: 5,
    name: 'Thing',
    upgrade: 3,
    gem: 1,
    gLevel: 0,
    duraMax: 10,
    duraCur: 9,
    refine: 2,
    endsAt: new Date('1900-01-01T00:00:00Z'),
    gradeEffect: 4,
    moggItemId: 0,
    magic1: 0,
    magic2: 0,
    magic3: 0,
    magic4: 0,
    magic5: 0,
    magic6: 0,
    value1: 0,
    value2: 0,
    value3: 0,
    value4: 0,
    value5: 0,
    value6: 0,
    eld: 2,
    wrap: 1,
    customTex: 7,
    revision: 1.5,
    magicRevision: 2,
    ...over,
  });

  it('treats the 1900 date as no expiry', () => {
    expect(toGearRow(raw()).endsAt).toBeNull();
    const end = new Date('2026-12-01T00:00:00Z');
    expect(toGearRow(raw({ endsAt: end })).endsAt).toEqual(end);
    expect(toGearRow(raw({ endsAt: null })).endsAt).toBeNull();
  });

  it('collects the filled option columns', () => {
    expect(toGearRow(raw({ magic1: 12, value1: 55, magic3: 87, value3: 9 })).options).toEqual([
      { id: 12, value: 55 },
      { id: 87, value: 9 },
    ]);
  });

  it('reads signed smallint columns as the unsigned values the game uses', () => {
    const row = toGearRow(raw({ magic1: 1, value1: -1, moggItemId: -2 }));
    expect(row.options[0].value).toBe(65535);
    expect(row.moggItemId).toBe(65534);
  });

  it('marks a sealed item and keeps the revisions', () => {
    const row = toGearRow(raw({ gLevel: 5 }));
    expect(row.sealed).toBe(true);
    expect(row.revision).toEqual([1.5, 2]);
  });

  it('copies the extended values', () => {
    expect(toGearRow(raw())).toMatchObject({ eld: 2, wrap: 1, customTex: 7, gradeEffect: 4, refine: 2 });
  });
});
