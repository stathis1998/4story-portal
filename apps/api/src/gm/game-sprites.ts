import { unzipSync } from 'node:zlib';
import { PNG } from 'pngjs';

// Port of the Extractor's image decoding (Extractor/src/lib/dds.js, container.js, index-files.js and
// icon-extractor.js): the output pixels must stay identical to its PNGs. No file I/O here: the caller
// supplies the index buffers and a reader for the client's Data folder.

export type Rgba = { width: number; height: number; rgba: Buffer };
export type Texture = Rgba;
export type SpriteVertex = { x: number; y: number; z: number; rhw: number; u: number; v: number };
export type SpritePart = { imageId: number; vertices: SpriteVertex[] };
export type SpriteImage = { width: number; height: number; parts: SpritePart[] };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

// --- DDS ---

type Color = [number, number, number, number];

function rgb565ToRgba(color: number): Color {
  const red = (((color >> 11) & 0x1f) * 255) / 31;
  const green = (((color >> 5) & 0x3f) * 255) / 63;
  const blue = ((color & 0x1f) * 255) / 31;
  return [red | 0, green | 0, blue | 0, 255];
}

function extractMaskedChannel(value: number, mask: number): number {
  if (!mask) return 0;
  let shift = 0;
  while (((mask >> shift) & 1) === 0) shift += 1;
  let bits = 0;
  while (((mask >> (shift + bits)) & 1) === 1) bits += 1;
  const max = (1 << bits) - 1;
  const raw = (value & mask) >>> shift;
  return Math.round((raw * 255) / max);
}

function decodeBgra32(
  payload: Buffer,
  width: number,
  height: number,
  rMask: number,
  gMask: number,
  bMask: number,
  aMask: number,
): Buffer {
  const rgba = Buffer.alloc(width * height * 4);
  let source = 0;
  for (let index = 0; index < width * height; index += 1) {
    const pixel = payload.readUInt32LE(source);
    source += 4;
    rgba[index * 4 + 0] = extractMaskedChannel(pixel, rMask);
    rgba[index * 4 + 1] = extractMaskedChannel(pixel, gMask);
    rgba[index * 4 + 2] = extractMaskedChannel(pixel, bMask);
    rgba[index * 4 + 3] = aMask ? extractMaskedChannel(pixel, aMask) : 255;
  }
  return rgba;
}

function buildDxt1Colors(color0: number, color1: number, forceFourColor = false): Color[] {
  const c0 = rgb565ToRgba(color0);
  const c1 = rgb565ToRgba(color1);
  const colors: Color[] = [c0, c1];
  if (color0 > color1 || forceFourColor) {
    colors.push([
      Math.round((2 * c0[0] + c1[0]) / 3),
      Math.round((2 * c0[1] + c1[1]) / 3),
      Math.round((2 * c0[2] + c1[2]) / 3),
      255,
    ]);
    colors.push([
      Math.round((c0[0] + 2 * c1[0]) / 3),
      Math.round((c0[1] + 2 * c1[1]) / 3),
      Math.round((c0[2] + 2 * c1[2]) / 3),
      255,
    ]);
  } else {
    colors.push([
      Math.round((c0[0] + c1[0]) / 2),
      Math.round((c0[1] + c1[1]) / 2),
      Math.round((c0[2] + c1[2]) / 2),
      255,
    ]);
    colors.push([0, 0, 0, 0]);
  }
  return colors;
}

function buildDxt5AlphaTable(alpha0: number, alpha1: number): number[] {
  const table = [alpha0, alpha1];
  if (alpha0 > alpha1) {
    table.push(Math.round((6 * alpha0 + alpha1) / 7));
    table.push(Math.round((5 * alpha0 + 2 * alpha1) / 7));
    table.push(Math.round((4 * alpha0 + 3 * alpha1) / 7));
    table.push(Math.round((3 * alpha0 + 4 * alpha1) / 7));
    table.push(Math.round((2 * alpha0 + 5 * alpha1) / 7));
    table.push(Math.round((alpha0 + 6 * alpha1) / 7));
  } else {
    table.push(Math.round((4 * alpha0 + alpha1) / 5));
    table.push(Math.round((3 * alpha0 + 2 * alpha1) / 5));
    table.push(Math.round((2 * alpha0 + 3 * alpha1) / 5));
    table.push(Math.round((alpha0 + 4 * alpha1) / 5));
    table.push(0);
    table.push(255);
  }
  return table;
}

