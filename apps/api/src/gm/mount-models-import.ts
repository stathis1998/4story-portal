import { inflateSync } from 'node:zlib';
import type { UvKey } from '@4story-portal/shared';
import { PNG } from 'pngjs';
import { ArchiveReader } from './game-places-import.js';
import { ITEM_VISUAL_LAYOUT, readLayout } from './game-icons-import.js';
import { decodeDds } from './game-sprites.js';

// Turns the game client's mount models into GLB files. Layouts follow the client source:
// CTChart::InitTPET and InitTMONTEMP, and CTachyonRes::LoadOBJ, LoadMESH and LoadTEX. No file I/O here:
// import-mount-models.ts does that.

export type MountPet = { petId: number; monsterId: number };
export type Monster = { objectId: number; items: number[] };
export type ResourceEntry = { file: string; pos: number };
/** `objectId` is the item's own object; 0 means a mesh of the character's object. */
export type VisualMesh = { objectId: number; clothKind: number; cloth: number; mesh: number };
export type ObjectTexture = { texture: number; minAlpha: number };
export type ObjectMesh = { id: number; resource: number; textures: ObjectTexture[] };
export type ObjectCloth = { id: number; meshes: ObjectMesh[] };
export type ObjectClothKind = { id: number; cloths: ObjectCloth[] };
export type GameMesh = { positions: Float32Array; normals: Float32Array; uvs: Float32Array; slots: number[][] };

const ITEM_SLOT_COUNT = 19;
const MONSTER_SKILL_COUNT = 4;
const WEIGHT_AND_BONE_BYTES = 16;
const SECOND_UV_BYTES = 8;
const MATRIX_BYTES = 64;
const MIN_ALPHA_CUTOFF = 40;

/** Mounts InitTPET adds in code, on top of TMount.tcd. */
const CODED_PETS: MountPet[] = [
  { petId: 50, monsterId: 31250 },
  { petId: 51, monsterId: 31254 },
  { petId: 52, monsterId: 31256 },
  { petId: 53, monsterId: 31258 },
  { petId: 54, monsterId: 31252 },
];

/** Mounts with items and a row in the server's TPETCHART, but no entry in the client's TMount.tcd. */
const SERVER_ONLY_PETS: MountPet[] = [
  { petId: 40, monsterId: 31162 },
  { petId: 42, monsterId: 31164 },
  { petId: 43, monsterId: 31159 },
  { petId: 44, monsterId: 31166 },
  { petId: 45, monsterId: 31168 },
];

export function parseMountChart(file: Buffer): MountPet[] {
  const reader = new ArchiveReader(file);
  const pets: MountPet[] = [];
  for (let count = reader.u16(); count > 0; count--) {
    const petId = reader.u16();
    const monsterId = reader.u16();
    reader.skip(2 + 2); // saddle monster, icon
    pets.push({ petId, monsterId });
  }
  reader.assertFinished();
  return [...pets, ...CODED_PETS, ...SERVER_ONLY_PETS];
}

export function parseMonsters(file: Buffer): Map<number, Monster> {
  const reader = new ArchiveReader(file);
  const monsters = new Map<number, Monster>();
  for (let count = reader.u16(); count > 0; count--) {
    const id = reader.u16();
    reader.skip(2); // kind
    reader.string(); // title
    reader.string(); // name
    reader.skip(3 * 4); // three floats
    const objectId = reader.u32();
    const items: number[] = [];
    for (let slot = 0; slot < ITEM_SLOT_COUNT; slot++) items.push(reader.u16());
    reader.skip(MONSTER_SKILL_COUNT * 2 + 8 + 4 + 4 * 4); // skills, flags, menu, size and scale
    reader.skip(1 + 2 + 4 + 2 + 2 + 2 + 1 + 2 + 4 + 2 + 1 + 1 + 1 + 4 + 2 + 4); // the rest of the record
    monsters.set(id, { objectId, items: items.filter((item) => item !== 0) });
  }
  reader.assertFinished();
  return monsters;
}

