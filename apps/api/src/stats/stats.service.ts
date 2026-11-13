import { HttpException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CharacterInspect,
  CharacterProfile,
  CharacterRanking,
  CharacterSearchResult,
  GearItem,
  HallCategory,
  HallCategoryId,
  HallEntry,
  HallOfFame,
  HallOfFameSettings,
  Leaderboard,
  LeaderboardCategoryId,
  PlayerOverview,
  SessionUser,
  UpgradeLoss,
  UpgradeStats,
} from '@4story-portal/shared';
import { GmAccess } from '../auth/gm-access.js';
import { className, countryName, raceName } from '../characters/character-codes.js';
import { itemIcons } from '../gm/game-icons.generated.js';
import { tooltipCharts } from '../gm/game-tooltips.generated.js';
import { buildItemTooltip, type OptionRule } from './item-tooltip.js';
import { levelsDone } from '../achievements/achievement-rules.js';
import { PortalStore, StoreUnavailableError } from '../store/portal-store.js';
import {
  type AccountStatsRow,
  type CharacterStatsRow,
  type ComputedStats,
  computeStats,
  type Ranked,
  rankCategory,
  UPGRADE_KIND_GEM,
  UPGRADE_KIND_SCROLL,
  type UpgradeAttemptRow,
  type UpgradeLossRow,
} from './stats-rules.js';
import { STATS_REPOSITORY, type StatsRepository } from './stats.repository.js';
import { firstUpgradeDay, upgradeKindStats } from './upgrade-stats.js';

const CACHE_MS = 60_000;
const TOP_PLACES = 3;
const MAX_ROWS = 5;
const MAX_SEARCH_RESULTS = 20;
const MAX_LOSSES = 5;

// ES_* in NetCode.h.
const SLOT_NAMES = [
  'Main weapon',
  'Second weapon',
  'Long weapon',
  'Head',
  'Back',
  'Body',
  'Pants',
  'Feet',
  'Hands',
  'Neck',
  'Left ring',
  'Right ring',
  'Left earring',
  'Right earring',
  'Face',
  'Costume hat',
  'Costume dress',
  'Costume accessory',
  'Costume race',
];

type Snapshot = {
  stats: ComputedStats;
  /** Achievement levels each account's stats reach now. */
  levels: Map<number, number>;
  optionRules: Map<number, OptionRule>;
  upgradeAttempts: UpgradeAttemptRow[];
  upgradeLosses: UpgradeLossRow[];
};

type Category<Id extends string = HallCategoryId> = {
  id: Id;
  label: string;
  value: (character: CharacterStatsRow) => number;
  display: (value: number) => string;
  detail?: (character: CharacterStatsRow) => string | null;
};

const hours = (minutes: number) => Math.round(minutes / 6) / 10;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const itemName = (itemId: number, name: string | null) => (name && name !== '_' ? name : `Item #${itemId}`);

const CHARACTER_CATEGORIES: Category[] = [
  { id: 'level', label: 'Highest level', value: (c) => c.row.level, display: (v) => `Lv. ${v}` },
  { id: 'hours', label: 'Most hours', value: (c) => c.minutesPlayed, display: (v) => `${hours(v)} h` },
  { id: 'streak', label: 'Longest streak', value: (c) => c.longestStreak, display: (v) => plural(v, 'day') },
  {
    id: 'item',
    label: 'Best item',
    value: (c) => c.bestItem?.upgrade ?? 0,
    display: (v) => `+${v}`,
    detail: (c) => (c.bestItem ? itemName(c.bestItem.itemId, c.bestItem.name) : null),
  },
  { id: 'titles', label: 'Most titles', value: (c) => c.titles.length, display: (v) => plural(v, 'title') },
  { id: 'companion', label: 'Top companion', value: (c) => c.companionLevel, display: (v) => `Lv. ${v}` },
];
const BADGE_CATEGORY = { id: 'badges' as const, label: 'Most achievements', display: (v: number) => plural(v, 'level') };

