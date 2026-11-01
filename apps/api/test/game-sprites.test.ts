import { deflateSync } from 'node:zlib';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { composeSprite, decodeDds, extractSprites } from '../src/gm/game-sprites.js';

function dds(fourCC: string, width: number, height: number, payload: Buffer, bgra?: number[]): Buffer {
  const header = Buffer.alloc(128);
  header.write('DDS ', 0, 'ascii');
  header.writeUInt32LE(height, 12);
  header.writeUInt32LE(width, 16);
  if (bgra) {
    header.writeUInt32LE(32, 88);
    bgra.forEach((mask, i) => header.writeUInt32LE(mask, 92 + i * 4));
  } else {
    header.write(fourCC, 84, 'ascii');
  }
  return Buffer.concat([header, payload]);
}

function dxt1Block(color0: number, color1: number, lookup: number): Buffer {
  const b = Buffer.alloc(8);
  b.writeUInt16LE(color0, 0);
  b.writeUInt16LE(color1, 2);
  b.writeUInt32LE(lookup, 4);
  return b;
}

describe('decodeDds', () => {
  it('decodes a DXT1 block: color0 red, all indices 0', () => {
    const { width, height, rgba } = decodeDds(dds('DXT1', 4, 4, dxt1Block(0xf800, 0x001f, 0)));
    expect([width, height]).toEqual([4, 4]);
    expect([...rgba.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
  });

  it('applies DXT3 explicit alpha', () => {
    const alpha = Buffer.alloc(8, 0x88);
    const { rgba } = decodeDds(dds('DXT3', 4, 4, Buffer.concat([alpha, dxt1Block(0xf800, 0, 0)])));
    expect([...rgba.subarray(0, 4)]).toEqual([255, 0, 0, 0x88]);
  });

  it('applies DXT5 interpolated alpha', () => {
    const alpha = Buffer.alloc(8);
    alpha[0] = 200;
    alpha[1] = 100;
    const { rgba } = decodeDds(dds('DXT5', 4, 4, Buffer.concat([alpha, dxt1Block(0xf800, 0, 0)])));
    expect(rgba[3]).toBe(200);
  });

  it('decodes uncompressed BGRA using the channel masks', () => {
    const px = Buffer.alloc(4);
    px.writeUInt32LE(0x80112233, 0); // a=80 r=11 g=22 b=33
    const { rgba } = decodeDds(dds('', 1, 1, px, [0x00ff0000, 0x0000ff00, 0x000000ff, 0xff000000]));
    expect([...rgba]).toEqual([0x11, 0x22, 0x33, 0x80]);
  });

  it('rejects a non-DDS buffer', () => expect(() => decodeDds(Buffer.from('nope'))).toThrow('Unsupported DDS'));

  it('rejects an unsupported format', () =>
    expect(() => decodeDds(dds('DXT2', 4, 4, Buffer.alloc(16)))).toThrow());
});

const quad = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0, z: 0, rhw: 1, u: 0, v: 0 },
  { x: x1, y: y0, z: 0, rhw: 1, u: 1, v: 0 },
  { x: x0, y: y1, z: 0, rhw: 1, u: 0, v: 1 },
  { x: x1, y: y1, z: 0, rhw: 1, u: 1, v: 1 },
];
const solid = (width: number, height: number, r: number, g: number, b: number, a = 255) => {
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) rgba.set([r, g, b, a], i * 4);
  return { width, height, rgba };
};
const px = (img: { width: number; rgba: Buffer }, x: number, y: number) => [
  ...img.rgba.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4),
];

