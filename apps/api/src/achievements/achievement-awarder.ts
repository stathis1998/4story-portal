import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { achievementLevelName } from '@4story-portal/shared';
import { ControlClient, ControlRefusedError, ControlUnavailableError } from '../control/control-client.js';
import { serverNow, StatsService } from '../stats/stats.service.js';
import type { AccountStatsRow, CharacterStatsRow } from '../stats/stats-rules.js';
import {
  ACCOUNT_ACHIEVEMENTS,
  type AchievementFamily,
  awardLife,
  CHARACTER_ACHIEVEMENTS,
  FIRST_LIFE,
  levelReached,
  lifeValue,
  REBIRTH_SETTLE_SECONDS,
} from './achievement-rules.js';
import {
  ACHIEVEMENTS_REPOSITORY,
  type AchievementsRepository,
  ANNOUNCE_SKIPPED,
  ANNOUNCE_WAITING,
  AWARD_SWITCHED_OFF,
  NO_CHARACTER,
} from './achievements.repository.js';

export type AwarderTiming = {
  /** How often to look. 0 never starts the timer: tests call tick() themselves. */
  intervalMs: number;
  /** The world server hands out 30 "new mail" alerts a minute, and chat has to stay readable. */
  maxPerTick: number;
  /** A pause between announcements, so a burst doesn't land as one block of chat. */
  announceGapMs: number;
};

export const AWARDER_TIMING = Symbol('AWARDER_TIMING');
export const DEFAULT_AWARDER_TIMING: AwarderTiming = { intervalMs: 60_000, maxPerTick: 20, announceGapMs: 1500 };

// The game saves a player's stats every 5 minutes, so nothing changes long after the last logout.
const ACTIVE_MINUTES = 10;
// Old news isn't worth interrupting chat for.
const ANNOUNCE_WITHIN_SECONDS = 10 * 60;
const SENDER = 'Achievements';
const REWARD_NOTE = ' Your reward is attached.';

export type TickResult = { awarded: number; announced: number };
const NOTHING: TickResult = { awarded: 0, announced: 0 };

/** A level someone has reached and not been awarded, in the life it is recorded under. `charId` is NO_CHARACTER for an account achievement. */
type Due = { userId: number; charId: number; name: string; family: AchievementFamily; level: number; rebirth: number };

/** Reborn less than REBIRTH_SETTLE_SECONDS ago, by the database's clock. */
const settling = ({ row }: CharacterStatsRow) => row.rebirthAgeSeconds !== null && row.rebirthAgeSeconds < REBIRTH_SETTLE_SECONDS;

export const awardKey = (userId: number, charId: number, achievementId: string, level: number, rebirth: number) =>
  `${userId}:${charId}:${achievementId}:${level}:${rebirth}`;
export const rewardKey = (achievementId: string, level: number) => `${achievementId}:${level}`;

/** An account goes by its highest level character that isn't banned, as in the Hall of Fame. Empty when it has none. */
export function shownAs(account: AccountStatsRow): string {
  const [top] = account.characters
    .filter(({ row }) => !row.banned)
    .sort((a, b) => b.row.level - a.row.level || a.row.name.localeCompare(b.row.name));
  return top?.row.name ?? '';
}