/** Alpha for a pixel inside a block; absent means the color table's own alpha (DXT1). */
type AlphaAt = (x: number, y: number) => number;
type DxtBlock = { colors: Color[]; lookup: number; alphaAt: AlphaAt | null };

function decodeBlocks(
  width: number,
  height: number,
  blockSize: 8 | 16,
  readBlock: (offset: number) => DxtBlock,
): Buffer {
  const rgba = Buffer.alloc(width * height * 4);
  const blockWidth = Math.ceil(width / 4);
  const blockHeight = Math.ceil(height / 4);
  let source = 0;
  for (let blockY = 0; blockY < blockHeight; blockY += 1) {
    for (let blockX = 0; blockX < blockWidth; blockX += 1) {
      const { colors, lookup, alphaAt } = readBlock(source);
      source += blockSize;
      for (let localY = 0; localY < 4; localY += 1) {
        for (let localX = 0; localX < 4; localX += 1) {
          const x = blockX * 4 + localX;
          const y = blockY * 4 + localY;
          if (x >= width || y >= height) continue;
          const color = colors[(lookup >> (2 * (localY * 4 + localX))) & 0x03];
          const target = (y * width + x) * 4;
          rgba[target + 0] = color[0];
          rgba[target + 1] = color[1];
          rgba[target + 2] = color[2];
          rgba[target + 3] = alphaAt ? alphaAt(localX, localY) : color[3];
        }
      }
    }
  }
  return rgba;
}

const decodeDxt1 = (payload: Buffer, width: number, height: number) =>
  decodeBlocks(width, height, 8, (s) => ({
    colors: buildDxt1Colors(payload.readUInt16LE(s), payload.readUInt16LE(s + 2)),
    lookup: payload.readUInt32LE(s + 4),
    alphaAt: null,
  }));

const decodeDxt3 = (payload: Buffer, width: number, height: number) =>
  decodeBlocks(width, height, 16, (s) => {
    const alphaBytes = payload.subarray(s, s + 8);
    return {
      colors: buildDxt1Colors(payload.readUInt16LE(s + 8), payload.readUInt16LE(s + 10), true),
      lookup: payload.readUInt32LE(s + 12),
      alphaAt: (x, y) => {
        const pixelIndex = y * 4 + x;
        const byte = alphaBytes[Math.floor(pixelIndex / 2)];
        return (pixelIndex % 2 === 0 ? byte & 0x0f : byte >> 4) * 17;
      },
    };
  });

const decodeDxt5 = (payload: Buffer, width: number, height: number) =>
  decodeBlocks(width, height, 16, (s) => {
    const table = buildDxt5AlphaTable(payload.readUInt8(s), payload.readUInt8(s + 1));
    let selectorBits = 0n;
    for (let index = 0; index < 6; index += 1) {
      selectorBits |= BigInt(payload[s + 2 + index]) << BigInt(index * 8);
    }
    return {
      colors: buildDxt1Colors(payload.readUInt16LE(s + 8), payload.readUInt16LE(s + 10), true),
      lookup: payload.readUInt32LE(s + 12),
      alphaAt: (x, y) => table[Number((selectorBits >> BigInt((y * 4 + x) * 3)) & 0x07n)],
    };
  });

export function decodeDds(file: Buffer): Rgba {
  if (file.length < 128 || file.toString('ascii', 0, 4) !== 'DDS ') {
    throw new Error('Unsupported DDS payload');
  }
  const height = file.readUInt32LE(12);
  const width = file.readUInt32LE(16);
  const fourCC = file.toString('ascii', 84, 88).replace(/\0/g, '');
  const rgbBitCount = file.readUInt32LE(88);
  const payload = file.subarray(128);

  let rgba: Buffer;
  if (fourCC === 'DXT1') rgba = decodeDxt1(payload, width, height);
  else if (fourCC === 'DXT3') rgba = decodeDxt3(payload, width, height);
  else if (fourCC === 'DXT5') rgba = decodeDxt5(payload, width, height);
  else if (!fourCC && rgbBitCount === 32) {
    rgba = decodeBgra32(
      payload,
      width,
      height,
      file.readUInt32LE(92),
      file.readUInt32LE(96),
      file.readUInt32LE(100),
      file.readUInt32LE(104),
    );
  } else {
    throw new Error(`Unsupported DDS format: ${fourCC || 'RGBA32'}`);
  }
  return { width, height, rgba };
}

// --- Containers and index files ---

