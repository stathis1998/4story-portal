import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ControlClient, ControlRefusedError, ControlUnavailableError } from '../control/control-client.js';
import { ANNOUNCE_SKIPPED, ANNOUNCE_WAITING, REBIRTH_REPOSITORY, type RebirthRepository } from './rebirth.repository.js';

export type RebirthAnnouncerTiming = {
  /** How often to look. 0 never starts the timer: tests call tick() themselves. */
  intervalMs: number;
  /** Nothing is spinning on the player's screen, so a rebirth is said at once. */
  delaySeconds: number;
  /** Old news isn't worth interrupting chat for. */
  maxAgeSeconds: number;
};

export const REBIRTH_ANNOUNCER_TIMING = Symbol('REBIRTH_ANNOUNCER_TIMING');
export const DEFAULT_REBIRTH_ANNOUNCER_TIMING: RebirthAnnouncerTiming = { intervalMs: 5000, delaySeconds: 0, maxAgeSeconds: 600 };

// Says each rebirth in world chat. Each one is claimed in the database before it is sent, so two ticks
// or two portal processes never both say it.
@Injectable()
export class RebirthAnnouncer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RebirthAnnouncer.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  // A database without the rebirth tables fails every look: say so once, not every few seconds.
  private failing = false;

  constructor(
    @Inject(REBIRTH_REPOSITORY) private readonly repo: RebirthRepository,
    private readonly control: ControlClient,
    @Inject(REBIRTH_ANNOUNCER_TIMING) private readonly timing: RebirthAnnouncerTiming,
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

  /** How many rebirths were announced. */
  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const announced = await this.announceWaiting();
      this.failing = false;
      return announced;
    } catch (error) {
      if (!this.failing) this.logger.warn(`Rebirth announcements failed: ${error instanceof Error ? error.message : error}`);
      this.failing = true;
      return 0;
    } finally {
      this.running = false;
    }
  }

  private async announceWaiting(): Promise<number> {
    let announced = 0;
    for (const entry of await this.repo.waitingAnnouncements()) {
      if (entry.ageSeconds < this.timing.delaySeconds) continue;
      if (entry.ageSeconds > this.timing.maxAgeSeconds) {
        await this.repo.markAnnounced(entry.id, ANNOUNCE_SKIPPED);
        continue;
      }
      if (!(await this.repo.claimAnnouncement(entry.id))) continue;
      try {
        this.control.announce(entry.text);
      } catch (error) {
        await this.repo.markAnnounced(entry.id, ANNOUNCE_WAITING);
        // Left waiting: a later tick sends them, or skips them once they are old.
        if (error instanceof ControlUnavailableError || error instanceof ControlRefusedError) return announced;
        throw error;
      }
      announced++;
    }
    return announced;
  }
}