const total = (value: number) => value.toLocaleString('en-US');

const COPPER_PER_GOLD = 1_000_000;
const SMALLEST_SHOWN_COPPER = COPPER_PER_GOLD / 100;
const gold = (copper: number) =>
  copper < SMALLEST_SHOWN_COPPER
    ? '<0.01 gold'
    : `${(copper / COPPER_PER_GOLD).toLocaleString('en-US', { maximumFractionDigits: 2 })} gold`;

const LEADERBOARD_CATEGORIES: Category<LeaderboardCategoryId>[] = [
  { id: 'damage', label: 'Damage dealt', value: (c) => c.damageDealt, display: total },
  { id: 'kills', label: 'Monsters killed', value: (c) => c.kills, display: total },
  { id: 'gold', label: 'Gold spent', value: (c) => c.copperSpent, display: gold },
  {
    id: 'lottery',
    label: 'Soul lottery',
    value: (c) => c.lotteryCopperWon + c.lotteryCopperConsolation,
    display: gold,
    detail: (c) => `${total(c.lotteriesWon)} won, ${total(c.lotteriesLost)} lost${winRate(c.lotteriesWon, c.lotteriesLost)}`,
  },
  {
    id: 'loseStreak',
    label: 'Soul lottery lose streak',
    value: (c) => c.longestLoseStreak,
    display: (v) => `${total(v)} in a row`,
    detail: (c) => loseStreakNow(c.longestLoseStreak, c.currentLoseStreak),
  },
];

// How the character's current run compares with its longest one.
function loseStreakNow(longest: number, current: number): string {
  if (current === 0) return 'Ended by a win';
  if (current === longest) return 'Still going';
  return `Now ${total(current)} in a row`;
}

// Whole percent, with `<1%` for a rare win so it never reads as 0%. Empty when nothing was played.
function winRate(won: number, lost: number): string {
  const played = won + lost;
  if (played === 0) return '';
  const rate = (won / played) * 100;
  return `, ${won > 0 && rate < 1 ? '<1' : Math.round(rate)}% win rate`;
}

// Reads through the 60-second cache and shapes the responses. The hide switch is applied per request,
// so it works at once.
@Injectable()
export class StatsService {
  private cache: { loadedAt: number; snapshot: Promise<Snapshot> } | null = null;

  constructor(
    @Inject(STATS_REPOSITORY) private readonly repo: StatsRepository,
    private readonly store: PortalStore,
    private readonly gm: GmAccess,
  ) {}

  async overview(user: SessionUser): Promise<PlayerOverview> {
    const snapshot = await this.snapshot();
    const account = snapshot.stats.accounts.get(user.userId);
    return {
      today: snapshot.stats.today,
      hoursPlayed: hours(account?.minutesPlayed ?? 0),
      daysPlayed: account?.daysPlayed ?? 0,
      currentStreak: account?.currentStreak ?? 0,
      longestStreak: account?.longestStreak ?? 0,
      activity: account?.activity ?? [],
      characters: (account?.characters ?? []).map((character) => ({
        id: character.row.id,
        progress: character.progress,
        hoursPlayed: hours(character.minutesPlayed),
      })),
    };
  }

  async profile(user: SessionUser, id: number): Promise<CharacterProfile> {
    const snapshot = await this.snapshot();
    const character = snapshot.stats.characters.get(id);
    // The same answer whether it's someone else's or doesn't exist, so IDs can't be probed.
    if (!character || character.row.userId !== user.userId) throw new NotFoundException('Character not found');
    const { row } = character;
    const ranked = this.isRanked(user);

    return {
      id: row.id,
      name: row.name,
      level: row.level,
      className: className(row.classCode),
      race: raceName(row.raceCode),
      country: countryName(row.countryCode),
      progress: character.progress,
      ageDays: character.ageDays,
      hoursPlayed: hours(character.minutesPlayed),
      daysPlayed: character.daysPlayed,
      longestStreak: character.longestStreak,
      longestSessionMinutes: character.longestSessionMinutes,
      gear: gearViews(character, snapshot.optionRules),
      companions: [...character.companions]
        .sort((a, b) => a.slot - b.slot)
        .map(({ slot, name, level }) => ({ slot, name, level })),
      titles: character.titles.map((title) => title.name),
      titlesTotal: snapshot.stats.titlesTotal,
      ranked,
      rankings: ranked ? this.rankings(snapshot, character) : [],
    };
  }