/** Walks a file of wrapped blocks (u32 original size, u32 compressed size, zlib data), inflating each. */
function* wrappedBlocks(file: Buffer): Generator<Buffer> {
  let offset = 0;
  while (offset < file.length) {
    const compressedSize = file.readUInt32LE(offset + 4);
    const start = offset + 8;
    yield unzipSync(file.subarray(start, start + compressedSize));
    offset = start + compressedSize;
  }
}

function readIndexHeader(buffer: Buffer) {
  const fileCount = buffer.readInt32LE(0);
  const mappingCount = buffer.readInt32LE(4);
  let offset = 8;
  const files: string[] = [];
  for (let index = 0; index < fileCount; index += 1) {
    const length = buffer.readInt32LE(offset);
    offset += 4;
    if (length <= 0) {
      files.push('');
      continue;
    }
    files.push(buffer.toString('latin1', offset, offset + length));
    offset += length;
  }
  return { files, mappingCount, offset };
}

// --- Sprites ---

function parseImageData(buffer: Buffer): SpriteImage {
  const partCount = buffer.readInt32LE(0);
  const width = buffer.readInt32LE(4);
  const height = buffer.readInt32LE(8);
  let offset = 12;
  const parts: SpritePart[] = [];
  for (let index = 0; index < partCount; index += 1) {
    const imageId = buffer.readUInt32LE(offset);
    offset += 4;
    const vertices: SpriteVertex[] = [];
    for (let vertexIndex = 0; vertexIndex < 4; vertexIndex += 1) {
      const f = (n: number) => buffer.readFloatLE(offset + n * 4);
      vertices.push({ x: f(0), y: f(1), z: f(2), rhw: f(3), u: f(4), v: f(5) });
      offset += 24;
    }
    parts.push({ imageId, vertices });
  }
  return { width, height, parts };
}

/** The sprite inside a TIM block, or null when the block carries no image data. */
function parseImageSet(block: Buffer): SpriteImage | null {
  const frameCount = block.readInt32LE(0);
  let offset = 4 + frameCount * 4;
  const colorKeyCount = block.readInt32LE(offset);
  offset += 4 + colorKeyCount * 8;
  offset += 4 + 1; // totalTick, format
  const imageDataSize = block.readUInt32LE(offset);
  offset += 4;
  return imageDataSize > 0 ? parseImageData(block.subarray(offset, offset + imageDataSize)) : null;
}

/** Decodes a TIS block (id, format, inner sizes, DDS or PNG, zlib'd when the size is set); null for other formats. */
function decodeSourceTexture(block: Buffer): Texture | null {
  const originalInnerSize = block.readUInt32LE(5);
  const compressedInnerSize = block.readUInt32LE(9);
  const compressed = block.subarray(13, 13 + compressedInnerSize);
  const raw = originalInnerSize > 0 ? unzipSync(compressed) : compressed;

  if (raw.length >= 4 && raw.toString('ascii', 0, 4) === 'DDS ') return decodeDds(raw);
  if (raw.length >= 4 && raw[0] === 0x89 && raw[1] === 0x50 && raw[2] === 0x4e && raw[3] === 0x47) {
    const png = PNG.sync.read(raw);
    return { width: png.width, height: png.height, rgba: Buffer.from(png.data) };
  }
  return null;
}

function blendPixel(target: Buffer, offset: number, source: number[]): void {
  const srcAlpha = source[3] / 255;
  const invAlpha = 1 - srcAlpha;
  target[offset + 0] = Math.round(source[0] * srcAlpha + target[offset + 0] * invAlpha);
  target[offset + 1] = Math.round(source[1] * srcAlpha + target[offset + 1] * invAlpha);
  target[offset + 2] = Math.round(source[2] * srcAlpha + target[offset + 2] * invAlpha);
  target[offset + 3] = Math.round(source[3] + target[offset + 3] * invAlpha);
}

function sampleNearest(source: Texture, u: number, v: number): number[] {
  const x = clamp(Math.round(u * (source.width - 1)), 0, source.width - 1);
  const y = clamp(Math.round(v * (source.height - 1)), 0, source.height - 1);
  const offset = (y * source.width + x) * 4;
  return [source.rgba[offset], source.rgba[offset + 1], source.rgba[offset + 2], source.rgba[offset + 3]];
}

