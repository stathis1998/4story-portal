import type { PositionDestination } from '@4story-portal/shared';

// Wire format of the game's control server (TControlSvr, spoken by Happy).
// Source of truth: Lib\Own\TNetLib\TNetLib\Packet.cpp and the TControlSvr handlers.
// Little-endian, 16-byte header (u16 size incl. header, u16 id, 12 zero bytes) + body.

export const MSG = {
  OPLOGIN_REQ: 0x9302,
  OPLOGIN_ACK: 0x9303,
  GROUPLIST_ACK: 0x9306,
  USERKICKOUT_REQ: 0x932c,
  USERMOVE_REQ: 0x932e,
  USERPOSITION_REQ: 0x9344,
  AUTHORITY_ACK: 0x9330,
  EVENTCHANGE_REQ: 0x9362,
  EVENTCHANGE_ACK: 0x9363,
  EVENTLIST_REQ: 0x9364,
  EVENTLIST_ACK: 0x9365,
} as const;

export const EVENT_KIND = { DELETE: 0, ADD: 1, UPDATE: 2 } as const;
export type EventKind = (typeof EVENT_KIND)[keyof typeof EVENT_KIND];

export const EVENT_RESULT = { SUCCESS: 0, INVALID_TIME: 4 } as const;

// tagEVENTINFO, with every wire field so a listed event can be sent back unchanged.
export type ControlEvent = {
  index: number;
  type: number;
  state: number;
  groupId: number;
  serverType: number;
  serverId: number;
  /** Unix seconds. */
  start: bigint;
  end: bigint;
  value: number;
  mapId: number;
  startAlarm: number;
  endAlarm: number;
  startMessage: string;
  endMessage: string;
  title: string;
  /** 1 is one period, 0 is daily. */
  partTime: number;
  lotteryMessage: string;
  cashItems: { id: number; saleValue: number }[];
  monsterStartAction: number;
  monsterEndAction: number;
  spawnIds: number[];
  regens: { monsterId: number; delay: number; mapId: number; x: number; y: number; z: number }[];
  lottery: { itemId: number; count: number; winner: number }[];
};

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
  int64(n: bigint): this {
    return this.push(8, (b) => b.writeBigInt64LE(n, 0));
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

export function encodeUserKickout(name: string): Buffer {
  return encodeFrame(MSG.USERKICKOUT_REQ, new BodyWriter().string(name).toBuffer());
}

function writeEvent(w: BodyWriter, e: ControlEvent): void {
  w.dword(e.index)
    .byte(e.type)
    .byte(e.state)
    .byte(e.groupId)
    .byte(e.serverType)
    .byte(e.serverId)
    .int64(e.start)
    .int64(e.end)
    .word(e.value)
    .word(e.mapId)
    .dword(e.startAlarm)
    .dword(e.endAlarm)
    .string(e.startMessage)
    .string(e.endMessage)
    .string(e.title)
    .byte(e.partTime)
    .string(e.lotteryMessage)
    .word(e.cashItems.length);
  for (const item of e.cashItems) w.word(item.id).byte(item.saleValue);
  w.byte(e.monsterStartAction).byte(e.monsterEndAction).word(e.spawnIds.length);
  for (const id of e.spawnIds) w.word(id);
  w.word(e.regens.length);
  for (const r of e.regens) w.word(r.monsterId).dword(r.delay).word(r.mapId).float(r.x).float(r.y).float(r.z);
  w.word(e.lottery.length);
  for (const l of e.lottery) w.word(l.itemId).byte(l.count).word(l.winner);
}

export function encodeEventChange(kind: EventKind, event: ControlEvent): Buffer {
  const w = new BodyWriter().byte(kind);
  writeEvent(w, event);
  return encodeFrame(MSG.EVENTCHANGE_REQ, w.toBuffer());
}

export function encodeEventList(): Buffer {
  return encodeFrame(MSG.EVENTLIST_REQ, Buffer.alloc(0));
}

class BodyReader {
  private offset = 0;
  constructor(private readonly body: Buffer) {}

  byte(): number {
    const v = this.body.readUInt8(this.offset);
    this.offset += 1;
    return v;
  }
  word(): number {
    const v = this.body.readUInt16LE(this.offset);
    this.offset += 2;
    return v;
  }
  dword(): number {
    const v = this.body.readUInt32LE(this.offset);
    this.offset += 4;
    return v;
  }
  float(): number {
    const v = this.body.readFloatLE(this.offset);
    this.offset += 4;
    return v;
  }
  int64(): bigint {
    const v = this.body.readBigInt64LE(this.offset);
    this.offset += 8;
    return v;
  }
  string(): string {
    const len = this.body.readInt32LE(this.offset);
    this.offset += 4;
    if (len < 0 || this.offset + len > this.body.length) throw new RangeError('string length out of range');
    const s = this.body.toString('latin1', this.offset, this.offset + len);
    this.offset += len;
    return s;
  }
}

function repeat<T>(count: number, read: () => T): T[] {
  const items: T[] = [];
  for (let i = 0; i < count; i++) items.push(read());
  return items;
}

function readEvent(r: BodyReader): ControlEvent {
  return {
    index: r.dword(),
    type: r.byte(),
    state: r.byte(),
    groupId: r.byte(),
    serverType: r.byte(),
    serverId: r.byte(),
    start: r.int64(),
    end: r.int64(),
    value: r.word(),
    mapId: r.word(),
    startAlarm: r.dword(),
    endAlarm: r.dword(),
    startMessage: r.string(),
    endMessage: r.string(),
    title: r.string(),
    partTime: r.byte(),
    lotteryMessage: r.string(),
    cashItems: repeat(r.word(), () => ({ id: r.word(), saleValue: r.byte() })),
    monsterStartAction: r.byte(),
    monsterEndAction: r.byte(),
    spawnIds: repeat(r.word(), () => r.word()),
    regens: repeat(r.word(), () => ({
      monsterId: r.word(),
      delay: r.dword(),
      mapId: r.word(),
      x: r.float(),
      y: r.float(),
      z: r.float(),
    })),
    lottery: repeat(r.word(), () => ({ itemId: r.word(), count: r.byte(), winner: r.word() })),
  };
}

export function decodeEventList(body: Buffer): ControlEvent[] {
  const r = new BodyReader(body);
  return repeat(r.word(), () => readEvent(r));
}

export function decodeEventChangeAck(body: Buffer): { result: number; kind: number; event: ControlEvent } {
  const r = new BodyReader(body);
  return { result: r.byte(), kind: r.byte(), event: readEvent(r) };
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