  async inspect(user: SessionUser, id: number): Promise<CharacterInspect> {
    const snapshot = await this.snapshot();
    const character = snapshot.stats.characters.get(id);
    // One answer for banned, hidden and missing, so IDs can't be probed.
    const visible = character && (character.row.userId === user.userId || this.contenders(snapshot).includes(character));
    if (!character || !visible) throw new NotFoundException('Character not found');
    const { row } = character;

    // Named field by field: nothing private can arrive here by being added to the row.
    return {
      id: row.id,
      name: row.name,
      level: row.level,
      className: className(row.classCode),
      race: raceName(row.raceCode),
      country: countryName(row.countryCode),
      gear: gearViews(character, snapshot.optionRules),
    };
  }

  async searchCharacters(query: string): Promise<CharacterSearchResult[]> {
    const snapshot = await this.snapshot();
    const needle = query.toLowerCase();
    const isExact = ({ row }: CharacterStatsRow) => row.name.toLowerCase() === needle;
    return this.contenders(snapshot)
      .filter(({ row }) => row.name.toLowerCase().includes(needle))
      .sort((a, b) => Number(isExact(b)) - Number(isExact(a)) || a.row.name.localeCompare(b.row.name))
      .slice(0, MAX_SEARCH_RESULTS)
      .map(({ row }) => ({ id: row.id, name: row.name, level: row.level, className: className(row.classCode) }));
  }

  async hallOfFame(user: SessionUser): Promise<HallOfFame> {
    const snapshot = await this.snapshot();
    const ranked = this.isRanked(user);
    const viewer = ranked ? user.userId : null;
    const contenders = this.contenders(snapshot);

    const categories: HallCategory[] = CHARACTER_CATEGORIES.map((category) =>
      this.hallCategory(category, rankCategory(contenders.map((c) => candidate(c, category.value(c)))), snapshot, viewer),
    );
    categories.push(this.hallCategory(BADGE_CATEGORY, this.badgeRanking(snapshot), snapshot, viewer));

    return { categories, ranked, gm: this.gm.isGm(user.username) ? { hideGms: this.store.hideGms() } : null };
  }

  async leaderboard(user: SessionUser): Promise<Leaderboard> {
    const snapshot = await this.snapshot();
    const ranked = this.isRanked(user);
    const contenders = this.contenders(snapshot);
    const { characters } = snapshot.stats;

    return {
      ranked,
      categories: LEADERBOARD_CATEGORIES.map((category) => ({
        id: category.id,
        label: category.label,
        entries: rankCategory(contenders.map((c) => candidate(c, category.value(c)))).map((place) =>
          hallEntry(category, place, characters.get(place.key)!, ranked && characters.get(place.key)!.row.userId === user.userId),
        ),
        you: null,
      })),
    };
  }

