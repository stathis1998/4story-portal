import { describe, expect, it } from 'vitest';
import {
  type ControlEvent,
  EVENT_KIND,
  EVENT_RESULT,
  FrameDecoder,
  InvalidFrameError,
  MSG,
  decodeEventChangeAck,
  decodeEventList,
  decodeGroupList,
  decodeLoginAck,
  encodeEventChange,
  encodeEventList,
  encodeFrame,
  encodeAnnouncement,
  encodeLogin,
  encodeUserMove,
  encodeUserKickout,
  encodeUserPosition,
} from '../src/control/control-protocol.js';

const hex = (s: string) => Buffer.from(s.replace(/ /g, ''), 'hex');
const text = (s: string) => {
  const length = Buffer.alloc(4);
  length.writeUInt32LE(s.length);
  return Buffer.concat([length, Buffer.from(s, 'latin1')]);
};

const plainEvent: ControlEvent = {
  index: 0,
  type: 1,
  state: 0,
  groupId: 1,
  serverType: 3,
  serverId: 0,
  start: 1793988000n,
  end: 1794178800n,
  value: 100,
  mapId: 255,
  startAlarm: 0,
  endAlarm: 1,
  startMessage: 'On',
  endMessage: 'Off',
  title: 'Weekend',
  partTime: 1,
  lotteryMessage: '',
  cashItems: [],
  monsterStartAction: 0,
  monsterEndAction: 0,
  spawnIds: [],
  regens: [],
  lottery: [],
};

// The same fields in the order of tagEVENTINFO::WrapPacketIn (TControlType.h).
const plainEventBytes = Buffer.concat([
  hex('00000000 01 00 01 03 00'),
  hex('A015EE6A00000000'),
  hex('F0FEF06A00000000'),
  hex('6400 FF00 00000000 01000000'),
  text('On'),
  text('Off'),
  text('Weekend'),
  hex('01'),
  text(''),
  hex('0000 00 00 0000 0000 0000'),
]);

// A monster spawn event carrying every special field.
const specialEventBytes = Buffer.concat([
  hex('07000000 0C 01 00 03 00'),
  hex('A015EE6A00000000'),
  hex('F0FEF06A00000000'),
  hex('0100 2C01 05000000 0A000000'),
  text('Spawning'),
  text('Done'),
  text('Boss night'),
  hex('00'),
  text('Winner|Well done'),
  hex('0200 3930 32 3A30 0F'),
  hex('00 07 0200 6400 C800'),
  hex('0100 2A00 60EA0000 5802 00002F45 00004842 00409C45'),
  hex('0100 B90B 03 0500'),
]);

describe('control protocol events', () => {
  it('encodes CT_EVENTCHANGE_REQ with the kind first, then the C++ field order', () => {
    const frame = encodeEventChange(EVENT_KIND.ADD, plainEvent);
    expect(frame.readUInt16LE(2)).toBe(0x9362);
    expect(frame.subarray(16)).toEqual(Buffer.concat([hex('01'), plainEventBytes]));
  });

  it('encodes an empty CT_EVENTLIST_REQ', () => {
    expect(encodeEventList()).toEqual(hex('10006493000000000000000000000000'));
  });

  it('decodes CT_EVENTLIST_ACK, every special field included', () => {
    const events = decodeEventList(Buffer.concat([hex('0200'), plainEventBytes, specialEventBytes]));

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual(plainEvent);
    expect(events[1]).toEqual({
      index: 7,
      type: 12,
      state: 1,
      groupId: 0,
      serverType: 3,
      serverId: 0,
      start: 1793988000n,
      end: 1794178800n,
      value: 1,
      mapId: 300,
      startAlarm: 5,
      endAlarm: 10,
      startMessage: 'Spawning',
      endMessage: 'Done',
      title: 'Boss night',
      partTime: 0,
      lotteryMessage: 'Winner|Well done',
      cashItems: [
        { id: 12345, saleValue: 50 },
        { id: 12346, saleValue: 15 },
      ],
      monsterStartAction: 0,
      monsterEndAction: 7,
      spawnIds: [100, 200],
      regens: [{ monsterId: 42, delay: 60000, mapId: 600, x: 2800, y: 50, z: 5000 }],
      lottery: [{ itemId: 3001, count: 3, winner: 5 }],
    });
  });

  it('sends a special event back byte for byte', () => {
    const [event] = decodeEventList(Buffer.concat([hex('0100'), specialEventBytes]));
    expect(encodeEventChange(EVENT_KIND.DELETE, event).subarray(16)).toEqual(Buffer.concat([hex('00'), specialEventBytes]));
  });

  it('decodes CT_EVENTCHANGE_ACK', () => {
    const ack = decodeEventChangeAck(Buffer.concat([hex('04 02'), plainEventBytes]));
    expect(ack).toEqual({ result: 4, kind: 2, event: plainEvent });
    expect(EVENT_RESULT.INVALID_TIME).toBe(4);
  });

  it('keeps Latin-1 text intact in both directions', () => {
    const event = { ...plainEvent, title: 'Événement' };
    const [decoded] = decodeEventList(
      Buffer.concat([hex('0100'), encodeEventChange(EVENT_KIND.ADD, event).subarray(17)]),
    );
    expect(decoded.title).toBe('Événement');
  });

  it('throws on a truncated event', () => {
    expect(() => decodeEventList(Buffer.concat([hex('0100'), plainEventBytes.subarray(0, 20)]))).toThrow(RangeError);
    expect(() => decodeEventList(Buffer.concat([hex('0200'), plainEventBytes]))).toThrow(RangeError);
  });
});

