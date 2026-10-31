import { Logger } from '@nestjs/common';
import net from 'node:net';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ControlClient, ControlUnavailableError } from '../src/control/control-client.js';
import { FrameDecoder, MSG, encodeFrame, encodeLogin } from '../src/control/control-protocol.js';

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

  const connect = (port: number, retryDelaysMs = [20]) => {
    client = new ControlClient({ host: '127.0.0.1', port, user: 'portal', password: 'secret' }, { retryDelaysMs });
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
});
