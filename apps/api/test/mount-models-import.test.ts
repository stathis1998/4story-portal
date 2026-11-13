import { deflateSync } from 'node:zlib';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import {
  buildGlb,
  buildMountModel,
  extractTexture,
  parseCompanionRunes,
  parseMesh,
  parseMonsters,
  parseMountChart,
  parseObjectClothing,
  parseResourceIndex,
  parseVisualMeshes,
  type GameMesh,
  type ModelSources,
} from '../src/gm/mount-models-import.js';
import { ITEM_LAYOUT, ITEM_VISUAL_LAYOUT } from '../src/gm/game-icons-import.js';
import { ArchiveWriter } from './archive-writer.js';
import { ddsFile, meshFile, objectFile, pngOf, readGlb, textureBlock, zeros } from './client-fixtures.js';

describe('parseVisualMeshes', () => {
  const visualChart = (rows: number[][]) => {
    const w = new ArchiveWriter().u16(rows.length);
    for (const values of rows) {
      [...ITEM_VISUAL_LAYOUT].forEach((kind, i) => {
        const value = values[i] ?? 0;
        if (kind === 'b') w.u8(value);
        else if (kind === 'w') w.u16(value);
        else if (kind === 'f') w.f32(value);
        else w.u32(value);
      });
    }
    return w.toBuffer();
  };

  it('reads the object, clothing kind, cloth and normal mesh', () => {
    expect(parseVisualMeshes(visualChart([[6000, 0, 0, 21888, 21922, 23264, 22083]])).get(6000)).toEqual({
      objectId: 0,
      clothKind: 21888,
      cloth: 21922,
      mesh: 23264,
    });
  });

  it('uses the battle mesh when there is no normal one, as for bows drawn only in battle', () => {
    expect(parseVisualMeshes(visualChart([[8000, 0, 0, 21890, 21924, 0, 22425]])).get(8000)?.mesh).toBe(22425);
  });
});

const triangle = (): GameMesh => ({
  positions: Float32Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9),
  normals: Float32Array.of(0, 0, 1, 0, 0, 1, 0, 0, 1),
  uvs: Float32Array.of(0, 0, 1, 0, 1, 1),
  slots: [[0, 1, 2]],
});

describe('parseMountChart', () => {
  it('reads each mount and adds the ones the client adds in code', () => {
    const file = new ArchiveWriter().u16(1).u16(7).u16(31001).u16(31002).u16(99).toBuffer();

    const pets = parseMountChart(file);

    expect(pets[0]).toEqual({ petId: 7, monsterId: 31001 });
    expect(pets).toContainEqual({ petId: 50, monsterId: 31250 });
    expect(pets).toContainEqual({ petId: 45, monsterId: 31168 });
    expect(pets).toHaveLength(11);
  });
});

describe('parseCompanionRunes', () => {
  const itemChart = (rows: Record<number, number>[]) => {
    const w = new ArchiveWriter().u16(rows.length);
    for (const set of rows) {
      [...ITEM_LAYOUT].forEach((kind, i) => {
        const value = set[i] ?? 0;
        if (kind === 'b') w.u8(value);
        else if (kind === 'w') w.u16(value);
        else if (kind === 'd') w.u32(value);
        else if (kind === 'f') w.f32(value);
        else w.str('Rune');
      });
    }
    return w.toBuffer();
  };

  it('reads the pet each companion rune summons, skipping other items and runes with no fixed pet', () => {
    const file = itemChart([
      { 0: 19019, 1: 22, 12: 31125 },
      { 0: 7000, 1: 12, 12: 31125 },
      { 0: 17013, 1: 22, 12: 0 },
      { 0: 19047, 1: 22, 12: 31141 },
    ]);

    expect(parseCompanionRunes(file)).toEqual([
      { itemId: 19019, monsterId: 31125 },
      { itemId: 19047, monsterId: 31141 },
    ]);
  });
});

describe('parseMonsters', () => {
  it('reads the object and worn items, and rejects leftover bytes', () => {
    const w = new ArchiveWriter().u16(1).u16(31001).u16(0).str('_').str('Horse');
    zeros(w, 12).u32(1234).u16(20051);
    zeros(w, 18 * 2 + 4 * 2 + 8 + 4 + 16 + 35);
    const file = w.toBuffer();

    expect(parseMonsters(file).get(31001)).toEqual({ objectId: 1234, items: [20051] });
    expect(() => parseMonsters(Buffer.concat([file, Buffer.alloc(1)]))).toThrow(/left over/);
  });
});

describe('parseResourceIndex', () => {
  it('maps each id to its file and position', () => {
    const w = new ArchiveWriter().u32(1).u32(1).u32(5);
    const name = Buffer.from('A.TOB', 'latin1');
    const tail = new ArchiveWriter().u32(9).u32(0).u32(44).toBuffer();

    expect(parseResourceIndex(Buffer.concat([w.toBuffer(), name, tail])).get(9)).toEqual({ file: 'A.TOB', pos: 44 });
  });
});

describe('parseObjectClothing', () => {
  it('skips to the clothing and reads its meshes and textures', () => {
    expect(parseObjectClothing(objectFile(), 0)).toEqual([
      { id: 10, cloths: [{ id: 20, meshes: [{ id: 30, resource: 40, textures: [{ texture: 50, minAlpha: 150 }] }] }] },
    ]);
  });
});