/** Which clothing kind, cloth and mesh of an object each item visual shows. */
export function parseVisualMeshes(file: Buffer): Map<number, VisualMesh> {
  const reader = new ArchiveReader(file);
  const visuals = new Map<number, VisualMesh>();
  for (let count = reader.u16(); count > 0; count--) {
    const fields = readLayout(reader, ITEM_VISUAL_LAYOUT);
    // Bows and crossbows have no normal mesh: the client only draws them in battle stance.
    visuals.set(fields[0], { objectId: fields[2], clothKind: fields[3], cloth: fields[4], mesh: fields[5] || fields[6] });
  }
  reader.assertFinished();
  return visuals;
}

/** A resource .IDX: file names with an int32 length, then (id, file number, position) triples. */
export function parseResourceIndex(file: Buffer): Map<number, ResourceEntry> {
  let offset = 8;
  const fileCount = file.readInt32LE(0);
  const total = file.readInt32LE(4);
  const names: string[] = [];
  for (let i = 0; i < fileCount; i++) {
    const length = file.readInt32LE(offset);
    names.push(file.toString('latin1', offset + 4, offset + 4 + length));
    offset += 4 + length;
  }
  const entries = new Map<number, ResourceEntry>();
  for (let i = 0; i < total; i++, offset += 12) {
    entries.set(file.readUInt32LE(offset), { file: names[file.readUInt32LE(offset + 4)], pos: file.readUInt32LE(offset + 8) });
  }
  if (offset !== file.length) throw new Error(`Resource index has ${file.length - offset} bytes left over: unexpected format`);
  return entries;
}

const skipEffect = (reader: ArchiveReader) => reader.skip(4 + 4 + 12 + 12 + 4 + 1 + 4 + 4 + 4);
const skipSound = (reader: ArchiveReader) => reader.skip(4 * 5);

function skipRepeated(reader: ArchiveReader, skipOne: (reader: ArchiveReader) => void): void {
  for (let count = reader.u32(); count > 0; count--) skipOne(reader);
}

function readObjectTexture(reader: ArchiveReader): ObjectTexture {
  const texture = reader.u32();
  reader.skip(4 + 2 + 4 * 7 + 4); // second texture, types, colours, order, blending, intensity
  const minAlpha = reader.u8();
  reader.skip(3 + 4 + 4 + 1); // z, two-sided, light, ambient, spare byte
  return { texture, minAlpha };
}

export function parseObjectClothing(file: Buffer, pos: number): ObjectClothKind[] {
  const reader = new ArchiveReader(file.subarray(pos));
  reader.skip(1); // pivot count
  reader.skip(reader.u32() * 8); // pivots
  skipRepeated(reader, skipEffect);
  skipRepeated(reader, skipSound);
  skipRepeated(reader, (r) => {
    r.skip(5); // attribute id, value type
    r.skip(r.u32());
  });
  skipRepeated(reader, (r) => {
    r.skip(4); // action id
    skipRepeated(r, skipEffect);
    skipRepeated(r, skipSound);
    skipRepeated(r, (animation) => {
      animation.skip(8); // animation id, animation
      skipRepeated(animation, skipEffect);
      skipRepeated(animation, skipSound);
    });
  });

  const kinds: ObjectClothKind[] = [];
  for (let k = reader.u32(); k > 0; k--) {
    const kind: ObjectClothKind = { id: reader.u32(), cloths: [] };
    for (let c = reader.u32(); c > 0; c--) {
      const cloth: ObjectCloth = { id: reader.u32(), meshes: [] };
      for (let m = reader.u32(); m > 0; m--) {
        const mesh: ObjectMesh = { id: reader.u32(), resource: reader.u32(), textures: [] };
        for (let t = reader.u32(); t > 0; t--) mesh.textures.push(readObjectTexture(reader));
        cloth.meshes.push(mesh);
      }
      kind.cloths.push(cloth);
    }
    kinds.push(kind);
  }
  return kinds;
}