describe('control protocol encoding', () => {
  it('encodes CT_ANNOUNCEMENT_REQ as the world, then the text', () => {
    const frame = encodeAnnouncement(0, 'Kaelith completed Slayer III');
    expect(frame.readUInt16LE(0)).toBe(16 + 4 + 4 + 28);
    expect(frame.readUInt16LE(2)).toBe(0x932a);
    expect(frame.subarray(16)).toEqual(Buffer.concat([hex('00000000'), text('Kaelith completed Slayer III')]));
  });

  it('can address one world', () => {
    expect(encodeAnnouncement(1, 'Hi').subarray(16, 20)).toEqual(hex('01000000'));
  });

  it('encodes CT_USERKICKOUT_REQ as the bare character name', () => {
    const frame = encodeUserKickout('Kaelith');
    expect(frame.readUInt16LE(0)).toBe(27);
    expect(frame.readUInt16LE(2)).toBe(0x932c);
    expect(frame.subarray(16)).toEqual(Buffer.concat([hex('07000000'), Buffer.from('Kaelith', 'latin1')]));
  });

  it('encodes CT_USERMOVE_REQ byte-exact (spec reference frame)', () => {
    const frame = encodeUserMove({ world: 1, channel: 1, mapId: 0, x: 2800, y: 50, z: 5000 }, ['mrdkos']);
    expect(frame).toEqual(
      hex('2C002E93000000000000000000000000 0101 0000 00002F45 00004842 0040 9C45 0100 06000000 6D72646B6F73'),
    );
  });

  it('encodes CT_OPLOGIN_REQ', () => {
    const frame = encodeLogin('portal', 'pw');
    expect(frame.length).toBe(32);
    expect(frame.subarray(0, 4)).toEqual(hex('20000293'));
    expect(frame.subarray(16)).toEqual(hex('06000000' + Buffer.from('portal').toString('hex') + '02000000' + Buffer.from('pw').toString('hex')));
  });

  it('encodes CT_USERPOSITION_REQ', () => {
    const frame = encodeUserPosition(1, 'Moosey', ['Kaelith']);
    expect(frame.readUInt16LE(0)).toBe(40);
    expect(frame.readUInt16LE(2)).toBe(MSG.USERPOSITION_REQ);
    const expected = Buffer.concat([
      hex('01 06000000'),
      Buffer.from('Moosey', 'latin1'),
      hex('0100 07000000'),
      Buffer.from('Kaelith', 'latin1'),
    ]);
    expect(frame.subarray(16)).toEqual(expected);
  });
});

describe('FrameDecoder', () => {
  const a = encodeFrame(0x9303, hex('00 03 07000000'));
  const b = encodeFrame(0x9306, hex('01000000 00 06000000') );
  const joined = Buffer.concat([a, b]);

  it('yields both frames in order when split mid-header and mid-body', () => {
    const d = new FrameDecoder();
    const out = [
      ...d.push(joined.subarray(0, 5)),
      ...d.push(joined.subarray(5, 21)),
      ...d.push(joined.subarray(21)),
    ];
    expect(out).toEqual([
      { id: 0x9303, body: a.subarray(16) },
      { id: 0x9306, body: b.subarray(16) },
    ]);
  });

  it('yields both frames from a single chunk', () => {
    expect(new FrameDecoder().push(joined)).toHaveLength(2);
  });

  it('throws on a size below 16', () => {
    const bad = Buffer.alloc(16);
    bad.writeUInt16LE(15, 0);
    expect(() => new FrameDecoder().push(bad)).toThrow(InvalidFrameError);
  });

  it('throws on size 0xFFFF', () => {
    const bad = Buffer.alloc(16);
    bad.writeUInt16LE(0xffff, 0);
    expect(() => new FrameDecoder().push(bad)).toThrow(InvalidFrameError);
  });

  it('does not throw on a partial header', () => {
    expect(new FrameDecoder().push(Buffer.from([0x01, 0x00, 0x00]))).toEqual([]);
  });
});

describe('decoders', () => {
  it('decodes the group list', () => {
    const body = Buffer.concat([
      hex('02000000 00 06000000'),
      Buffer.from('Global'),
      hex('01 07000000'),
      Buffer.from('Lapiris'),
    ]);
    expect(decodeGroupList(body)).toEqual([
      { id: 0, name: 'Global' },
      { id: 1, name: 'Lapiris' },
    ]);
  });

  it('decodes the login ack', () => {
    expect(decodeLoginAck(hex('00 03 07000000'))).toEqual({ ok: true, authority: 3, managerId: 7 });
    expect(decodeLoginAck(hex('01 00 00000000')).ok).toBe(false);
  });

  it.each([
    ['negative', 'FFFFFFFF'],
    ['past the end', '09000000'],
  ])('rejects a group list string length that is %s', (_label, length) => {
    const body = Buffer.concat([hex('01000000 00'), hex(length), Buffer.from('abc')]);
    expect(() => decodeGroupList(body)).toThrow(RangeError);
  });
});
