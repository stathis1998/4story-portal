import { deflateSync } from 'node:zlib';
import { PNG } from 'pngjs';
import { ArchiveWriter } from './archive-writer.js';

// Small hand-built game client files, laid out like the real ones, for the model and effect parsers.

export const zeros = (w: ArchiveWriter, bytes: number) => {
  for (let i = 0; i < bytes; i++) w.u8(0);
  return w;
};

export const meshFile = ({ bones, levels = 1 }: { bones: number; levels?: number }) => {
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

/** An object with one clothing kind (10), cloth (20) and mesh (30) on mesh resource 40 and texture 50. */
export const objectFile = () => {
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

export const pngOf = (alpha: number, rgb: [number, number, number] = [10, 20, 30]) => {
  const png = new PNG({ width: 1, height: 1 });
  png.data.set([...rgb, alpha]);
  return PNG.sync.write(png);
};

/** A 1x1 32-bit DDS with one opaque red pixel. */
export const ddsFile = () => {
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

export type FixtureUvKey = { tick: number; u: number; v: number; rotation: number; scaleU: number; scaleV: number };

/** A .TTX texture record: frame ids, UV keys, total tick, then the pixels. */
export const textureBlock = (frames: number[], pixels: Buffer, keys: FixtureUvKey[] = [], totalTick = 0) => {
  const w = new ArchiveWriter().u32(frames.length);
  frames.forEach((frame) => w.u32(frame));
  w.u32(keys.length);
  keys.forEach((key) => w.u32(key.tick).f32(key.u).f32(key.v).f32(key.rotation).f32(key.scaleU).f32(key.scaleV));
  w.u32(totalTick);
  zeros(w, 8 + 1 + 1 + 4).u32(pixels.length);
  const block = deflateSync(Buffer.concat([w.toBuffer(), pixels]));
  const head = Buffer.alloc(8);
  head.writeUInt32LE(block.length, 4);
  return Buffer.concat([head, block]);
};

export const readGlb = (glb: Buffer) => {
  const jsonLength = glb.readUInt32LE(12);
  const json = JSON.parse(glb.toString('utf8', 20, 20 + jsonLength));
  const bin = glb.subarray(20 + jsonLength + 8);
  return { json, bin };
};