function renderPart(canvas: Rgba, part: SpritePart, source: Texture): void {
  const [topLeft, topRight, bottomLeft, bottomRight] = part.vertices;
  const minX = Math.floor(Math.min(topLeft.x, topRight.x, bottomLeft.x, bottomRight.x));
  const maxX = Math.ceil(Math.max(topLeft.x, topRight.x, bottomLeft.x, bottomRight.x));
  const minY = Math.floor(Math.min(topLeft.y, topRight.y, bottomLeft.y, bottomRight.y));
  const maxY = Math.ceil(Math.max(topLeft.y, topRight.y, bottomLeft.y, bottomRight.y));
  const width = Math.max(1, topRight.x - topLeft.x);
  const height = Math.max(1, bottomLeft.y - topLeft.y);

  for (let y = minY; y < maxY; y += 1) {
    if (y < 0 || y >= canvas.height) continue;
    for (let x = minX; x < maxX; x += 1) {
      if (x < 0 || x >= canvas.width) continue;
      const tx = clamp((x - topLeft.x) / width, 0, 1);
      const ty = clamp((y - topLeft.y) / height, 0, 1);
      const uTop = topLeft.u + (topRight.u - topLeft.u) * tx;
      const uBottom = bottomLeft.u + (bottomRight.u - bottomLeft.u) * tx;
      const vTop = topLeft.v + (topRight.v - topLeft.v) * tx;
      const vBottom = bottomLeft.v + (bottomRight.v - bottomLeft.v) * tx;
      const u = uTop + (uBottom - uTop) * ty;
      const v = vTop + (vBottom - vTop) * ty;
      blendPixel(canvas.rgba, (y * canvas.width + x) * 4, sampleNearest(source, u, v));
    }
  }
}

export function composeSprite(image: SpriteImage, textures: ReadonlyMap<number, Texture>): Rgba {
  const width = Math.max(1, image.width);
  const height = Math.max(1, image.height);
  const canvas: Rgba = { width, height, rgba: Buffer.alloc(width * height * 4) };
  for (const part of image.parts) {
    const source = textures.get(part.imageId);
    if (!source || !source.rgba || !source.width || !source.height) continue;
    renderPart(canvas, part, source);
  }
  return canvas;
}

function toPng({ width, height, rgba }: Rgba): Buffer {
  const png = new PNG({ width, height });
  png.data = Buffer.from(rgba);
  return PNG.sync.write(png);
}

export function extractSprites(input: {
  imageIndex: Buffer; // Index/TClientI.IDX
  bufferList: Buffer; // Index/TClientList.LST
  readData: (relativePath: string) => Buffer; // reads under Data/, paths use backslashes
  wanted: ReadonlySet<number>;
}): Map<number, Buffer> {
  const { imageIndex, bufferList, readData, wanted } = input;
  const out = new Map<number, Buffer>();
  if (wanted.size === 0) return out;

  // Mappings are (id, fileId, pos); a later duplicate id wins, as in the Extractor.
  const header = readIndexHeader(imageIndex);
  const found = new Map<number, { fileId: number; pos: number }>();
  for (let index = 0, offset = header.offset; index < header.mappingCount; index += 1, offset += 12) {
    const id = imageIndex.readUInt32LE(offset);
    if (wanted.has(id)) {
      found.set(id, { fileId: imageIndex.readUInt32LE(offset + 4), pos: imageIndex.readUInt32LE(offset + 8) });
    }
  }

  // Read each wanted sprite's TIM block directly at its position.
  const sprites = new Map<number, SpriteImage>();
  const timFiles = new Map<number, Buffer>();
  for (const [id, { fileId, pos }] of found) {
    const name = header.files[fileId];
    if (name === undefined) continue;
    let file = timFiles.get(fileId);
    if (!file) {
      file = readData(name);
      timFiles.set(fileId, file);
    }
    const compressedSize = file.readUInt32LE(pos + 4);
    const image = parseImageSet(unzipSync(file.subarray(pos + 8, pos + 8 + compressedSize)));
    if (image) sprites.set(id, image);
  }
  if (sprites.size === 0) return out;

  const needed = new Set<number>();
  for (const sprite of sprites.values()) for (const part of sprite.parts) needed.add(part.imageId);

  // Scan the TIS files, decoding only the textures the sprites use (later duplicates win).
  const textures = new Map<number, Texture>();
  for (const name of readIndexHeader(bufferList).files) {
    for (const block of wrappedBlocks(readData(name))) {
      const textureId = block.readUInt32LE(0);
      if (!needed.has(textureId)) continue;
      const texture = decodeSourceTexture(block);
      if (texture) textures.set(textureId, texture);
    }
  }

  for (const [id, sprite] of sprites) out.set(id, toPng(composeSprite(sprite, textures)));
  return out;
}
