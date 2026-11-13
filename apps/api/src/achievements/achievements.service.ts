import {
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type {
  Achievement,
  AchievementReward,
  AchievementRewardRequest,
  AchievementsOverview,
  GmAchievements,
  News,
  SessionUser,
} from '@4story-portal/shared';
import { ControlClient, ControlRefusedError, ControlUnavailableError } from '../control/control-client.js';
import { itemIcons } from '../gm/game-icons.generated.js';
import { serverNow, StatsService } from '../stats/stats.service.js';
import type { AccountStatsRow } from '../stats/stats-rules.js';
import { AchievementAwarder, rewardKey } from './achievement-awarder.js';
import { ACHIEVEMENTS, type AchievementFamily, formatValue, levelReached, LEVELS_TOTAL } from './achievement-rules.js';
import {
  ACHIEVEMENTS_REPOSITORY,
  type AchievementsRepository,
  ANNOUNCE_WAITING,
  type AwardRow,
  type RewardRow,
} from './achievements.repository.js';

const NEWS_ITEMS = 20;

// Shapes what the pages show: levels, rewards, the news feed and the GM's settings.
@Injectable()
export class AchievementsService {
  private readonly logger = new Logger(AchievementsService.name);

  constructor(
    @Inject(ACHIEVEMENTS_REPOSITORY) private readonly repo: AchievementsRepository,
    private readonly stats: StatsService,
    private readonly control: ControlClient,
    private readonly awarder: AchievementAwarder,
  ) {}

  async overview(user: SessionUser): Promise<AchievementsOverview> {
    const [{ stats, ranked }, awards, rewards, live] = await Promise.all([
      this.stats.achievementStats(),
      this.awards(),
      this.rewards(),
      this.live(),
    ]);
    const mine = stats.accounts.get(user.userId);

    // The highest level each account has been awarded, and when this one got each of its own.
    const awarded = new Map<string, number>();
    const earnedAt = new Map<string, string>();
    for (const award of awards) {
      const key = `${award.userId}:${award.achievementId}`;
      awarded.set(key, Math.max(awarded.get(key) ?? 0, award.level));
      if (award.userId === user.userId) earnedAt.set(rewardKey(award.achievementId, award.level), award.earnedAt.toISOString());
    }
    // An awarded level stays, even when the number behind it has dropped again.
    const level = (userId: number, family: AchievementFamily, account: AccountStatsRow | undefined) =>
      Math.max(account ? levelReached(family, family.value(account)) : 0, awarded.get(`${userId}:${family.id}`) ?? 0);

    const achievements: Achievement[] = ACHIEVEMENTS.map((family) => {
      const value = mine ? family.value(mine) : 0;
      const levelsDone = level(user.userId, family, mine);
      const others = ranked.map((account) => ({ name: shownAs(account), reached: level(account.userId, family, account) }));
      return {
        id: family.id,
        name: family.name,
        category: family.category,
        value,
        valueText: formatValue(family, value),
        levelsDone,
        levels: family.levels.map((threshold, index) => ({
          level: index + 1,
          threshold,
          thresholdText: formatValue(family, threshold),
          goal: family.goal(threshold),
          reward: rewards.get(rewardKey(family.id, index + 1)) ?? null,
          done: index + 1 <= levelsDone,
          earnedAt: earnedAt.get(rewardKey(family.id, index + 1)) ?? null,
          ...holdersOf(others, index + 1),
        })),
      };
    });

    return {
      achievements,
      levelsDone: achievements.reduce((total, achievement) => total + achievement.levelsDone, 0),
      levelsTotal: LEVELS_TOTAL,
      players: ranked.length,
      live,
    };
  }

  async news(user: SessionUser): Promise<News> {
    const awards = await this.awards();
    return {
      serverNow: serverNow().toISOString(),
      items: awards
        .slice(-NEWS_ITEMS)
        .reverse()
        .map((award) => ({ id: award.id, at: award.earnedAt.toISOString(), text: award.text, mine: award.userId === user.userId })),
    };
  }

  async gm(): Promise<GmAchievements> {
    const [awards, rewards, live] = await Promise.all([this.awards(), this.rewards(), this.live()]);
    return {
      live,
      control: this.control.status().state,
      awards: awards.length,
      pendingAnnouncements: awards.filter((award) => award.announced === ANNOUNCE_WAITING).length,
      lastCheck: this.awarder.lastCheck()?.toISOString() ?? null,
      achievements: ACHIEVEMENTS.map((family) => ({
        id: family.id,
        name: family.name,
        category: family.category,
        levels: family.levels.map((threshold, index) => ({
          level: index + 1,
          goal: family.goal(threshold),
          reward: rewards.get(rewardKey(family.id, index + 1)) ?? null,
        })),
      })),
    };
  }

  async setReward({ achievementId, level, reward }: AchievementRewardRequest, changedBy: string): Promise<GmAchievements> {
    const family = ACHIEVEMENTS.find((entry) => entry.id === achievementId);
    if (!family || level > family.levels.length) throw new NotFoundException('No such achievement level');
    await this.checkItems(reward.items);
    await this.save(() => this.repo.setReward({ achievementId, level, ...reward }, changedBy));
    return this.gm();
  }

  async setLive(live: boolean, changedBy: string): Promise<GmAchievements> {
    await this.save(() => this.repo.setLive(live, changedBy));
    // Everything already completed is due the moment the switch goes on, whoever is online.
    if (live) this.awarder.wake();
    return this.gm();
  }

  testAnnouncement(sentBy: string): void {
    try {
      this.control.announce(`Test announcement from the portal, sent by ${sentBy}`);
    } catch (error) {
      if (error instanceof ControlUnavailableError) throw new ServiceUnavailableException('The control server is not connected');
      if (error instanceof ControlRefusedError) throw new ServiceUnavailableException('The portal manager may not send announcements');
      throw error;
    }
  }

  private async save(change: () => Promise<void>): Promise<void> {
    try {
      await change();
    } catch (error) {
      // Most likely the achievement tables are not in this game database yet.
      this.logger.warn(`Could not save an achievement setting: ${describe(error)}`);
      throw new HttpException('The setting could not be saved', 503);
    }
  }

  /** The same checks GM mail makes: a reward is sent as a letter. */
  private async checkItems(items: { itemId: number; count: number }[]): Promise<void> {
    if (items.length === 0) return;
    const ids = [...new Set(items.map((item) => item.itemId))];
    const found = new Map((await this.repo.findItems(ids)).map((row) => [row.itemId, row]));

    const unknown = ids.filter((id) => !found.has(id));
    if (unknown.length > 0) throw new UnprocessableEntityException(`Unknown items: ${unknown.join(', ')}`);

    // The client crashes drawing an item it has no entry for.
    const missing = ids.find((id) => !Object.hasOwn(itemIcons, id));
    if (missing !== undefined) throw new UnprocessableEntityException(`Not in the game client: ${missing}`);

    for (const { itemId, count } of items) {
      const item = found.get(itemId)!;
      const stack = Math.max(item.stack, 1);
      if (count > stack) throw new UnprocessableEntityException(`${item.name || `Item ${itemId}`} stacks to ${stack}`);
    }
  }

  // The pages keep working when the achievement tables can't be read (before they are added to the
  // game database, say): levels still show, with no dates, no rewards and the switch off. Only the
  // awarder needs the real answers, and it asks the database itself.
  private async readOr<T>(what: string, read: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await read();
    } catch (error) {
      this.logger.warn(`Could not read the achievement ${what}: ${describe(error)}`);
      return fallback;
    }
  }

  private awards(): Promise<AwardRow[]> {
    return this.readOr('awards', () => this.repo.awards(), []);
  }

  private live(): Promise<boolean> {
    return this.readOr('switch', () => this.repo.live(), false);
  }

  /** Every saved reward, ready to show, by achievement and level. */
  private async rewards(): Promise<Map<string, AchievementReward>> {
    const stored = await this.readOr<RewardRow[]>('rewards', () => this.repo.rewards(), []);
    const ids = [...new Set(stored.flatMap((reward) => reward.items.map((item) => item.itemId)))];
    const found = await this.readOr('reward item names', () => this.repo.findItems(ids), []);
    const names = new Map(found.map((row) => [row.itemId, row.name]));
    return new Map(
      stored.map(({ achievementId, level, gold, silver, copper, items }) => [
        rewardKey(achievementId, level),
        {
          gold,
          silver,
          copper,
          items: items.map(({ itemId, count }) => ({
            itemId,
            count,
            name: names.get(itemId) || `Item ${itemId}`,
            icon: itemIcons[itemId] ?? null,
          })),
        },
      ]),
    );
  }
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** An account goes by its highest level character that isn't banned, as in the Hall of Fame. */
function shownAs(account: AccountStatsRow): string {
  const [top] = account.characters
    .filter(({ row }) => !row.banned)
    .sort((a, b) => b.row.level - a.row.level || a.row.name.localeCompare(b.row.name));
  return top?.row.name ?? '';
}

function holdersOf(accounts: { name: string; reached: number }[], level: number): { holders: number; holderNames: string[] } {
  const names = accounts.filter((account) => account.reached >= level).map((account) => account.name);
  return { holders: names.length, holderNames: names.filter(Boolean).sort((a, b) => a.localeCompare(b)) };
}