import { describe, expect, it } from 'vitest';
import {
  FrameDecoder,
  InvalidFrameError,
  MSG,
  decodeGroupList,
  decodeLoginAck,
  encodeFrame,
  encodeLogin,
  encodeUserMove,
  encodeUserKickout,
  encodeUserPosition,
} from '../src/control/control-protocol.js';

const hex = (s: string) => Buffer.from(s.replace(/ /g, ''), 'hex');

describe('control protocol encoding', () => {
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