// Once a minute, while the switch is on: finds the levels characters and accounts have reached and not been awarded,
// has the database send each one's letter and record it, then announces them in game.
@Injectable()
export class AchievementAwarder implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AchievementAwarder.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  // Look even when nobody is online: after a start, after the switch, and while a backlog remains.
  private force = true;
  private checkedAt: Date | null = null;

  constructor(
    @Inject(ACHIEVEMENTS_REPOSITORY) private readonly repo: AchievementsRepository,
    private readonly stats: StatsService,
    private readonly control: ControlClient,
    @Inject(AWARDER_TIMING) private readonly timing: AwarderTiming,
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

  /** When the awarder last looked, on the server's wall clock like the award dates. Null before its first look. */
  lastCheck(): Date | null {
    return this.checkedAt;
  }

  /** Makes the next tick look even if nobody is online. */
  wake(): void {
    this.force = true;
  }

  async tick(): Promise<TickResult> {
    if (this.running) return NOTHING;
    this.running = true;
    try {
      if (!(await this.repo.live())) return NOTHING;
      if (!this.force && !(await this.repo.recentlyActive(ACTIVE_MINUTES))) return NOTHING;
      const { awarded, left } = await this.awardDue();
      const { announced, waiting } = await this.announceWaiting();
      this.force = left > 0 || waiting > 0;
      this.checkedAt = serverNow();
      return { awarded, announced };
    } catch (error) {
      // The next tick tries again: an award is only ever recorded together with its letter.
      this.logger.warn(`Achievement check failed: ${describe(error)}`);
      return NOTHING;
    } finally {
      this.running = false;
    }
  }

  private async awardDue(): Promise<{ awarded: number; left: number }> {
    const { stats } = await this.stats.achievementStats();
    const awards = await this.repo.awards();
    const given = new Set(awards.map((award) => awardKey(award.userId, award.charId, award.achievementId, award.level, award.rebirth)));

    const due: Due[] = [];
    const add = (userId: number, charId: number, name: string, family: AchievementFamily, value: number, rebirth: number) => {
      const reached = levelReached(family, value);
      for (let level = 1; level <= reached; level++) {
        if (!given.has(awardKey(userId, charId, family.id, level, rebirth))) due.push({ userId, charId, name, family, level, rebirth });
      }
    };
    for (const account of stats.accounts.values()) {
      const playing = account.characters.filter(({ row }) => !row.banned);
      // An account with only banned characters earns nothing.
      if (playing.length === 0) continue;
      const name = shownAs(account);
      for (const family of ACCOUNT_ACHIEVEMENTS) add(account.userId, NO_CHARACTER, name, family, family.value(account), FIRST_LIFE);
      for (const character of playing) {
        // Just reborn: the numbers may still be the old life's.
        if (settling(character)) continue;
        for (const family of CHARACTER_ACHIEVEMENTS) {
          add(account.userId, character.row.id, character.row.name, family, lifeValue(family, character), awardLife(family, character));
        }
      }
    }
    // Level 1 of everything before level 2 of anything, so a backlog reads in order.
    due.sort((a, b) => a.level - b.level);

    let awarded = 0;
    const batch = due.slice(0, this.timing.maxPerTick);
    for (const { userId, charId, name: who, family, level, rebirth } of batch) {
      const name = achievementLevelName(family.name, level, family.levels.length);
      const goal = family.goal(family.levels[level - 1]);
      let id: number;
      try {
        // The database sends a character its letter with the level's saved reward, records the
        // award with it, and refuses once the switch is off.
        id = await this.repo.award({
          userId,
          charId,
          rebirth,
          achievementId: family.id,
          level,
          sender: SENDER,
          title: `Achievement: ${name}`,
          message: `You completed ${name}: ${goal}.`,
          rewardNote: REWARD_NOTE,
          text: `${who} completed ${name}: ${goal}`,
        });
      } catch (error) {
        // One award that can't be given must not hold up the rest. Nothing was written for it.
        this.logger.warn(`Could not award ${family.id} ${level} to account ${userId}, character ${charId}: ${describe(error)}`);
        continue;
      }
      if (id === AWARD_SWITCHED_OFF) return { awarded, left: 0 };
      if (id > 0) awarded++;
    }
    return { awarded, left: due.length - batch.length };
  }
  private async announceWaiting(): Promise<{ announced: number; waiting: number }> {
    const waiting = (await this.repo.awards()).filter((award) => award.announced === ANNOUNCE_WAITING);
    let announced = 0;
    for (const [index, award] of waiting.entries()) {
      // Switched off since the tick began: leave the rest unsaid.
      if (!(await this.repo.live())) return { announced, waiting: 0 };
      if (award.ageSeconds > ANNOUNCE_WITHIN_SECONDS) {
        await this.repo.markAnnounced(award.id, ANNOUNCE_SKIPPED);
        continue;
      }
      // Taken before it is sent, so two ticks or two portal processes never both say it.
      if (!(await this.repo.claimAnnouncement(award.id))) continue;
      try {
        this.control.announce(award.text);
      } catch (error) {
        await this.repo.markAnnounced(award.id, ANNOUNCE_WAITING);
        if (error instanceof ControlUnavailableError || error instanceof ControlRefusedError) {
          // Left waiting: the next tick sends them, or skips them once they are old.
          return { announced, waiting: waiting.length - index };
        }
        throw error;
      }
      announced++;
      if (this.timing.announceGapMs > 0) await new Promise((resolve) => setTimeout(resolve, this.timing.announceGapMs));
    }
    return { announced, waiting: 0 };
  }
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));