  /**
   * Server-wide numbers count ranked characters only, or just `characterId` when given. That can be
   * any character Inspect would show, or one of the viewer's own. `you` is always the viewer's own.
   */
  async upgradeStats(user: SessionUser, characterId?: number): Promise<UpgradeStats> {
    const snapshot = await this.snapshot();
    const ranked = this.isRanked(user);
    const { characters, today } = snapshot.stats;
    const contenders = this.contenders(snapshot);

    let counted: Set<number>;
    let character: UpgradeStats['character'] = null;
    if (characterId === undefined) {
      counted = new Set(contenders.map(({ row }) => row.id));
    } else {
      const chosen = characters.get(characterId);
      // One answer for banned, hidden and missing, so IDs can't be probed.
      if (!chosen || !(chosen.row.userId === user.userId || contenders.includes(chosen))) {
        throw new NotFoundException('Character not found');
      }
      counted = new Set([characterId]);
      const { row } = chosen;
      character = { id: row.id, name: row.name, className: className(row.classCode), level: row.level, mine: row.userId === user.userId };
    }
    const counts = (charId: number) => counted.has(charId);
    const mine = (charId: number) => characters.get(charId)?.row.userId === user.userId;

    const losses: UpgradeLoss[] = snapshot.upgradeLosses
      .filter((loss) => counts(loss.charId))
      .sort((a, b) => b.level - a.level || b.at.getTime() - a.at.getTime())
      .slice(0, MAX_LOSSES)
      .map((loss) => {
        const { row } = characters.get(loss.charId)!;
        return {
          characterId: row.id,
          name: row.name,
          className: className(row.classCode),
          level: row.level,
          item: itemName(loss.itemId, loss.name),
          upgrade: loss.level,
          date: loss.at.toISOString().slice(0, 10),
          mine: ranked && row.userId === user.userId,
        };
      });

    return {
      today,
      character,
      since: firstUpgradeDay(snapshot.upgradeAttempts, counts),
      scroll: upgradeKindStats(snapshot.upgradeAttempts, UPGRADE_KIND_SCROLL, counts, mine, today),
      gem: upgradeKindStats(snapshot.upgradeAttempts, UPGRADE_KIND_GEM, counts, mine, today),
      losses,
      ranked,
    };
  }

  /** What the achievements are worked out from, through the same cache as the pages. */
  async achievementStats(): Promise<{ stats: ComputedStats; ranked: AccountStatsRow[] }> {
    const snapshot = await this.snapshot();
    return { stats: snapshot.stats, ranked: this.rankedAccounts(snapshot) };
  }

  setHideGms(hideGms: boolean, changedBy: string): HallOfFameSettings {
    try {
      this.store.setHideGms(hideGms, changedBy);
    } catch (error) {
      if (error instanceof StoreUnavailableError) throw new HttpException('Settings could not be saved', 503);
      throw error;
    }
    return { hideGms };
  }

  private isRanked(user: SessionUser): boolean {
    return !(this.store.hideGms() && this.gm.isGm(user.username));
  }

  /** Accounts that count for rankings and rarity right now. */
  private rankedAccounts(snapshot: Snapshot): AccountStatsRow[] {
    const hide = this.store.hideGms();
    return [...snapshot.stats.accounts.values()].filter(
      (account) =>
        account.characters.some(({ row }) => !row.banned) &&
        !(hide && account.username !== null && this.gm.isGm(account.username)),
    );
  }

  private contenders(snapshot: Snapshot): CharacterStatsRow[] {
    return this.rankedAccounts(snapshot).flatMap((account) => account.characters.filter(({ row }) => !row.banned));
  }

  /** By account, shown under its highest level character. */
  private badgeRanking(snapshot: Snapshot): Ranked<number>[] {
    const candidates = this.rankedAccounts(snapshot).flatMap((account) => {
      const [top] = account.characters
        .filter(({ row }) => !row.banned)
        .sort((a, b) => b.row.level - a.row.level || a.row.name.localeCompare(b.row.name));
      return top ? [candidate(top, snapshot.levels.get(account.userId) ?? 0)] : [];
    });
    return rankCategory(candidates);
  }

