import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GmLocationInput } from '@4story-portal/shared';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { GmLocationsStore, InvalidPresetFileError } from '../src/gm/gm-locations.store.js';

const town: GmLocationInput = { name: 'Town', world: 1, channel: 1, mapId: 1, x: 10, y: 0, z: 20 };
const cave: GmLocationInput = { name: 'Cave', world: 1, channel: 1, mapId: 2, x: 5, y: 1, z: 6 };

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gm-locations-'));
  file = join(dir, 'nested', 'locations.json');
});
afterEach(() => rm(dir, { recursive: true, force: true }));

it('reads a missing file as an empty list', async () => {
  expect(await new GmLocationsStore(file).list()).toEqual([]);
});

it('persists an added preset with a UUID id across store instances', async () => {
  const added = await new GmLocationsStore(file).add(town);
  expect(added).toEqual({ ...town, id: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  expect(await new GmLocationsStore(file).list()).toEqual([added]);
});

it('keeps both presets when two adds run concurrently', async () => {
  const store = new GmLocationsStore(file);
  await Promise.all([store.add(town), store.add(cave)]);
  const names = (await store.list()).map((l) => l.name).sort();
  expect(names).toEqual(['Cave', 'Town']);
});

it('removes a known id and reports unknown ids', async () => {
  const store = new GmLocationsStore(file);
  const added = await store.add(town);
  expect(await store.remove('nope')).toBe(false);
  expect(await store.remove(added.id)).toBe(true);
  expect(await store.list()).toEqual([]);
});

it('rejects an invalid file and leaves it untouched', async () => {
  const bad = join(dir, 'bad.json');
  await writeFile(bad, '{');
  const store = new GmLocationsStore(bad);
  await expect(store.list()).rejects.toBeInstanceOf(InvalidPresetFileError);
  await expect(store.add(town)).rejects.toBeInstanceOf(InvalidPresetFileError);
  await expect(store.remove('x')).rejects.toBeInstanceOf(InvalidPresetFileError);
  expect(await readFile(bad, 'utf8')).toBe('{');
  // a failed operation does not break the chain
  await writeFile(bad, '[]');
  await expect(store.add(cave)).resolves.toMatchObject({ name: 'Cave' });
});