/** The mesh in its stored pose. Each slot is the triangle list of one material, at the highest detail level. */
export function parseMesh(file: Buffer, pos: number): GameMesh {
  const reader = new ArchiveReader(file.subarray(pos));
  const slotCount = reader.u32();
  const boneCount = reader.u32();
  reader.skip(1); // shared vertex buffer flag
  const levels = reader.u32();
  reader.skip(12 + 4); // centre, radius
  reader.skip(boneCount * MATRIX_BYTES);

  const skinned = boneCount > 0;
  const vertexCount = reader.u32();
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  for (let v = 0; v < vertexCount; v++) {
    for (let a = 0; a < 3; a++) positions[v * 3 + a] = reader.f32();
    if (skinned) reader.skip(WEIGHT_AND_BONE_BYTES);
    for (let a = 0; a < 3; a++) normals[v * 3 + a] = reader.f32();
    for (let a = 0; a < 2; a++) uvs[v * 2 + a] = reader.f32();
    if (!skinned) reader.skip(SECOND_UV_BYTES);
  }

  const slots: number[][] = [];
  for (let slot = 0; slot < slotCount; slot++) {
    const triangles: number[] = [];
    for (let level = 0; level < levels; level++) {
      for (let groups = reader.u32(); groups > 0; groups--) {
        const indexCount = reader.u32();
        reader.skip(2); // bone group
        for (let i = 0; i < indexCount; i++) {
          const index = reader.u16();
          if (level === 0) triangles.push(index);
        }
      }
    }
    slots.push(triangles);
  }
  return { positions, normals, uvs, slots };
}

type TextureRecord = { frames: number[]; keys: UvKey[]; totalTick: number; pixels: Buffer };

function parseTextureRecord(file: Buffer, pos: number): TextureRecord {
  const compressedSize = file.readUInt32LE(pos + 4);
  const block = inflateSync(file.subarray(pos + 8, pos + 8 + compressedSize));
  let offset = 0;
  const readCount = () => {
    const value = block.readInt32LE(offset);
    offset += 4;
    return value;
  };
  const readFloat = () => {
    const value = block.readFloatLE(offset);
    offset += 4;
    return value;
  };
  const frames: number[] = [];
  for (let n = readCount(); n > 0; n--) {
    frames.push(block.readUInt32LE(offset));
    offset += 4;
  }
  // UVKEY in T3D.h: tick, then U, V, rotation in radians, scale U and scale V.
  const keys: UvKey[] = [];
  for (let n = readCount(); n > 0; n--) {
    const tick = block.readUInt32LE(offset);
    offset += 4;
    keys.push({ tick, u: readFloat(), v: readFloat(), rotation: readFloat(), scaleU: readFloat(), scaleV: readFloat() });
  }
  const totalTick = block.readUInt32LE(offset);
  offset += 4 + 4 + 4 + 1 + 1 + 4; // total tick, mip filter, mip bias, option, format, original size
  const size = readCount();
  return { frames, keys, totalTick, pixels: block.subarray(offset, offset + size) };
}

/** A texture's UV animation, as CTachyonObject::ApplyTexture plays it. Null for an unknown texture. */
export function readTextureAnimation(id: number, index: Map<number, ResourceEntry>, read: ReadResource): { keys: UvKey[]; loopMs: number } | null {
  const entry = index.get(id);
  if (!entry) return null;
  const { keys, totalTick } = parseTextureRecord(read(entry), entry.pos);
  return { keys, loopMs: totalTick };
}

/** The average colour of a PNG, `#rrggbb`. */
export function textureSwatch(png: Buffer): string {
  const { data } = PNG.sync.read(png);
  const sums = [0, 0, 0];
  const pixels = data.length / 4;
  for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) sums[c] += data[i + c];
  return `#${sums.map((sum) => Math.round(sum / Math.max(1, pixels)).toString(16).padStart(2, '0')).join('')}`;
}

export type ReadResource = (entry: ResourceEntry) => Buffer;

/** The PNG for a texture id, following a record that only points at its first frame. */
export function extractTexture(id: number, index: Map<number, ResourceEntry>, read: ReadResource): Buffer | null {
  const entry = index.get(id);
  if (!entry) return null;
  let record = parseTextureRecord(read(entry), entry.pos);
  if (record.pixels.length === 0 && record.frames.length > 0) {
    const frame = index.get(record.frames[0]);
    if (!frame) return null;
    record = parseTextureRecord(read(frame), frame.pos);
  }
  if (record.pixels.length === 0) return null;
  const dds = record.pixels[0] === 0x78 ? inflateSync(record.pixels) : record.pixels;
  const { width, height, rgba } = decodeDds(dds);
  const png = new PNG({ width, height });
  rgba.copy(png.data);
  return PNG.sync.write(png);
}

