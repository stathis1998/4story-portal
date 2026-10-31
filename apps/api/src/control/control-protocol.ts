import type { PositionDestination } from '@4story-portal/shared';

// Wire format of the game's control server (TControlSvr, spoken by Happy).
// Source of truth: Lib\Own\TNetLib\TNetLib\Packet.cpp and the TControlSvr handlers.
// Little-endian, 16-byte header (u16 size incl. header, u16 id, 12 zero bytes) + body.

export const MSG = {
  OPLOGIN_REQ: 0x9302,
  OPLOGIN_ACK: 0x9303,
  GROUPLIST_ACK: 0x9306,
  USERMOVE_REQ: 0x932e,
  USERPOSITION_REQ: 0x9344,
} as const;

const HEADER_SIZE = 16;

export type Frame = { id: number; body: Buffer };

export class InvalidFrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidFrameError';
  }
}

export function encodeFrame(id: number, body: Buffer): Buffer {
  const frame = Buffer.alloc(HEADER_SIZE + body.length);
  frame.writeUInt16LE(frame.length, 0);
  frame.writeUInt16LE(id, 2);
  body.copy(frame, HEADER_SIZE);
  return frame;
}

export class BodyWriter {
  private parts: Buffer[] = [];

  private push(size: number, write: (b: Buffer) => void): this {
    const b = Buffer.alloc(size);
    write(b);
    this.parts.push(b);
    return this;
  }

  byte(n: number): this {
    return this.push(1, (b) => b.writeUInt8(n, 0));
  }
  word(n: number): this {
    return this.push(2, (b) => b.writeUInt16LE(n, 0));
  }
  dword(n: number): this {
    return this.push(4, (b) => b.writeUInt32LE(n, 0));
  }
  float(n: number): this {
    return this.push(4, (b) => b.writeFloatLE(n, 0));
  }
  /** int32 byte length, then the raw latin1 bytes, no terminator. */
  string(s: string): this {
    const bytes = Buffer.from(s, 'latin1');
    this.dword(bytes.length);
    this.parts.push(bytes);
    return this;
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.parts);
  }
}

/** Cuts a TCP byte stream into frames, keeping partial bytes between calls. */
export class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): Frame[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const frames: Frame[] = [];
    while (this.buffer.length >= HEADER_SIZE) {
      const size = this.buffer.readUInt16LE(0);
      if (size < HEADER_SIZE || size === 0xffff) {
        throw new InvalidFrameError(`invalid frame size ${size}`);
      }
      if (this.buffer.length < size) break;
      frames.push({
        id: this.buffer.readUInt16LE(2),
        body: Buffer.from(this.buffer.subarray(HEADER_SIZE, size)),
      });
      this.buffer = this.buffer.subarray(size);
    }
    return frames;
  }
}

export function encodeLogin(id: string, password: string): Buffer {
  return encodeFrame(MSG.OPLOGIN_REQ, new BodyWriter().string(id).string(password).toBuffer());
}

export function encodeUserMove(p: PositionDestination, names: string[]): Buffer {
  const w = new BodyWriter()
    .byte(p.world)
    .byte(p.channel)
    .word(p.mapId)
    .float(p.x)
    .float(p.y)
    .float(p.z)
    .word(names.length);
  for (const name of names) w.string(name);
  return encodeFrame(MSG.USERMOVE_REQ, w.toBuffer());
}

export function encodeUserPosition(world: number, target: string, names: string[]): Buffer {
  const w = new BodyWriter().byte(world).string(target).word(names.length);
  for (const name of names) w.string(name);
  return encodeFrame(MSG.USERPOSITION_REQ, w.toBuffer());
}

class BodyReader {
  private offset = 0;
  constructor(private readonly body: Buffer) {}

  byte(): number {
    const v = this.body.readUInt8(this.offset);
    this.offset += 1;
    return v;
  }
  dword(): number {
    const v = this.body.readUInt32LE(this.offset);
    this.offset += 4;
    return v;
  }
  string(): string {
    const len = this.body.readInt32LE(this.offset);
    this.offset += 4;
    const s = this.body.toString('latin1', this.offset, this.offset + len);
    this.offset += len;
    return s;
  }
}

export function decodeLoginAck(body: Buffer): { ok: boolean; authority: number; managerId: number } {
  const r = new BodyReader(body);
  const ret = r.byte();
  return { ok: ret === 0, authority: r.byte(), managerId: r.dword() };
}

export function decodeGroupList(body: Buffer): { id: number; name: string }[] {
  const r = new BodyReader(body);
  const count = r.dword();
  const groups: { id: number; name: string }[] = [];
  for (let i = 0; i < count; i++) groups.push({ id: r.byte(), name: r.string() });
  return groups;
}
