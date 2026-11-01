import { Logger } from '@nestjs/common';
import net from 'node:net';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ControlBadReplyError,
  ControlClient,
  ControlRefusedError,
  ControlTimeoutError,
  ControlUnavailableError,
} from '../src/control/control-client.js';
import {
  type ControlEvent,
  EVENT_KIND,
  type Frame,
  FrameDecoder,
  MSG,
  decodeEventChangeAck,
  encodeEventChange,
  encodeEventList,
  encodeFrame,
  encodeLogin,
  encodeUserKickout,
} from '../src/control/control-protocol.js';

const hex = (s: string) => Buffer.from(s.replace(/ /g, ''), 'hex');
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const LOGIN_OK = encodeFrame(MSG.OPLOGIN_ACK, hex('00 03 07000000'));
const LOGIN_FAILED = encodeFrame(MSG.OPLOGIN_ACK, hex('01 00 00000000'));
const GROUP_LIST = encodeFrame(
  MSG.GROUPLIST_ACK,
  Buffer.concat([hex('02000000 00 06000000'), Buffer.from('Global'), hex('01 07000000'), Buffer.from('Lapiris')]),
);
const SERVICE_DATA = encodeFrame(0x9321, Buffer.alloc(44));

type FakeServer = {
  port: number;
  connections: number;
  logins: number;
  /** Raw bytes received, one buffer per connection. */
  received: Buffer[];
  close(): Promise<void>;
};