export type GlbMaterial = { png: Buffer | null; minAlpha: number };
export type GlbPart = { mesh: GameMesh; materials: GlbMaterial[] };

type BufferView = { buffer: 0; byteOffset: number; byteLength: number; target?: number };
type Accessor = { bufferView: number; componentType: number; count: number; type: string; min?: number[]; max?: number[] };

const GL_ARRAY_BUFFER = 34962;
const GL_ELEMENT_ARRAY_BUFFER = 34963;
const GL_FLOAT = 5126;
const GL_UNSIGNED_SHORT = 5123;
const GL_UNSIGNED_INT = 5125;

const align4 = (size: number) => (size + 3) & ~3;

/**
 * Builds a binary glTF from meshes in game coordinates. The game is left-handed and glTF right-handed,
 * so Z is mirrored and every triangle's winding is reversed.
 */
export function buildGlb(parts: GlbPart[]): Buffer {
  const chunks: Buffer[] = [];
  const bufferViews: BufferView[] = [];
  const accessors: Accessor[] = [];
  const images: { bufferView: number; mimeType: string }[] = [];
  const textures: { source: number }[] = [];
  const materials: Record<string, unknown>[] = [];
  const meshes: { primitives: Record<string, unknown>[] }[] = [];
  let byteOffset = 0;

  const addView = (data: Buffer, target?: number): number => {
    bufferViews.push({ buffer: 0, byteOffset, byteLength: data.length, ...(target ? { target } : {}) });
    const padded = Buffer.alloc(align4(data.length));
    data.copy(padded);
    chunks.push(padded);
    byteOffset += padded.length;
    return bufferViews.length - 1;
  };
  const addFloats = (values: Float32Array, type: string, itemSize: number, withBounds: boolean): number => {
    const view = addView(Buffer.from(values.buffer, values.byteOffset, values.byteLength), GL_ARRAY_BUFFER);
    const accessor: Accessor = { bufferView: view, componentType: GL_FLOAT, count: values.length / itemSize, type };
    if (withBounds) {
      accessor.min = Array<number>(itemSize).fill(Infinity);
      accessor.max = Array<number>(itemSize).fill(-Infinity);
      values.forEach((value, i) => {
        accessor.min![i % itemSize] = Math.min(accessor.min![i % itemSize], value);
        accessor.max![i % itemSize] = Math.max(accessor.max![i % itemSize], value);
      });
    }
    accessors.push(accessor);
    return accessors.length - 1;
  };
  const addIndices = (indices: number[], vertexCount: number): number => {
    const wide = vertexCount > 0xffff;
    const data = wide ? Buffer.from(Uint32Array.from(indices).buffer) : Buffer.from(Uint16Array.from(indices).buffer);
    const view = addView(data, GL_ELEMENT_ARRAY_BUFFER);
    accessors.push({ bufferView: view, componentType: wide ? GL_UNSIGNED_INT : GL_UNSIGNED_SHORT, count: indices.length, type: 'SCALAR' });
    return accessors.length - 1;
  };
  const addMaterial = ({ png, minAlpha }: GlbMaterial): number => {
    const pbr: Record<string, unknown> = { metallicFactor: 0, roughnessFactor: 1 };
    const material: Record<string, unknown> = { pbrMetallicRoughness: pbr, doubleSided: true };
    if (png) {
      images.push({ bufferView: addView(png), mimeType: 'image/png' });
      textures.push({ source: images.length - 1 });
      pbr.baseColorTexture = { index: textures.length - 1 };
      if (hasTransparency(png)) {
        material.alphaMode = 'MASK';
        material.alphaCutoff = Math.max(minAlpha, MIN_ALPHA_CUTOFF) / 255;
      }
    }
    materials.push(material);
    return materials.length - 1;
  };

  for (const { mesh, materials: partMaterials } of parts) {
    const positions = mesh.positions.slice();
    const normals = mesh.normals.slice();
    for (let i = 2; i < positions.length; i += 3) {
      positions[i] = -positions[i];
      normals[i] = -normals[i];
    }
    const POSITION = addFloats(positions, 'VEC3', 3, true);
    const NORMAL = addFloats(normals, 'VEC3', 3, false);
    const TEXCOORD_0 = addFloats(mesh.uvs, 'VEC2', 2, false);
    const vertexCount = positions.length / 3;

    const primitives = mesh.slots.flatMap((slot, i) => {
      if (slot.length === 0) return [];
      const reversed: number[] = [];
      for (let t = 0; t + 2 < slot.length; t += 3) reversed.push(slot[t], slot[t + 2], slot[t + 1]);
      const material = partMaterials[i] ?? partMaterials[0] ?? { png: null, minAlpha: 0 };
      return [{ attributes: { POSITION, NORMAL, TEXCOORD_0 }, indices: addIndices(reversed, vertexCount), material: addMaterial(material) }];
    });
    meshes.push({ primitives });
  }

  const json = {
    asset: { version: '2.0', generator: '4story-portal' },
    scene: 0,
    scenes: [{ nodes: meshes.map((_, i) => i) }],
    nodes: meshes.map((_, i) => ({ mesh: i })),
    meshes,
    accessors,
    bufferViews,
    buffers: [{ byteLength: byteOffset }],
    materials,
    ...(textures.length ? { textures, images } : {}),
  };

  const jsonBytes = Buffer.from(JSON.stringify(json));
  const jsonChunk = Buffer.alloc(align4(jsonBytes.length), 0x20);
  jsonBytes.copy(jsonChunk);
  const binChunk = Buffer.concat(chunks);
  const header = Buffer.alloc(12 + 8);
  header.write('glTF', 0, 'latin1');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
  header.writeUInt32LE(jsonChunk.length, 12);
  header.write('JSON', 16, 'latin1');
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binChunk.length, 0);
  binHeader.write('BIN\0', 4, 'latin1');
  return Buffer.concat([header, jsonChunk, binHeader, binChunk]);
}

