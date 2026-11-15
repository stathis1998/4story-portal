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
  AchievementGroup,
  AchievementReward,
  AchievementRewardRequest,
  AchievementsOverview,
  GmAchievements,
  News,
  SessionUser,
} from '@4story-portal/shared';
import { className } from '../characters/character-codes.js';
import { ControlClient, ControlRefusedError, ControlUnavailableError } from '../control/control-client.js';
import { itemIcons } from '../gm/game-icons.generated.js';
import { REBIRTH_REPOSITORY, type RebirthLogRow, type RebirthRepository } from '../rebirth/rebirth.repository.js';
import type { CharacterStatsRow } from '../stats/stats-rules.js';
import { serverNow, StatsService } from '../stats/stats.service.js';
import { AchievementAwarder, rewardKey, shownAs } from './achievement-awarder.js';
import {
  ACCOUNT_ACHIEVEMENTS,
  ACCOUNT_LEVELS_TOTAL,
  type AchievementFamily,
  awardLife,
  CHARACTER_ACHIEVEMENTS,
  CHARACTER_LEVELS_TOTAL,
  type CharacterFamily,
  FIRST_LIFE,
  formatValue,
  levelReached,
  lifeValue,
} from './achievement-rules.js';
import {
  ACHIEVEMENTS_REPOSITORY,
  type AchievementsRepository,
  ANNOUNCE_WAITING,
  type AwardRow,
  NO_CHARACTER,
  type RewardRow,
} from './achievements.repository.js';

const NEWS_ITEMS = 20;

/** Someone an achievement is measured against, and the level they have reached in it. */
type Standing = { name: string; reached: number };

/** One subject's own view of an achievement: what it has counted, and what it has been awarded. */
type Own = { value: number; reached: number; earnedAt: (level: number) => string | null };

const subjectKey = (userId: number, charId: number, achievementId: string, life: number) => `${userId}:${charId}:${achievementId}:${life}`;

// Shapes what the pages show: levels, rewards, the news feed and the GM's settings.
@Injectable()
export class AchievementsService {
  private readonly logger = new Logger(AchievementsService.name);

  constructor(
    @Inject(ACHIEVEMENTS_REPOSITORY) private readonly repo: AchievementsRepository,
    private readonly stats: StatsService,
    private readonly control: ControlClient,
    private readonly awarder: AchievementAwarder,
    @Inject(REBIRTH_REPOSITORY) private readonly rebirths: RebirthRepository,
  ) {}

  async overview(user: SessionUser): Promise<AchievementsOverview> {
    const [{ stats, ranked }, awards, rewards, live] = await Promise.all([
      this.stats.achievementStats(),
      this.awards(),
      this.rewards(),
      this.live(),
    ]);
    const mine = stats.accounts.get(user.userId);

    // The highest level each subject has been awarded in each life, and when.
    const awarded = new Map<string, number>();
    const earned = new Map<string, string>();
    for (const award of awards) {
      const key = subjectKey(award.userId, award.charId, award.achievementId, award.rebirth);
      awarded.set(key, Math.max(awarded.get(key) ?? 0, award.level));
      earned.set(`${key}:${award.level}`, award.earnedAt.toISOString());
    }
    // An awarded level stays, even when the number behind it has dropped again. Only the awards of the life
    // the achievement counts in now: FIRST_LIFE for an account achievement or one paid once.
    const reached = (userId: number, charId: number, family: AchievementFamily, value: number, life: number) =>
      Math.max(levelReached(family, value), awarded.get(subjectKey(userId, charId, family.id, life)) ?? 0);
    const own = (userId: number, charId: number, family: AchievementFamily, value: number, life: number): Own => ({
      value,
      reached: reached(userId, charId, family, value, life),
      earnedAt: (level) => earned.get(`${subjectKey(userId, charId, family.id, life)}:${level}`) ?? null,
    });
    const characterOwn = (family: CharacterFamily, character: CharacterStatsRow): Own =>
      own(character.row.userId, character.row.id, family, lifeValue(family, character), awardLife(family, character));

    // Account achievements are measured against the ranked accounts, character ones against their characters.
    const contenders = ranked.flatMap((account) => account.characters.filter(({ row }) => !row.banned));
    const accountStandings = new Map<string, Standing[]>(
      ACCOUNT_ACHIEVEMENTS.map((family) => [
        family.id,
        ranked.map((account) => ({
          name: shownAs(account),
          reached: reached(account.userId, NO_CHARACTER, family, family.value(account), FIRST_LIFE),
        })),
      ]),
    );
    const characterStandings = new Map<string, Standing[]>(
      CHARACTER_ACHIEVEMENTS.map((family) => [
        family.id,
        contenders.map((character) => ({ name: character.row.name, reached: characterOwn(family, character).reached })),
      ]),
    );

    const account = group(
      ACCOUNT_ACHIEVEMENTS.map((family) =>
        view(family, own(user.userId, NO_CHARACTER, family, mine ? family.value(mine) : 0, FIRST_LIFE), accountStandings.get(family.id)!, null),
      ),
      ACCOUNT_LEVELS_TOTAL,
    );

    const characters = [...(mine?.characters ?? [])]
      .sort((a, b) => b.row.level - a.row.level || a.row.name.localeCompare(b.row.name))
      .map((character) => ({
        id: character.row.id,
        name: character.row.name,
        level: character.row.level,
        className: className(character.row.classCode),
        ...group(
          CHARACTER_ACHIEVEMENTS.map((family) => view(family, characterOwn(family, character), characterStandings.get(family.id)!, rewards)),
          CHARACTER_LEVELS_TOTAL,
        ),
      }));

    return { account, characters, live };
  }