describe('parseMesh', () => {
  it('reads a skinned mesh', () => {
    const mesh = parseMesh(meshFile({ bones: 2 }), 0);

    expect(Array.from(mesh.positions.slice(0, 3))).toEqual([1, 2, 3]);
    expect(Array.from(mesh.uvs.slice(0, 2))).toEqual([0.5, 0.25]);
    expect(Array.from(mesh.normals.slice(0, 3))).toEqual([0, 0, 1]);
  });

  it('reads an unskinned mesh, which stores a second UV set', () => {
    expect(Array.from(parseMesh(meshFile({ bones: 0 }), 0).positions.slice(3, 6))).toEqual([2, 3, 4]);
  });

  it('keeps only the highest detail level', () => {
    expect(parseMesh(meshFile({ bones: 1, levels: 2 }), 0).slots).toEqual([[0, 1, 2]]);
  });
});

describe('extractTexture', () => {
  const read = (file: Buffer) => () => file;

  it('decodes compressed pixels to a PNG', () => {
    const file = textureBlock([], deflateSync(ddsFile()));

    const png = extractTexture(1, new Map([[1, { file: 'T', pos: 0 }]]), read(file));

    expect([...PNG.sync.read(png!).data]).toEqual([255, 0, 0, 255]);
  });

  it('follows a record that only names its first frame', () => {
    const pointer = textureBlock([2], Buffer.alloc(0));
    const pixels = textureBlock([], ddsFile());
    const file = Buffer.concat([pointer, pixels]);
    const index = new Map([
      [1, { file: 'T', pos: 0 }],
      [2, { file: 'T', pos: pointer.length }],
    ]);

    expect(PNG.sync.read(extractTexture(1, index, read(file))!).width).toBe(1);
  });

  it('returns null for an unknown texture', () => {
    expect(extractTexture(1, new Map(), read(Buffer.alloc(0)))).toBeNull();
  });
});

describe('buildGlb', () => {
  it('writes a valid container, padded to four bytes', () => {
    const glb = buildGlb([{ mesh: triangle(), materials: [{ png: null, minAlpha: 0 }] }]);

    expect(glb.toString('latin1', 0, 4)).toBe('glTF');
    expect(glb.readUInt32LE(8)).toBe(glb.length);
    expect(readGlb(glb).bin.length % 4).toBe(0);
  });

  it('converts to right-handed coordinates by mirroring Z and reversing the triangle', () => {
    const { json, bin } = readGlb(buildGlb([{ mesh: triangle(), materials: [{ png: null, minAlpha: 0 }] }]));
    const position = json.accessors[json.meshes[0].primitives[0].attributes.POSITION];
    const indices = json.bufferViews[json.accessors[json.meshes[0].primitives[0].indices].bufferView];

    expect(position.min).toEqual([1, 2, -9]);
    expect(position.max).toEqual([7, 8, -3]);
    expect([bin.readUInt16LE(indices.byteOffset), bin.readUInt16LE(indices.byteOffset + 2), bin.readUInt16LE(indices.byteOffset + 4)]).toEqual([0, 2, 1]);
  });

  it('cuts out transparent textures at the game threshold, and leaves solid ones opaque', () => {
    const material = (png: Buffer, minAlpha: number) => readGlb(buildGlb([{ mesh: triangle(), materials: [{ png, minAlpha }] }])).json.materials[0];

    expect(material(pngOf(0), 150)).toMatchObject({ alphaMode: 'MASK', alphaCutoff: 150 / 255 });
    expect(material(pngOf(0), 0).alphaCutoff).toBeCloseTo(40 / 255);
    expect(material(pngOf(255), 150).alphaMode).toBeUndefined();
  });
});

describe('buildMountModel', () => {
  const sources = (items: number[]): ModelSources => {
    const object = objectFile();
    const mesh = meshFile({ bones: 1 });
    const texture = textureBlock([], ddsFile());
    const files: Record<string, Buffer> = { obj: object, mesh, tex: texture };
    return {
      monsters: new Map([[1, { objectId: 2, items }]]),
      itemVisuals: new Map([[3, 4]]),
      visuals: new Map([[4, { objectId: 0, clothKind: 10, cloth: 20, mesh: 30 }]]),
      objects: new Map([[2, { file: 'obj', pos: 0 }]]),
      meshes: new Map([[40, { file: 'mesh', pos: 0 }]]),
      textures: new Map([[50, { file: 'tex', pos: 0 }]]),
      read: ({ file }) => files[file],
    };
  };

  it('builds the mesh the worn item selects, with its texture', () => {
    const { json } = readGlb(buildMountModel(1, sources([3])));

    expect(json.meshes).toHaveLength(1);
    expect(json.images).toHaveLength(1);
  });

  it('refuses a monster with nothing that selects a mesh', () => {
    expect(() => buildMountModel(1, sources([]))).toThrow(/selects a mesh/);
  });

  it('refuses a monster the client does not have', () => {
    expect(() => buildMountModel(9, sources([3]))).toThrow(/not in the client/);
  });
});