  private hallCategory(
    category: Pick<Category, 'id' | 'label' | 'display' | 'detail'>,
    ranking: Ranked<number>[],
    snapshot: Snapshot,
    viewer: number | null,
  ): HallCategory {
    const { characters } = snapshot.stats;
    const mine = viewer === null ? undefined : ranking.find(({ key }) => characters.get(key)!.row.userId === viewer);
    const listed = ranking.filter(({ place }) => place <= TOP_PLACES).slice(0, MAX_ROWS);

    return {
      id: category.id,
      label: category.label,
      entries: listed.map((place) => hallEntry(category, place, characters.get(place.key)!, place.key === mine?.key)),
      you:
        mine && !listed.some(({ key }) => key === mine.key)
          ? { place: mine.place, name: mine.name, display: category.display(mine.value) }
          : null,
    };
  }

  private rankings(snapshot: Snapshot, character: CharacterStatsRow): CharacterRanking[] {
    const contenders = this.contenders(snapshot);
    const rankings: CharacterRanking[] = [];
    for (const category of CHARACTER_CATEGORIES) {
      const ranking = rankCategory(contenders.map((c) => candidate(c, category.value(c))));
      const place = ranking.find(({ key }) => key === character.row.id);
      if (place) {
        rankings.push({ category: category.id, label: category.label, place: place.place, display: category.display(place.value) });
      }
    }
    const badge = this.badgeRanking(snapshot).find(({ key }) => key === character.row.id);
    if (badge) {
      rankings.push({ category: BADGE_CATEGORY.id, label: BADGE_CATEGORY.label, place: badge.place, display: BADGE_CATEGORY.display(badge.value) });
    }
    return rankings;
  }

  private snapshot(): Promise<Snapshot> {
    const now = Date.now();
    if (this.cache && now - this.cache.loadedAt < CACHE_MS) return this.cache.snapshot;
    const snapshot = this.load();
    const entry = { loadedAt: now, snapshot };
    this.cache = entry;
    // A failed load must not be remembered for the next minute.
    snapshot.catch(() => {
      if (this.cache === entry) this.cache = null;
    });
    return snapshot;
  }

  private async load(): Promise<Snapshot> {
    const today = serverToday();
    const rows = await this.repo.loadRows();
    const stats = computeStats(rows, today);
    const levels = new Map<number, number>();
    for (const account of stats.accounts.values()) levels.set(account.userId, levelsDone(account));
    const optionRules = new Map(rows.optionRules.map(({ magic, ...rule }) => [magic, rule]));
    return {
      stats,
      levels,
      optionRules,
      upgradeAttempts: rows.upgradeAttempts,
      upgradeLosses: rows.upgradeLosses,
    };
  }
}

function gearViews(character: CharacterStatsRow, optionRules: ReadonlyMap<number, OptionRule>): GearItem[] {
  const now = serverNow();
  return [...character.gear]
    .sort((a, b) => a.slot - b.slot)
    .map((item) => {
      const name = itemName(item.itemId, item.name);
      return {
        slot: item.slot,
        slotName: SLOT_NAMES[item.slot] ?? `Slot ${item.slot}`,
        itemId: item.itemId,
        name,
        icon: itemIcons[item.itemId] ?? null,
        upgrade: item.upgrade,
        gradeEffect: item.gradeEffect,
        moggItemId: item.moggItemId,
        tooltip: buildItemTooltip(item, name, tooltipCharts, optionRules, now),
      };
    });
}

const candidate = (character: CharacterStatsRow, value: number) => ({ key: character.row.id, name: character.row.name, value });

function hallEntry(
  category: Pick<Category, 'display' | 'detail'>,
  { place, name, value }: Ranked<number>,
  character: CharacterStatsRow,
  mine: boolean,
): HallEntry {
  return {
    characterId: character.row.id,
    place,
    name,
    className: className(character.row.classCode),
    level: character.row.level,
    display: category.display(value),
    detail: category.detail?.(character) ?? null,
    mine,
  };
}

// The API runs on the same machine as the game, so its clock is the server's.
/** The server's wall clock held as UTC, the same way the database driver reads its dates. */
export function serverNow(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds()));
}

function serverToday(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
