import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import type { WeaponEffectsData, WeaponSearchResult } from '@4story-portal/shared';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sha1Hex } from '../src/auth/sha1.js';
import { type ClientFiles, MemoryModelCache, WeaponsUnavailableError } from '../src/weapons/weapon-catalog.js';
import { FakeAccountsRepository } from './fakes.js';
import { pngOf } from './client-fixtures.js';
import { createTestApp } from './test-app.js';

// Reads any response as raw bytes; supertest only buffers types it knows.
const bytes = (res: request.Response, done: (error: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

const layer = { texture: 1089473, op: 6 as const, keys: [], loopMs: 25000, swatch: '#a65f3a' };

const fakeFiles = (builds: number[]): ClientFiles => ({
  weapons: [
    { itemId: 7625, name: 'Sword of Dawn', kind: 1, level: 85, visualId: 4 },
    { itemId: 701, name: 'Small bow', kind: 6, level: 1, visualId: 5 },
    { itemId: 702, name: 'Dawn Bow', kind: 6, level: 60, visualId: 6 },
    { itemId: 1201, name: 'Dokgo-Vajra', kind: 10, level: 1, visualId: 7 },
  ],
  visuals: new Map([
    [4, { objectId: 2, clothKind: 10, cloth: 20, mesh: 30 }],
    [5, { objectId: 0, clothKind: 21890, cloth: 21924, mesh: 22425 }],
    [6, { objectId: 0, clothKind: 21890, cloth: 21925, mesh: 22430 }],
    [7, { objectId: 0, clothKind: 0, cloth: 0, mesh: 0 }],
  ]),
  layers: { '1:5': layer },
  pngs: new Map([[1089473, pngOf(255)]]),
  buildModel: (item) => {
    builds.push(item.itemId);
    return Buffer.from(`glTF-${item.itemId}`);
  },
});

describe('weapon effect routes', () => {
  let app: INestApplication;
  let player: ReturnType<typeof request.agent>;
  let builds: number[];
  let source: () => ClientFiles;

  beforeAll(() => Logger.overrideLogger(false));

  beforeEach(async () => {
    builds = [];
    source = () => fakeFiles(builds);
    const accounts = new FakeAccountsRepository();
    accounts.seed('friend', sha1Hex('secret1'));
    app = await createTestApp({ accounts, weapons: { source: () => source(), cache: new MemoryModelCache() } });
    player = request.agent(app.getHttpServer());
    await player.post('/api/auth/login').send({ username: 'friend', password: 'secret1' }).expect(200);
  });

  afterEach(() => app.close());

  it.each(['/api/weapon-effects', '/api/weapon-effects/weapons?q=bow', '/api/weapon-effects/textures/1089473.png', '/api/weapon-models/7625.glb'])(
    '%s is 401 when logged out',
    async (path) => {
      expect((await request(app.getHttpServer()).get(path)).status).toBe(401);
    },
  );

  it('sends the effect layers', async () => {
    const body = (await player.get('/api/weapon-effects').expect(200)).body as WeaponEffectsData;
    expect(body.layers['1:5']).toEqual(layer);
  });

  it('finds weapons by name, lowest level first, leaving out weapons with no model', async () => {
    const found = (await player.get('/api/weapon-effects/weapons?q=DAWN').expect(200)).body as WeaponSearchResult[];
    expect(found.map((weapon) => [weapon.itemId, weapon.name, weapon.kind, weapon.level])).toEqual([
      [702, 'Dawn Bow', 6, 60],
      [7625, 'Sword of Dawn', 1, 85],
    ]);
    expect((await player.get('/api/weapon-effects/weapons?q=vajra').expect(200)).body).toEqual([]);
  });

  it('lists a kind without a search text', async () => {
    const found = (await player.get('/api/weapon-effects/weapons?kind=6').expect(200)).body as WeaponSearchResult[];
    expect(found.map((weapon) => weapon.itemId)).toEqual([701, 702]);
    expect((await player.get('/api/weapon-effects/weapons').expect(200)).body).toEqual([]);
  });

  it('is 400 for a bad kind', async () => {
    expect((await player.get('/api/weapon-effects/weapons?kind=13')).status).toBe(400);
  });

  it('sends a texture as PNG, and 404 for one it does not have', async () => {
    const res = await player.get('/api/weapon-effects/textures/1089473.png').expect(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toBe('private, max-age=86400');
    expect((await player.get('/api/weapon-effects/textures/5.png')).status).toBe(404);
    expect((await player.get('/api/weapon-effects/textures/abc.png')).status).toBe(404);
  });

  it('builds a weapon model once and then serves it from the cache', async () => {
    const first = await player.get('/api/weapon-models/7625.glb').buffer(true).parse(bytes).expect(200);
    expect(first.headers['content-type']).toBe('model/gltf-binary');
    expect(Buffer.from(first.body).toString()).toBe('glTF-7625');
    await player.get('/api/weapon-models/7625.glb').expect(200);
    expect(builds).toEqual([7625]);
  });

  it('shows the skin model when the skin is a weapon too', async () => {
    const res = await player.get('/api/weapon-models/7625.glb?skin=702').buffer(true).parse(bytes).expect(200);
    expect(Buffer.from(res.body).toString()).toBe('glTF-702');
    const unknownSkin = await player.get('/api/weapon-models/7625.glb?skin=9999').buffer(true).parse(bytes).expect(200);
    expect(Buffer.from(unknownSkin.body).toString()).toBe('glTF-7625');
  });

  it('is 404 for anything that is not a weapon with a model', async () => {
    for (const path of ['/api/weapon-models/9999.glb', '/api/weapon-models/1201.glb', '/api/weapon-models/x.glb']) {
      expect((await player.get(path)).status).toBe(404);
    }
  });

  it('is 503 on every route when the game client files are not there', async () => {
    source = () => {
      throw new WeaponsUnavailableError('no client');
    };
    for (const path of ['/api/weapon-effects', '/api/weapon-effects/weapons?q=bow', '/api/weapon-effects/textures/1.png', '/api/weapon-models/7625.glb']) {
      const res = await player.get(path);
      expect(res.status).toBe(503);
      expect(res.body.message).toBe('Weapon previews are not available');
    }
  });
});
