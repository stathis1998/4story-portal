import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ControlClient, ControlRefusedError, ControlUnavailableError } from '../control/control-client.js';
import { ANNOUNCE_SKIPPED, ANNOUNCE_WAITING, WHEEL_REPOSITORY, type WheelRepository } from './wheel.repository.js';

export type AnnouncerTiming = {
  /** How often to look. 0 never starts the timer: tests call tick() themselves. */
  intervalMs: number;
  /** The wheel on the player's screen is still turning: saying the win sooner would spoil it. */
  delaySeconds: number;
  /** Old news isn't worth interrupting chat for. */
  maxAgeSeconds: number;
};

export const ANNOUNCER_TIMING = Symbol('WHEEL_ANNOUNCER_TIMING');
export const DEFAULT_ANNOUNCER_TIMING: AnnouncerTiming = { intervalMs: 5000, delaySeconds: 15, maxAgeSeconds: 10 * 60 };

// Says the big wins in game, a little after the spin. Each one is claimed in the database before it
// is sent, so two ticks or two portal processes never both say it.
@Injectable()
export class WheelAnnouncer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WheelAnnouncer.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  // A database without the wheel's tables fails every look: say so once, not every few seconds.
  private failing = false;

  constructor(
    @Inject(WHEEL_REPOSITORY) private readonly repo: WheelRepository,
    private readonly control: ControlClient,
    @Inject(ANNOUNCER_TIMING) private readonly timing: AnnouncerTiming,
  ) {}

  onModuleInit(): void {
    if (this.timing.intervalMs <= 0) return;
    this.timer = setInterval(() => void this.tick(), this.timing.intervalMs);
    // Never the reason the process stays up.
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** How many wins were announced. */
  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const announced = await this.announceWaiting();
      this.failing = false;
      return announced;
    } catch (error) {
      if (!this.failing) this.logger.warn(`Wheel announcements failed: ${error instanceof Error ? error.message : error}`);
      this.failing = true;
      return 0;
    } finally {
      this.running = false;
    }
  }

  private async announceWaiting(): Promise<number> {
    let announced = 0;
    for (const spin of await this.repo.waitingAnnouncements()) {
      if (spin.ageSeconds < this.timing.delaySeconds) continue;
      if (spin.ageSeconds > this.timing.maxAgeSeconds) {
        await this.repo.markAnnounced(spin.id, ANNOUNCE_SKIPPED);
        continue;
      }
      if (!(await this.repo.claimAnnouncement(spin.id))) continue;
      try {
        this.control.announce(spin.text);
      } catch (error) {
        await this.repo.markAnnounced(spin.id, ANNOUNCE_WAITING);
        // Left waiting: a later tick sends them, or skips them once they are old.
        if (error instanceof ControlUnavailableError || error instanceof ControlRefusedError) return announced;
        throw error;
      }
      announced++;
    }
    return announced;
  }
}
