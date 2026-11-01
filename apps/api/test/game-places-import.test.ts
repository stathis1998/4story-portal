import { describe, expect, it } from 'vitest';
import {
  buildGamePlaces,
  type Portal,
  type PortalSpawn,
  parsePortals,
  parseRegions,
  type Region,
  renderGeneratedFile,
} from '../src/gm/game-places-import.js';
import { ArchiveWriter } from './archive-writer.js';

function writeRegion(w: ArchiveWriter, id: number, name: string) {
  w.u32(id).str(name).u8(0).u8(1).u16(0);
  for (let i = 0; i < 9; i++) w.f32(1.5);
  w.u8(1).u32(0).u32(0).u32(0).u8(0).u8(0);
}

function writePortal(w: ArchiveWriter, id: number, name: string, mapId: number, x: number, z: number) {
  w.u16(id).str(name).u16(7).u16(mapId).f32(x).f32(z).u8(0).u8(0);
}

describe('parseRegions', () => {
  it('reads each region and takes the map from the high word of its id', () => {
    const w = new ArchiveWriter().u16(2);
    writeRegion(w, (13 << 16) | 0x0102, 'Keter Underground');
    writeRegion(w, 5, 'Tarat');

    expect(parseRegions(w.toBuffer())).toEqual([
      { id: (13 << 16) | 0x0102, mapId: 13, name: 'Keter Underground' },
      { id: 5, mapId: 0, name: 'Tarat' },
    ]);
  });

  it('reads a map id above 32767 as unsigned', () => {
    const w = new ArchiveWriter().u16(1);
    writeRegion(w, 0xfde8_0000, 'High');

    expect(parseRegions(w.toBuffer())[0].mapId).toBe(0xfde8);
  });

  it('reads a name longer than 254 bytes through the CString length escape', () => {
    const long = 'x'.repeat(300);
    const w = new ArchiveWriter().u16(1);
    writeRegion(w, 1, long);

    expect(parseRegions(w.toBuffer())[0].name).toBe(long);
  });

  it('rejects a file with bytes left over, because the format has changed', () => {
    const w = new ArchiveWriter().u16(1);
    writeRegion(w, 1, 'Tarat');
    w.u8(0);

    expect(() => parseRegions(w.toBuffer())).toThrow(/bytes/);
  });

  it('rejects a truncated file', () => {
    const w = new ArchiveWriter().u16(2);
    writeRegion(w, 1, 'Tarat');

    expect(() => parseRegions(w.toBuffer())).toThrow(RangeError);
  });
});

describe('parsePortals', () => {
  it('reads name, map and position', () => {
    const w = new ArchiveWriter().u16(1);
    writePortal(w, 1001, 'Lonbaley Training Camp', 0, 2850.5, 5004.5);

    expect(parsePortals(w.toBuffer())).toEqual([
      { id: 1001, name: 'Lonbaley Training Camp', mapId: 0, x: 2850.5, z: 5004.5 },
    ]);
  });
});

