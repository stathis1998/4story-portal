import type { GmDestination } from '@4story-portal/shared';

// Reads the game client's chart files (see CTChart::InitTREGIONINFO and InitTPORTAL in the game's
// TChart.cpp) and decides which names and destinations the GM tools offer. The database has no
// names, so these files are the only source. No I/O here: import-game-places.ts does that.

export type Region = { id: number; mapId: number; name: string };
export type Portal = { id: number; name: string; mapId: number; x: number; z: number };
export type PortalSpawn = { portalId: number; mapId: number; x: number; y: number; z: number };
export type GamePlaces = { mapNames: Record<number, string>; destinations: GmDestination[] };

const OVERWORLD_MAP = 0;
// A portal and its database spawn further apart than this are not the same place.
const MAX_SPAWN_DISTANCE = 100;

class ArchiveReader {
  private offset = 0;

  constructor(private readonly buffer: Buffer) {}

  u8(): number {
    return this.advance(1, this.buffer.readUInt8(this.offset));
  }

  u16(): number {
    return this.advance(2, this.buffer.readUInt16LE(this.offset));
  }

  u32(): number {
    return this.advance(4, this.buffer.readUInt32LE(this.offset));
  }

  f32(): number {
    return this.advance(4, this.buffer.readFloatLE(this.offset));
  }

  skip(bytes: number): void {
    if (this.offset + bytes > this.buffer.length) throw new RangeError('Chart file ends too early');
    this.offset += bytes;
  }

  /** CArchive CString: a 1-byte length, where 0xFF escapes to 2 bytes and 0xFFFF to 4. */
  string(): string {
    let length = this.u8();
    if (length === 0xff) {
      length = this.u16();
      if (length === 0xffff) length = this.u32();
    }
    const start = this.offset;
    this.skip(length);
    return this.buffer.toString('latin1', start, start + length);
  }

  // The files carry no version, so leftover bytes are the only sign the format changed.
  assertFinished(): void {
    const left = this.buffer.length - this.offset;
    if (left !== 0) throw new Error(`Chart file has ${left} bytes left over: unexpected format`);
  }

  private advance<T>(bytes: number, value: T): T {
    this.offset += bytes;
    return value;
  }
}

export function parseRegions(file: Buffer): Region[] {
  const reader = new ArchiveReader(file);
  const regions: Region[] = [];
  for (let count = reader.u16(); count > 0; count--) {
    const id = reader.u32();
    const name = reader.string();
    reader.skip(1 + 1 + 2); // country, canFly, localId
    reader.skip(9 * 4); // three thumbnail positions
    reader.skip(1 + 4 + 4 + 4 + 1 + 1); // canMail, sound, bgm, env, info, weather
    // The id is MAKELONG(MAKEWORD(region, unit), map): see FindTREGIONINFO in the game's TClientMAP.cpp.
    regions.push({ id, mapId: id >>> 16, name });
  }
  reader.assertFinished();
  return regions;
}

export function parsePortals(file: Buffer): Portal[] {
  const reader = new ArchiveReader(file);
  const portals: Portal[] = [];
  for (let count = reader.u16(); count > 0; count--) {
    const id = reader.u16();
    const name = reader.string();
    reader.skip(2); // portal region
    const mapId = reader.u16();
    const x = reader.f32();
    const z = reader.f32();
    reader.skip(2);
    portals.push({ id, name, mapId, x, z });
  }
  reader.assertFinished();
  return portals;
}

/** hostedCells holds `${mapId}:${unitId}` for every cell a server hosts. */
export function buildGamePlaces(
  regions: Region[],
  portals: Portal[],
  spawns: PortalSpawn[],
  hostedCells: ReadonlySet<string>,
): GamePlaces {
  return { mapNames: nameMaps(regions), destinations: buildDestinations(portals, spawns, hostedCells) };
}

function nameMaps(regions: Region[]): Record<number, string> {
  const byMap = new Map<number, Map<string, { count: number; lowestId: number }>>();
  for (const { id, mapId, name } of regions) {
    if (!name.trim()) continue;
    const names = byMap.get(mapId) ?? new Map<string, { count: number; lowestId: number }>();
    byMap.set(mapId, names);
    const seen = names.get(name);
    names.set(name, { count: (seen?.count ?? 0) + 1, lowestId: Math.min(seen?.lowestId ?? id, id) });
  }

  const mapNames: Record<number, string> = {};
  for (const [mapId, names] of byMap) {
    const [best] = [...names].sort(([, a], [, b]) => b.count - a.count || a.lowestId - b.lowestId);
    // The overworld is one map holding hundreds of regions, and no region names all of it.
    mapNames[mapId] = mapId === OVERWORLD_MAP ? 'Overworld' : best[0];
  }
  return mapNames;
}

function buildDestinations(
  portals: Portal[],
  spawns: PortalSpawn[],
  hostedCells: ReadonlySet<string>,
): GmDestination[] {
  const spawnByPortal = new Map(spawns.map((spawn) => [spawn.portalId, spawn]));
  const unique = new Map<string, GmDestination>();

  for (const portal of [...portals].sort((a, b) => a.id - b.id)) {
    const spawn = spawnByPortal.get(portal.id);
    if (!spawn || !portal.name.trim() || spawn.mapId !== portal.mapId) continue;
    if (Math.hypot(portal.x - spawn.x, portal.z - spawn.z) >= MAX_SPAWN_DISTANCE) continue;
    const unit = Math.floor(spawn.z / 1024) * 256 + Math.floor(spawn.x / 1024);
    if (!hostedCells.has(`${spawn.mapId}:${unit}`)) continue;

    const key = `${spawn.mapId}|${portal.name}`;
    if (!unique.has(key)) {
      unique.set(key, {
        name: portal.name,
        mapId: spawn.mapId,
        x: round(spawn.x),
        y: round(spawn.y),
        z: round(spawn.z),
      });
    }
  }

  return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name) || a.mapId - b.mapId);
}

const round = (value: number) => Math.round(value * 100) / 100;

export function renderGeneratedFile({ mapNames, destinations }: GamePlaces): string {
  const maps = Object.entries(mapNames)
    .map(([id, name]) => `  ${id}: ${JSON.stringify(name)},`)
    .join('\n');
  const places = destinations.map((destination) => `  ${JSON.stringify(destination)},`).join('\n');
  return `// Generated by src/gm/import-game-places.ts. Do not edit: rerun the import (see the README).
import type { GmDestination } from '@4story-portal/shared';

export const MAP_NAMES: Readonly<Record<number, string>> = {
${maps}
};

export const DESTINATIONS: readonly GmDestination[] = [
${places}
];
`;
}