describe('composeSprite', () => {
  it('copies a full-quad texture onto the canvas', () => {
    const out = composeSprite(
      { width: 4, height: 4, parts: [{ imageId: 1, vertices: quad(0, 0, 4, 4) }] },
      new Map([[1, solid(2, 2, 10, 20, 30)]]),
    );
    expect([out.width, out.height]).toEqual([4, 4]);
    expect(px(out, 0, 0)).toEqual([10, 20, 30, 255]);
    expect(px(out, 3, 3)).toEqual([10, 20, 30, 255]);
  });

  it('places a part at its vertex position and alpha-blends a later part over it', () => {
    const out = composeSprite(
      {
        width: 4,
        height: 4,
        parts: [
          { imageId: 1, vertices: quad(0, 0, 4, 4) },
          { imageId: 2, vertices: quad(2, 2, 4, 4) },
        ],
      },
      new Map([
        [1, solid(2, 2, 0, 0, 200)],
        [2, solid(2, 2, 200, 0, 0, 128)],
      ]),
    );
    expect(px(out, 0, 0)).toEqual([0, 0, 200, 255]);
    const a = 128 / 255;
    expect(px(out, 3, 3)).toEqual([
      Math.round(200 * a),
      0,
      Math.round(200 * (1 - a)),
      Math.round(128 + 255 * (1 - a)),
    ]);
  });

  it('skips a part whose texture is missing, leaving it transparent', () => {
    const out = composeSprite(
      { width: 2, height: 2, parts: [{ imageId: 9, vertices: quad(0, 0, 2, 2) }] },
      new Map(),
    );
    expect([...out.rgba]).toEqual(Array.from({ length: 16 }, () => 0));
  });
});

// Container layouts per Extractor/src/lib: wrapped block = u32 original size, u32 compressed size, zlib data.
const wrap = (data: Buffer) => {
  const z = deflateSync(data);
  const h = Buffer.alloc(8);
  h.writeUInt32LE(data.length, 0);
  h.writeUInt32LE(z.length, 4);
  return Buffer.concat([h, z]);
};
const u32 = (...v: number[]) => {
  const b = Buffer.alloc(v.length * 4);
  v.forEach((n, i) => b.writeUInt32LE(n, i * 4));
  return b;
};
const str = (s: string) => Buffer.concat([u32(s.length), Buffer.from(s, 'latin1')]);

function imageData(width: number, height: number, imageId: number): Buffer {
  const parts = Buffer.alloc(4 + 4 * 24);
  parts.writeUInt32LE(imageId, 0);
  quad(0, 0, width, height).forEach((v, i) => {
    [v.x, v.y, v.z, v.rhw, v.u, v.v].forEach((f, j) => parts.writeFloatLE(f, 4 + i * 24 + j * 4));
  });
  return Buffer.concat([u32(1, width, height), parts, u32(0)]);
}

function imageSet(data: Buffer | null): Buffer {
  return Buffer.concat([u32(0, 0, 0), Buffer.from([0]), u32(data ? data.length : 0), data ?? Buffer.alloc(0)]);
}

function texture(id: number, png: Buffer): Buffer {
  const z = deflateSync(png);
  return Buffer.concat([u32(id), Buffer.from([0]), u32(png.length, z.length), z]);
}

function fixture(opts: { wanted: Set<number>; noData?: boolean }) {
  const png = new PNG({ width: 2, height: 2 });
  png.data = solid(2, 2, 255, 0, 0).rgba;
  const tim = Buffer.concat([wrap(imageSet(null)), wrap(imageSet(opts.noData ? null : imageData(32, 32, 55)))]);
  const firstLen = wrap(imageSet(null)).length;
  const tis = Buffer.concat([wrap(texture(11, PNG.sync.write(png))), wrap(texture(55, PNG.sync.write(png)))]);
  const imageIndex = Buffer.concat([
    u32(1, 2),
    str('Image\\a.TIM'),
    u32(7000, 0, firstLen, 7001, 0, 0),
  ]);
  const bufferList = Buffer.concat([u32(1, 2), str('Image\\a.TIS')]);
  return {
    imageIndex,
    bufferList,
    wanted: opts.wanted,
    readData: (p: string) => (p === 'Image\\a.TIM' ? tim : p === 'Image\\a.TIS' ? tis : Buffer.alloc(0)),
  };
}

describe('extractSprites', () => {
  it('builds a PNG for a wanted sprite from built IDX, LST, TIM and TIS buffers', () => {
    const sprites = extractSprites(fixture({ wanted: new Set([7000]) }));
    const png = PNG.sync.read(sprites.get(7000)!);
    expect(png.width).toBe(32);
    expect([...png.data.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
  });

  it('ignores unwanted sprites', () => expect(extractSprites(fixture({ wanted: new Set() })).size).toBe(0));

  it('omits a wanted sprite with no image data', () =>
    expect(extractSprites(fixture({ wanted: new Set([7000]), noData: true })).has(7000)).toBe(false));

  it('omits a wanted sprite missing from the index', () =>
    expect(extractSprites(fixture({ wanted: new Set([1234]) })).size).toBe(0));
});