describe('buildGamePlaces', () => {
  const region = (id: number, mapId: number, name: string): Region => ({ id, mapId, name });
  const portal = (over: Partial<Portal> = {}): Portal => ({ id: 1, name: 'Camp', mapId: 13, x: 100, z: 200, ...over });
  const spawn = (over: Partial<PortalSpawn> = {}): PortalSpawn => ({
    portalId: 1,
    mapId: 13,
    x: 100,
    y: 50,
    z: 200,
    ...over,
  });
  const hosted = new Set(['13:0', '0:0']);

  describe('map names', () => {
    it('uses the most frequent region name of a map', () => {
      const { mapNames } = buildGamePlaces(
        [region(1, 13, 'Side'), region(2, 13, 'Main'), region(3, 13, 'Main')],
        [],
        [],
        hosted,
      );
      expect(mapNames).toEqual({ 13: 'Main' });
    });

    it('breaks a tie by the lowest region id', () => {
      const { mapNames } = buildGamePlaces([region(9, 13, 'Later'), region(2, 13, 'Earlier')], [], [], hosted);
      expect(mapNames[13]).toBe('Earlier');
    });

    it('labels map 0 Overworld, because its 300 regions name no single place', () => {
      const { mapNames } = buildGamePlaces([region(1, 0, 'Tarat')], [], [], hosted);
      expect(mapNames[0]).toBe('Overworld');
    });

    it('ignores blank region names', () => {
      const { mapNames } = buildGamePlaces([region(1, 13, '  ')], [], [], hosted);
      expect(mapNames).toEqual({});
    });
  });

  describe('destinations', () => {
    it('takes the height from the database and rounds to 2 decimals', () => {
      const { destinations } = buildGamePlaces([], [portal()], [spawn({ x: 100.126, y: 68.360001, z: 200 })], hosted);
      expect(destinations).toEqual([{ name: 'Camp', mapId: 13, x: 100.13, y: 68.36, z: 200 }]);
    });

    it('drops a portal with no database spawn', () => {
      expect(buildGamePlaces([], [portal()], [], hosted).destinations).toEqual([]);
    });

    it('drops a portal whose database spawn is on another map', () => {
      expect(buildGamePlaces([], [portal()], [spawn({ mapId: 14 })], hosted).destinations).toEqual([]);
    });

    it('drops a portal 100 units or more from its database spawn', () => {
      expect(buildGamePlaces([], [portal()], [spawn({ x: 200 })], hosted).destinations).toEqual([]);
      expect(buildGamePlaces([], [portal()], [spawn({ x: 199 })], hosted).destinations).toHaveLength(1);
    });

    it('drops a destination on a cell no server hosts', () => {
      const far = spawn({ x: 2000 });
      expect(buildGamePlaces([], [portal({ x: 2000 })], [far], hosted).destinations).toEqual([]);
    });

    it('checks the cell using both axes', () => {
      const cells = new Set([`13:${1 * 256 + 2}`]);
      const place = { x: 2048, z: 1024 };
      expect(buildGamePlaces([], [portal(place)], [spawn(place)], cells).destinations).toHaveLength(1);
    });

    it('drops a blank name', () => {
      expect(buildGamePlaces([], [portal({ name: ' ' })], [spawn()], hosted).destinations).toEqual([]);
    });

    it('merges the same name on the same map, keeping the lowest portal id', () => {
      const { destinations } = buildGamePlaces(
        [],
        [portal({ id: 5 }), portal({ id: 2 })],
        [spawn({ portalId: 5, y: 1 }), spawn({ portalId: 2, y: 2 })],
        hosted,
      );
      expect(destinations).toEqual([expect.objectContaining({ name: 'Camp', y: 2 })]);
    });

    it('keeps the same name on different maps, sorted by name then map', () => {
      const { destinations } = buildGamePlaces(
        [],
        [portal({ id: 1, mapId: 13 }), portal({ id: 2, mapId: 0 }), portal({ id: 3, name: 'Arena', mapId: 13 })],
        [spawn({ portalId: 1 }), spawn({ portalId: 2, mapId: 0 }), spawn({ portalId: 3 })],
        hosted,
      );
      expect(destinations.map((d) => [d.name, d.mapId])).toEqual([
        ['Arena', 13],
        ['Camp', 0],
        ['Camp', 13],
      ]);
    });
  });
});

describe('renderGeneratedFile', () => {
  it('writes TypeScript exports, escaping quotes in names', () => {
    const output = renderGeneratedFile({
      mapNames: { 13: "King's Grave" },
      destinations: [{ name: "King's Grave", mapId: 13, x: 1, y: 2, z: 3 }],
    });

    expect(output).toContain('export const MAP_NAMES');
    expect(output).toContain('export const DESTINATIONS');
    expect(output).toContain('Generated by');
    expect(output).toContain(JSON.stringify("King's Grave"));
  });
});
