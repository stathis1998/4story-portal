import { deflateSync } from 'node:zlib';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import {
  buildGlb,
  buildMountModel,
  extractTexture,
  parseMesh,
  parseMonsters,
  parseMountChart,
  parseObjectClothing,
  parseResourceIndex,
  type GameMesh,
  type ModelSources,
} from '../src/gm/mount-models-import.js';
import { ArchiveWriter } from './archive-writer.js';

const zeros = (w: ArchiveWriter, bytes: number) => {
  for (let i = 0; i < bytes; i++) w.u8(0);
  return w;
};

const meshFile = ({ bones, levels = 1 }: { bones: number; levels?: number }) => {
  const w = new ArchiveWriter().u32(1).u32(bones).u8(1).u32(levels);
  zeros(w, 16 + bones * 64).u32(3);
  for (let v = 0; v < 3; v++) {
    w.f32(v + 1).f32(v + 2).f32(v + 3);
    if (bones) zeros(w, 16);
    w.f32(0).f32(0).f32(1).f32(0.5).f32(0.25);
    if (!bones) zeros(w, 8);
  }
  for (let level = 0; level < levels; level++) {
    w.u32(1).u32(3).u16(0);
    w.u16(level).u16(level + 1).u16(level + 2);
  }
  return w.toBuffer();
};

const objectFile = () => {
  const w = new ArchiveWriter().u8(1).u32(1).u32(5).u32(6); // pivot count, one pivot
  w.u32(1); // one effect
  zeros(w, 49);
  w.u32(0).u32(1); // no sounds, one attribute
  zeros(w, 5).u32(2).u8(9).u8(9);
  w.u32(1).u32(77).u32(0).u32(0).u32(1); // one action with one animation
  zeros(w, 8).u32(0).u32(0);
  w.u32(1).u32(10).u32(1).u32(20).u32(1).u32(30).u32(40).u32(1); // kind, cloth, mesh, one texture
  w.u32(50).u32(0).u8(0).u8(0);
  zeros(w, 4 * 7 + 4);
  w.u8(150);
  zeros(w, 3 + 4 + 4 + 1);
  return w.toBuffer();
};

const pngOf = (alpha: number) => {
  const png = new PNG({ width: 1, height: 1 });
  png.data.set([10, 20, 30, alpha]);
  return PNG.sync.write(png);
};

/** A 4x4 DXT-free DDS with one opaque red pixel block, the format decodeDds reads as 32-bit colour. */
const ddsFile = () => {
  const file = Buffer.alloc(128 + 4);
  file.write('DDS ', 0, 'latin1');
  file.writeUInt32LE(1, 12);
  file.writeUInt32LE(1, 16);
  file.writeUInt32LE(32, 88);
  file.writeUInt32LE(0x00ff0000, 92);
  file.writeUInt32LE(0x0000ff00, 96);
  file.writeUInt32LE(0x000000ff, 100);
  file.writeUInt32LE(0xff000000, 104);
  file.writeUInt32LE(0xffff0000, 128);
  return file;
};

const textureBlock = (frames: number[], pixels: Buffer) => {
  const w = new ArchiveWriter().u32(frames.length);
  frames.forEach((frame) => w.u32(frame));
  w.u32(0);
  zeros(w, 12 + 1 + 1 + 4).u32(pixels.length);
  const block = deflateSync(Buffer.concat([w.toBuffer(), pixels]));
  const head = Buffer.alloc(8);
  head.writeUInt32LE(block.length, 4);
  return Buffer.concat([head, block]);
};

const readGlb = (glb: Buffer) => {
  const jsonLength = glb.readUInt32LE(12);
  const json = JSON.parse(glb.toString('utf8', 20, 20 + jsonLength));
  const bin = glb.subarray(20 + jsonLength + 8);
  return { json, bin };
};

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
      visuals: new Map([[4, { clothKind: 10, cloth: 20, mesh: 30 }]]),
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