  /** The newest awards and rebirths together. A rebirth's id is its log id made negative, so the two never share one. */
  async news(user: SessionUser): Promise<News> {
    const [awards, rebirths] = await Promise.all([this.awards(), this.recentRebirths()]);
    const items = [
      ...awards
        .slice(-NEWS_ITEMS)
        .reverse()
        .map((award) => ({ id: award.id, at: award.earnedAt, text: award.text, mine: award.userId === user.userId })),
      ...rebirths.map((row) => ({ id: -row.id, at: row.at, text: row.text, mine: row.userId === user.userId })),
    ];
    return {
      serverNow: serverNow().toISOString(),
      // A stable sort: each list is already newest first, so equal dates keep that order.
      items: items
        .sort((a, b) => b.at.getTime() - a.at.getTime())
        .slice(0, NEWS_ITEMS)
        .map((item) => ({ ...item, at: item.at.toISOString() })),
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
      // Only the achievements that can pay: an account achievement has nothing to set.
      achievements: CHARACTER_ACHIEVEMENTS.map((family) => ({
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
    const family = CHARACTER_ACHIEVEMENTS.find((entry) => entry.id === achievementId);
    if (!family || level > family.levels.length) throw new NotFoundException('No such character achievement level');
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

  /** Empty while the rebirth tables are not in this game database. */
  private recentRebirths(): Promise<RebirthLogRow[]> {
    return this.readOr('rebirth log', () => this.rebirths.recent(NEWS_ITEMS), []);
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

/** One achievement as its subject has it. `rewards` is null for an account achievement, which never pays. */
function view(family: AchievementFamily, own: Own, standings: Standing[], rewards: Map<string, AchievementReward> | null): Achievement {
  return {
    id: family.id,
    name: family.name,
    category: family.category,
    scope: family.scope,
    population: standings.length,
    value: own.value,
    valueText: formatValue(family, own.value),
    levelsDone: own.reached,
    levels: family.levels.map((threshold, index) => {
      const level = index + 1;
      const holders = standings.filter((standing) => standing.reached >= level);
      return {
        level,
        threshold,
        thresholdText: formatValue(family, threshold),
        goal: family.goal(threshold),
        reward: rewards?.get(rewardKey(family.id, level)) ?? null,
        done: level <= own.reached,
        earnedAt: own.earnedAt(level),
        holders: holders.length,
        holderNames: holders.map((standing) => standing.name).filter(Boolean).sort((a, b) => a.localeCompare(b)),
      };
    }),
  };
}

const group = (achievements: Achievement[], levelsTotal: number): AchievementGroup => ({
  achievements,
  levelsDone: achievements.reduce((total, achievement) => total + achievement.levelsDone, 0),
  levelsTotal,
});