function hasTransparency(png: Buffer): boolean {
  const { data } = PNG.sync.read(png);
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}

export type ModelSources = {
  monsters: Map<number, Monster>;
  itemVisuals: Map<number, number>;
  visuals: Map<number, VisualMesh>;
  objects: Map<number, ResourceEntry>;
  meshes: Map<number, ResourceEntry>;
  textures: Map<number, ResourceEntry>;
  read: ReadResource;
};

/** One mount's GLB. Each item the monster wears selects one mesh of its shared body. */
export function buildMountModel(monsterId: number, sources: ModelSources): Buffer {
  const { monsters, itemVisuals, visuals, objects, meshes, textures, read } = sources;
  const monster = monsters.get(monsterId);
  if (!monster) throw new Error(`monster ${monsterId} is not in the client`);
  const objectEntry = objects.get(monster.objectId);
  if (!objectEntry) throw new Error(`object ${monster.objectId} is not in the client`);
  const clothing = parseObjectClothing(read(objectEntry), objectEntry.pos);

  const parts: GlbPart[] = [];
  for (const item of monster.items) {
    const visual = visuals.get(itemVisuals.get(item) ?? -1);
    const part = visual && visualPart(clothing, visual, { meshes, textures, read });
    if (part) parts.push(part);
  }
  if (parts.length === 0) throw new Error(`monster ${monsterId} wears nothing that selects a mesh`);
  return buildGlb(parts);
}

/** The mesh a visual selects in an object's clothing, with its textures; null when the object lacks it. */
export function visualPart(
  clothing: ObjectClothKind[],
  visual: Pick<VisualMesh, 'clothKind' | 'cloth' | 'mesh'>,
  { meshes, textures, read }: Pick<ModelSources, 'meshes' | 'textures' | 'read'>,
): GlbPart | null {
  const objectMesh = clothing
    .find((kind) => kind.id === visual.clothKind)
    ?.cloths.find((cloth) => cloth.id === visual.cloth)
    ?.meshes.find((mesh) => mesh.id === visual.mesh);
  if (!objectMesh) return null;
  const meshEntry = meshes.get(objectMesh.resource);
  if (!meshEntry) throw new Error(`mesh ${objectMesh.resource} is not in the client`);
  return {
    mesh: parseMesh(read(meshEntry), meshEntry.pos),
    materials: objectMesh.textures.map(({ texture, minAlpha }) => ({ png: extractTexture(texture, textures, read), minAlpha })),
  };
}