// A stand-in TControlSvr: counts connections and logins and hands each OPLOGIN_REQ to onLogin.
// The default reply is a successful login followed by the group list and a status packet.
async function startFakeServer(
  onLogin: (socket: net.Socket, login: number) => void = (socket) => {
    socket.write(Buffer.concat([LOGIN_OK, GROUP_LIST]));
    socket.write(SERVICE_DATA);
  },
  onFrame?: (socket: net.Socket, frame: Frame) => void,
): Promise<FakeServer> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    const index = fake.connections++;
    fake.received[index] = Buffer.alloc(0);
    const decoder = new FrameDecoder();
    socket.on('data', (chunk) => {
      fake.received[index] = Buffer.concat([fake.received[index], chunk]);
      for (const frame of decoder.push(chunk)) {
        if (frame.id === MSG.OPLOGIN_REQ) onLogin(socket, ++fake.logins);
        else onFrame?.(socket, frame);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const fake: FakeServer = {
    port: (server.address() as net.AddressInfo).port,
    connections: 0,
    logins: 0,
    received: [],
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
  return fake;
}

describe('ControlClient', () => {
  let server: FakeServer | undefined;
  let client: ControlClient | undefined;

  beforeAll(() => Logger.overrideLogger(false));

  afterEach(async () => {
    await client?.stop();
    await server?.close();
    client = undefined;
    server = undefined;
  });

  const connect = (port: number, retryDelaysMs = [20], requestTimeoutMs = 150) => {
    client = new ControlClient(
      { host: '127.0.0.1', port, user: 'portal', password: 'secret' },
      { retryDelaysMs, requestTimeoutMs },
    );
    client.start();
    return client;
  };

  it('logs in and reports the worlds, skipping group 0 and unsolicited frames', async () => {
    server = await startFakeServer();
    const c = connect(server.port);

    await vi.waitFor(() => expect(c.status()).toEqual({ state: 'connected', worlds: [{ id: 1, name: 'Lapiris' }] }));
    expect(server.received[0]).toEqual(encodeLogin('portal', 'secret'));
  });

  it('sends the teleport frame byte-exact', async () => {
    server = await startFakeServer();
    const c = connect(server.port);
    await vi.waitFor(() => expect(c.status().state).toBe('connected'));

    c.moveToPosition({ world: 1, channel: 1, mapId: 0, x: 2800, y: 50, z: 5000 }, ['mrdkos']);

    const reference = hex('2C002E93000000000000000000000000 0101 0000 00002F45 00004842 0040 9C45 0100 06000000 6D72646B6F73');
    await vi.waitFor(() => expect(server!.received[0]).toEqual(Buffer.concat([encodeLogin('portal', 'secret'), reference])));
  });

  it('sends the kick frame', async () => {
    server = await startFakeServer();
    const c = connect(server.port);
    await vi.waitFor(() => expect(c.status().state).toBe('connected'));

    c.kick('Kaelith');

    await vi.waitFor(() =>
      expect(server!.received[0]).toEqual(Buffer.concat([encodeLogin('portal', 'secret'), encodeUserKickout('Kaelith')])),
    );
  });

  it('warns when the portal manager authority is too low for teleports', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    server = await startFakeServer((socket) => socket.write(encodeFrame(MSG.OPLOGIN_ACK, hex('00 07 07000000'))));
    const c = connect(server.port);

    await vi.waitFor(() => expect(c.status().state).toBe('connected'));
    expect(warn).toHaveBeenCalledWith('portal manager authority 7 is too low for teleports (needs 1-6)');
    warn.mockRestore();
  });

  it('warns when the portal manager authority is too low to list events', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    server = await startFakeServer((socket) => socket.write(encodeFrame(MSG.OPLOGIN_ACK, hex('00 04 07000000'))));
    const c = connect(server.port);

    await vi.waitFor(() => expect(c.status().state).toBe('connected'));
    expect(warn).toHaveBeenCalledWith('portal manager authority 4 is too low for events (needs 1-3)');
    warn.mockRestore();
  });

  it('stops on a failed login without retrying', async () => {
    server = await startFakeServer((socket) => socket.write(LOGIN_FAILED));
    const c = connect(server.port);

    await vi.waitFor(() => expect(c.status().state).toBe('login-failed'));
    await delay(100);
    expect(server.connections).toBe(1);
  });

  it('reconnects and logs in again after the server drops the connection', async () => {
    let releaseSecondLogin = () => {};
    server = await startFakeServer((socket, login) => {
      if (login === 1) {
        socket.write(LOGIN_OK);
        socket.destroy();
      } else {
        releaseSecondLogin = () => socket.write(LOGIN_OK);
      }
    });
    const c = connect(server.port);

    await vi.waitFor(() => expect(server!.logins).toBe(2));
    expect(c.status().state).toBe('disconnected');
    releaseSecondLogin();
    await vi.waitFor(() => expect(c.status().state).toBe('connected'));
    expect(server.logins).toBe(2);
  });

  it('reports connecting before the first attempt completes and disconnected when the server is down', async () => {
    const closed = await startFakeServer();
    const port = closed.port;
    await closed.close();

    const c = connect(port);
    expect(c.status()).toEqual({ state: 'connecting', worlds: [] });
    await vi.waitFor(() => expect(c.status().state).toBe('disconnected'));
  });

  it('drops the connection on an invalid frame and reconnects', async () => {
    const bad = Buffer.alloc(16);
    bad.writeUInt16LE(15, 0);
    server = await startFakeServer((socket, login) => socket.write(login === 1 ? bad : LOGIN_OK));
    const c = connect(server.port);

    await vi.waitFor(() => expect(c.status().state).toBe('connected'));
    expect(server.connections).toBe(2);
  });

  it('drops the connection on a truncated login ack and reconnects', async () => {
    const truncated = encodeFrame(MSG.OPLOGIN_ACK, hex('00'));
    server = await startFakeServer((socket, login) => socket.write(login === 1 ? truncated : LOGIN_OK));
    const c = connect(server.port);

    await vi.waitFor(() => expect(c.status().state).toBe('connected'));
    expect(server.connections).toBe(2);
  });

  it('refuses to move while not connected', () => {
    client = new ControlClient({ host: '127.0.0.1', port: 1, user: 'portal', password: 'secret' });

    expect(() => client!.moveToCharacter(1, 'Moosey', ['Kaelith'])).toThrow(ControlUnavailableError);
    expect(() => client!.kick('Kaelith')).toThrow(ControlUnavailableError);
    expect(() => client!.moveToPosition({ world: 1, channel: 1, mapId: 0, x: 1, y: 1, z: 1 }, ['a'])).toThrow(
      ControlUnavailableError,
    );
  });

  it('stop() cancels the pending reconnect', async () => {
    server = await startFakeServer((socket) => socket.destroy());
    // A longer delay than the other tests, so stop() lands while the retry timer is pending.
    const c = connect(server.port, [100]);
    await vi.waitFor(() => expect(c.status().state).toBe('disconnected'), { interval: 5 });

    await c.stop();
    await delay(150);
    expect(server.connections).toBe(1);
  });

  describe('event requests', () => {
    const event = (overrides: Partial<ControlEvent> = {}): ControlEvent => ({
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
      ...overrides,
    });

    const eventBytes = (e: ControlEvent) => encodeEventChange(EVENT_KIND.ADD, e).subarray(17);
    const listAck = (...events: ControlEvent[]) => {
      const count = Buffer.alloc(2);
      count.writeUInt16LE(events.length);
      return encodeFrame(MSG.EVENTLIST_ACK, Buffer.concat([count, ...events.map(eventBytes)]));
    };
    const changeAck = (result: number, kind: number, e: ControlEvent) =>
      encodeFrame(MSG.EVENTCHANGE_ACK, Buffer.concat([Buffer.from([result, kind]), eventBytes(e)]));

    const connected = async (onFrame: (socket: net.Socket, frame: Frame) => void) => {
      server = await startFakeServer(undefined, onFrame);
      const c = connect(server.port);
      await vi.waitFor(() => expect(c.status().state).toBe('connected'));
      return c;
    };

    it('lists events', async () => {
      const c = await connected((socket, frame) => {
        if (frame.id === MSG.EVENTLIST_REQ) socket.write(listAck(event({ index: 4 })));
      });

      expect(await c.listEvents()).toEqual([event({ index: 4 })]);
      expect(server!.received[0].subarray(-16)).toEqual(encodeEventList());
    });

    it('sends a change and returns the result with the index the server assigned', async () => {
      const c = await connected((socket, frame) => {
        if (frame.id !== MSG.EVENTCHANGE_REQ) return;
        const sent = decodeEventChangeAck(Buffer.concat([Buffer.alloc(1), frame.body])).event;
        socket.write(changeAck(0, EVENT_KIND.ADD, { ...sent, index: 9 }));
      });

      expect(await c.changeEvent(EVENT_KIND.ADD, event())).toEqual({ result: 0, event: event({ index: 9 }) });
    });

    it('ignores other frames while waiting', async () => {
      const c = await connected((socket, frame) => {
        if (frame.id === MSG.EVENTLIST_REQ) socket.write(Buffer.concat([SERVICE_DATA, listAck()]));
      });

      expect(await c.listEvents()).toEqual([]);
    });

    it('sends one request at a time', async () => {
      const seen: number[] = [];
      let answerFirst = () => {};
      const c = await connected((socket, frame) => {
        seen.push(frame.id);
        if (seen.length === 1) answerFirst = () => socket.write(listAck());
        else socket.write(changeAck(0, EVENT_KIND.ADD, event()));
      });

      const first = c.listEvents();
      const second = c.changeEvent(EVENT_KIND.ADD, event());
      await delay(30);
      expect(seen).toEqual([MSG.EVENTLIST_REQ]);

      answerFirst();
      await first;
      await second;
      expect(seen).toEqual([MSG.EVENTLIST_REQ, MSG.EVENTCHANGE_REQ]);
    });

    it('does not take a reply to a different change', async () => {
      const c = await connected((socket, frame) => {
        if (frame.id === MSG.EVENTCHANGE_REQ) socket.write(changeAck(0, EVENT_KIND.ADD, event({ title: 'Older' })));
      });

      await expect(c.changeEvent(EVENT_KIND.ADD, event())).rejects.toThrow(ControlTimeoutError);
    });

    it('does not take a late reply as the answer to the next change', async () => {
      const replies: (() => void)[] = [];
      const c = await connected((socket, frame) => {
        if (frame.id !== MSG.EVENTCHANGE_REQ) return;
        const late = replies.length === 0;
        replies.push(() =>
          socket.write(changeAck(late ? 4 : 0, EVENT_KIND.ADD, event({ title: late ? 'First' : 'Second' }))),
        );
      });

      await expect(c.changeEvent(EVENT_KIND.ADD, event({ title: 'First' }))).rejects.toThrow(ControlTimeoutError);
      const second = c.changeEvent(EVENT_KIND.ADD, event({ title: 'Second' }));
      await vi.waitFor(() => expect(replies).toHaveLength(2));

      replies[0]();
      replies[1]();
      expect((await second).result).toBe(0);
    });

    it('times out with no reply and moves on to the next request', async () => {
      let calls = 0;
      const c = await connected((socket) => {
        if (++calls === 2) socket.write(listAck());
      });

      await expect(c.listEvents()).rejects.toThrow(ControlTimeoutError);
      await expect(c.listEvents()).resolves.toEqual([]);
    });

    it('rejects the waiting and queued requests at once when the connection drops', async () => {
      const c = await connected((socket) => socket.destroy());

      const started = Date.now();
      const results = await Promise.allSettled([c.listEvents(), c.listEvents()]);

      expect(results.map((r) => r.status === 'rejected' && r.reason)).toEqual([
        expect.any(ControlUnavailableError),
        expect.any(ControlUnavailableError),
      ]);
      expect(Date.now() - started).toBeLessThan(100);
    });

    it('rejects while not connected', async () => {
      client = new ControlClient({ host: '127.0.0.1', port: 1, user: 'portal', password: 'secret' });

      await expect(client.listEvents()).rejects.toThrow(ControlUnavailableError);
      await expect(client.changeEvent(EVENT_KIND.ADD, event())).rejects.toThrow(ControlUnavailableError);
    });

    it('rejects a waiting request when the server refuses the authority', async () => {
      const c = await connected((socket) => socket.write(encodeFrame(MSG.AUTHORITY_ACK, Buffer.alloc(0))));

      await expect(c.listEvents()).rejects.toThrow(ControlRefusedError);
    });

    it('ignores an authority refusal when nothing is waiting', async () => {
      const refused = encodeFrame(MSG.AUTHORITY_ACK, Buffer.alloc(0));
      const c = await connected((socket, frame) => {
        if (frame.id === MSG.USERKICKOUT_REQ) socket.write(refused);
        else socket.write(listAck());
      });

      c.kick('Kaelith');
      await delay(30);
      expect(c.status().state).toBe('connected');
      await expect(c.listEvents()).resolves.toEqual([]);
    });

    it('rejects an unreadable reply and keeps the connection', async () => {
      let calls = 0;
      const c = await connected((socket) => {
        socket.write(++calls === 1 ? encodeFrame(MSG.EVENTLIST_ACK, hex('0100 00')) : listAck());
      });

      await expect(c.listEvents()).rejects.toThrow(ControlBadReplyError);
      expect(c.status().state).toBe('connected');
      expect(server!.connections).toBe(1);
      await expect(c.listEvents()).resolves.toEqual([]);
    });

    it('rejects a waiting request on stop()', async () => {
      const c = await connected(() => undefined);

      const pending = c.listEvents();
      await delay(10);
      await c.stop();

      await expect(pending).rejects.toThrow(ControlUnavailableError);
    });
  });
});
