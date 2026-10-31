import type { ControlState, PositionDestination } from '@4story-portal/shared';
import { Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import net from 'node:net';
import type { AppConfig } from '../config/config.js';
import {
  FrameDecoder,
  MSG,
  decodeGroupList,
  decodeLoginAck,
  encodeLogin,
  encodeUserMove,
  encodeUserPosition,
  type Frame,
} from './control-protocol.js';

const DEFAULT_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000];

export class ControlUnavailableError extends Error {
  constructor() {
    super('The control server is not connected');
    this.name = 'ControlUnavailableError';
  }
}

// Keeps one logged-in connection to TControlSvr. It reconnects with backoff after a disconnect,
// but not after a refused login: that needs a config fix and an API restart.
export class ControlClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('ControlClient');
  private readonly retryDelaysMs: number[];
  private state: ControlState = 'connecting';
  private worlds: { id: number; name: string }[] = [];
  // Only events from this socket count; late events from a replaced or stopped socket are ignored.
  private socket: net.Socket | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private retryIndex = 0;
  private stopped = false;

  constructor(
    private readonly config: AppConfig['control'],
    options: { retryDelaysMs?: number[] } = {},
  ) {
    this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  }

  onModuleInit(): void {
    this.start();
  }

  onModuleDestroy(): Promise<void> {
    return this.stop();
  }

  start(): void {
    this.stopped = false;
    if (this.socket || this.retryTimer) return;
    this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const socket = this.socket;
    this.socket = null;
    socket?.destroy();
    if (this.state !== 'login-failed') this.setState('disconnected');
  }

  status(): { state: ControlState; worlds: { id: number; name: string }[] } {
    return { state: this.state, worlds: this.worlds };
  }

  moveToPosition(p: PositionDestination, names: string[]): void {
    this.connectedSocket().write(encodeUserMove(p, names));
  }

  moveToCharacter(world: number, target: string, names: string[]): void {
    this.connectedSocket().write(encodeUserPosition(world, target, names));
  }

  private connectedSocket(): net.Socket {
    if (this.state !== 'connected' || !this.socket) throw new ControlUnavailableError();
    return this.socket;
  }

  private connect(): void {
    this.retryTimer = null;
    // A fresh decoder per connection: one that threw keeps the bad bytes.
    const decoder = new FrameDecoder();
    const socket = net.createConnection({ host: this.config.host, port: this.config.port });
    this.socket = socket;
    let reason = 'connection closed';

    socket.setKeepAlive(true);
    socket.on('connect', () => {
      if (this.socket === socket) socket.write(encodeLogin(this.config.user, this.config.password));
    });
    socket.on('data', (chunk: Buffer) => {
      try {
        for (const frame of decoder.push(chunk)) {
          if (this.socket !== socket) return;
          this.handleFrame(socket, frame);
        }
      } catch (error) {
        // An invalid frame, or a known frame too short to decode.
        reason = `bad frame: ${(error as Error).message}`;
        socket.destroy();
      }
    });
    // Always listened to, so a socket error never becomes an uncaught exception; 'close' follows it.
    socket.on('error', (error) => {
      reason = error.message;
    });
    socket.on('close', () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.setState('disconnected', reason);
      this.scheduleRetry();
    });
  }

  private handleFrame(socket: net.Socket, frame: Frame): void {
    if (frame.id === MSG.OPLOGIN_ACK) {
      const ack = decodeLoginAck(frame.body);
      if (ack.ok) {
        this.retryIndex = 0;
        this.setState('connected', `authority ${ack.authority}`);
        if (ack.authority > 6) {
          this.logger.warn(`portal manager authority ${ack.authority} is too low for teleports (needs 1-6)`);
        }
      } else {
        this.socket = null;
        socket.destroy();
        this.setState('login-failed', 'TControlSvr refused CONTROL_USER / CONTROL_PASSWORD');
      }
    } else if (frame.id === MSG.GROUPLIST_ACK) {
      this.worlds = decodeGroupList(frame.body).filter((group) => group.id !== 0);
    }
  }

  private scheduleRetry(): void {
    if (this.stopped || this.retryTimer) return;
    const delay = this.retryDelaysMs[Math.min(this.retryIndex, this.retryDelaysMs.length - 1)];
    this.retryIndex++;
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  private setState(state: ControlState, detail?: string): void {
    if (state === this.state) return;
    this.state = state;
    if (state !== 'connected') this.worlds = [];
    const message = `TControlSvr ${state}${detail ? ` (${detail})` : ''}`;
    if (state === 'login-failed') this.logger.error(message);
    else if (state === 'disconnected') this.logger.warn(message);
    else this.logger.log(message);
  }
}
