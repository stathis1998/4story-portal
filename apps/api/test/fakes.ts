import {
  type AchievementsRepository,
  ANNOUNCE_SENT,
  ANNOUNCE_WAITING,
  AWARD_ALREADY_GIVEN,
  AWARD_NO_CHARACTER,
  AWARD_SWITCHED_OFF,
  NO_CHARACTER,
  type AwardInput,
  type AwardRow,
  isEmptyReward,
  type RewardItemRow,
  type RewardRow,
} from '../src/achievements/achievements.repository.js';
import type { ControlState, PositionDestination } from '@4story-portal/shared';
import type { AccountRecord, AccountsRepository } from '../src/auth/accounts.repository.js';
import type { CharacterRow, CharactersRepository, GearEffectRow, LevelFreezeRow } from '../src/characters/characters.repository.js';
import type { AuditEntry, GmRepository, LoginRow, OnlinePlayerRow } from '../src/gm/gm.repository.js';
import type {
  MailCharacterRow,
  MailItemRow,
  MailLetter,
  MailRecipientRow,
  MailRepository,
} from '../src/gm/mail.repository.js';
import type { ItemRow, PriceColumn, StockRow, VendorRow, VendorsRepository } from '../src/gm/vendors.repository.js';
import type { StatRows } from '../src/stats/stats-rules.js';
import type { StatsRepository } from '../src/stats/stats.repository.js';
import { type ControlClient, ControlUnavailableError } from '../src/control/control-client.js';
import {
  ANNOUNCE_SENT as WHEEL_ANNOUNCE_SENT,
  ANNOUNCE_SKIPPED as WHEEL_ANNOUNCE_SKIPPED,
  ANNOUNCE_WAITING as WHEEL_ANNOUNCE_WAITING,
  type PrizeInput,
  type PrizeRow,
  SPIN_ALREADY_TODAY,
  SPIN_BAD_CHARACTER,
  SPIN_PRIZE_GONE,
  SPIN_SWITCHED_OFF,
  type SpinInput,
  type SpinRow,
  type WheelItemRow,
  type WheelRepository,
} from '../src/wheel/wheel.repository.js';
import {
  BRONZE_PER_GOLD,
  BRONZE_PER_SILVER,
  REBIRTH_DEFAULT_SETTINGS,
  type RebirthSettings,
  REBIRTH_LEVEL,
  rebirthBonus,
  rebirthExtraBonus,
  rebirthIsOpen,
  rebirthPriceGold,
  ROULETTE_DEFAULT_LIMITS,
  SLOT_BIG_WIN,
  SLOT_DAILY_DEFAULT,
  SLOT_JACKPOT_ROLLS,
  SLOT_MACHINE_KEYS,
  SLOT_MACHINES,
  SLOT_POT_DEFAULT_CAP,
  SLOT_POT_ROW,
  SLOT_POTS,
  slotJackpotDrops,
  type SlotMachineKey,
  type SlotMeterView,
  type SlotPot,
  type SlotPotsSettingsInput,
  type Wallet,
} from '@4story-portal/shared';
import {
  SLOT_DAILY_REFUSED,
  SLOT_METER_REFUSED,
  type SlotBetInput,
  type SlotBetOutcome,
  type SlotJackpotTotalsRow,
  type SlotPotRow,
  type SlotRefusal,
  type SlotSettings,
  type SlotSpinRow,
  type SlotsRepository,
  type SlotTotalsRow,
  SLOT_RULES,
} from '../src/slots/slots.repository.js';
import {
  type BetInput,
  type RouletteRepository,
  type RouletteSettings,
  type RouletteSpinRow,
  type RouletteTotalsRow,
} from '../src/roulette/roulette.repository.js';
import { BET_CLOSED, BET_NOT_YOURS, BET_OK, BET_ONLINE, BET_POOR, type BetCode, type BetOutcome } from '../src/games/wallet-bet.js';
import type { WalletCharacterRow, WalletsRepository } from '../src/games/wallets.repository.js';
import { type ControlEvent, EVENT_KIND, type EventKind } from '../src/control/control-protocol.js';
import {
  REBIRTH_AT_LIMIT,
  REBIRTH_CLOSED,
  REBIRTH_LOW_LEVEL,
  REBIRTH_NOT_YOURS,
  REBIRTH_OK,
  REBIRTH_ONLINE,
  REBIRTH_POOR,
  REBIRTH_PRICE_CHANGED,
  REBIRTH_WEARING,
} from '../src/rebirth/rebirth-sql.js';
import {
  ANNOUNCE_SENT as REBIRTH_ANNOUNCE_SENT,
  ANNOUNCE_WAITING as REBIRTH_ANNOUNCE_WAITING,
  type RebirthCharacterRow,
  type RebirthInput,
  type RebirthLogRow,
  type RebirthOutcome,
  type RebirthRepository,
  type RebirthRewardRow,
} from '../src/rebirth/rebirth.repository.js';

// A TCHARTABLE row with plausible defaults (a level 1 human wizard from Defugel).
export function characterRow(overrides: Partial<CharacterRow> = {}): CharacterRow {
  return {
    dwCharID: 1,
    bSlot: 0,
    szNAME: 'Hero',
    bLevel: 1,
    bClass: 3,
    bRace: 0,
    bCountry: 0,
    dwGold: 0,
    dwSilver: 0,
    dwCooper: 0,
    wMapID: 0,
    dCreateDate: null,
    dLogoutDate: null,
    rebirth: 0,
    ...overrides,
  };
}

export class FakeCharactersRepository implements CharactersRepository {
  readonly rowsByUser = new Map<number, CharacterRow[]>();
  readonly requestedUserIds: number[] = [];

  async listByUser(userId: number): Promise<CharacterRow[]> {
    this.requestedUserIds.push(userId);
    return this.rowsByUser.get(userId) ?? [];
  }

  readonly freezes = new Map<number, LevelFreezeRow & { userId: number }>();

  async findLevelFreeze(userId: number, charId: number): Promise<LevelFreezeRow | null> {
    const row = this.freezes.get(charId);
    if (!row || row.userId !== userId) return null;
    return { level: row.level, freezeLevel: row.freezeLevel, online: row.online };
  }

  async saveLevelFreeze(charId: number, level: number | null): Promise<void> {
    this.freezes.get(charId)!.freezeLevel = level;
  }

  /** Only the items that can carry an effect, as the SQL filters them. */
  readonly gearEffects = new Map<number, GearEffectRow & { userId: number }>();

  async findGearEffect(userId: number, charId: number): Promise<GearEffectRow | null> {
    const row = this.gearEffects.get(charId);
    if (!row || row.userId !== userId) return null;
    return { online: row.online, items: row.items.map((item) => ({ ...item })) };
  }

  async saveGearEffect(charId: number, effect: number): Promise<number> {
    const row = this.gearEffects.get(charId)!;
    if (row.online) return 0;
    for (const item of row.items) item.effect = effect;
    return row.items.length;
  }
}

// In-memory stand-in for the accounts table. Usernames compare case-insensitively and lookups
// return the stored spelling, like the game database's collation.
export class FakeAccountsRepository implements AccountsRepository {
  readonly accounts: AccountRecord[] = [];
  private nextId = 100;

  seed(username: string, passwordHash: string): AccountRecord {
    const account = { userId: this.nextId++, username, passwordHash };
    this.accounts.push(account);
    return account;
  }

  async findByUsername(username: string): Promise<AccountRecord | null> {
    return this.accounts.find((a) => a.username.toLowerCase() === username.toLowerCase()) ?? null;
  }

  async createAccount(username: string, passwordHash: string): Promise<number | null> {
    if (await this.findByUsername(username)) return null;
    return this.seed(username, passwordHash).userId;
  }
}

// Stands in for the TControlSvr connection: connected to one world by default, and logs each move
// instead of sending it.
export class FakeStatsRepository implements StatsRepository {
  rows: StatRows = { characters: [], sessions: [], gear: [], companions: [], titles: [], titlesTotal: 110, optionRules: [], social: [], combat: [], spending: [], soulLottery: [], lotteryStreaks: [], upgradeAttempts: [], upgradeLosses: [], upgradeFailures: [], progress: [], pets: [], accounts: [] };
  loads = 0;
  failWith?: Error;

  async loadRows(): Promise<StatRows> {
    this.loads++;
    if (this.failWith) throw this.failWith;
    return this.rows;
  }
}

export class FakeControlClient
  implements Pick<ControlClient, 'status' | 'moveToPosition' | 'moveToCharacter' | 'kick' | 'announce' | 'listEvents' | 'changeEvent'>
{
  state: ControlState = 'connected';
  worlds: { id: number; name: string }[] = [{ id: 1, name: 'Lapiris' }];
  readonly moves: unknown[] = [];
  readonly kicks: string[] = [];
  readonly announcements: string[] = [];
  events: ControlEvent[] = [];
  readonly changes: { kind: EventKind; event: ControlEvent }[] = [];
  /** What the server answers a change with. */
  changeResult = 0;
  /** Thrown by event requests, after a list has succeeded when failOnlyChange is set. */
  failWith?: Error;
  failOnlyChange = false;
  nextIndex = 50;
  /** Runs after each kick: a test uses it to play the game server logging a real session out. */
  onKick?: (name: string) => void;

  status(): { state: ControlState; worlds: { id: number; name: string }[] } {
    return { state: this.state, worlds: this.worlds };
  }

  moveToPosition(p: PositionDestination, names: string[]): void {
    this.requireConnected();
    this.moves.push({ kind: 'position', ...p, names });
  }

  moveToCharacter(world: number, target: string, names: string[]): void {
    this.requireConnected();
    this.moves.push({ kind: 'character', world, target, names });
  }

  kick(name: string): void {
    this.requireConnected();
    this.kicks.push(name);
    this.onKick?.(name);
  }

  announce(text: string): void {
    this.requireConnected();
    this.announcements.push(text);
  }

  async listEvents(): Promise<ControlEvent[]> {
    this.requireConnected();
    if (this.failWith && !this.failOnlyChange) throw this.failWith;
    return this.events;
  }

  async changeEvent(kind: EventKind, event: ControlEvent): Promise<{ result: number; event: ControlEvent }> {
    this.requireConnected();
    if (this.failWith) throw this.failWith;
    this.changes.push({ kind, event });
    return {
      result: this.changeResult,
      event: kind === EVENT_KIND.ADD ? { ...event, index: this.nextIndex++ } : event,
    };
  }

  private requireConnected(): void {
    if (this.state !== 'connected') throw new ControlUnavailableError();
  }
}

export class FakeGmRepository implements GmRepository {
  players: OnlinePlayerRow[] = [];
  channels: number[] = [1, 2, 3, 50];
  hostedMaps: number[] = [0];
  hosted = true;
  logins: LoginRow[] = [];
  /** Plays the row vanishing between the last check and the delete. */
  loginGoesBeforeDelete = false;
  failAudit = false;
  readonly deletedLogins: number[] = [];
  readonly audits: AuditEntry[] = [];

  async listOnlinePlayers(): Promise<OnlinePlayerRow[]> {
    return this.players;
  }

  async listChannels(): Promise<number[]> {
    return this.channels;
  }
  async listHostedMaps(): Promise<number[]> {
    return this.hostedMaps;
  }

  async isLocationHosted(): Promise<boolean> {
    return this.hosted;
  }

  async listLogins(): Promise<LoginRow[]> {
    return this.logins;
  }

  async findLogin(key: number): Promise<LoginRow | null> {
    return this.logins.find((login) => login.key === key) ?? null;
  }

  async deleteLogin(key: number): Promise<boolean> {
    if (this.loginGoesBeforeDelete) return false;
    this.deletedLogins.push(key);
    this.logins = this.logins.filter((login) => login.key !== key);
    return true;
  }

  async writeAudit(e: AuditEntry): Promise<void> {
    if (this.failAudit) throw new Error('audit failed');
    this.audits.push(e);
  }
}

// In-memory stand-in for the vendor tables. `stock` maps a vendor id to its item ids.
export class FakeVendorsRepository implements VendorsRepository {
  vendors: VendorRow[] = [];
  items: ItemRow[] = [];
  stock = new Map<number, number[]>();
  /** Each setPrice call as [itemId, column, multiplier]. */
  readonly prices: [number, PriceColumn, number][] = [];

  async listVendors(): Promise<VendorRow[]> {
    return this.vendors;
  }

  async findVendor(id: number): Promise<VendorRow | null> {
    return this.vendors.find((v) => v.id === id) ?? null;
  }

  async listStock(vendorId: number): Promise<StockRow[]> {
    const ids = [...(this.stock.get(vendorId) ?? [])].sort((a, b) => a - b);
    return ids.map((id): StockRow => {
      const item = this.items.find((i) => i.itemId === id);
      if (item) return item;
      return { itemId: id, name: null, level: 0, stack: 0, classMask: 0, itemCountry: 0, money: 0, pvpMoney: 0, fPrice: 0, fPvPrice: 0, sellFlags: 0, moneySoldBy: 0, pvpSoldBy: 0 };
    });
  }

  async findItem(itemId: number): Promise<ItemRow | null> {
    return this.items.find((i) => i.itemId === itemId) ?? null;
  }

  async searchItems(): Promise<ItemRow[]> {
    return this.items;
  }

  async addStock(vendorId: number, itemId: number): Promise<boolean> {
    const ids = this.stock.get(vendorId) ?? [];
    if (ids.includes(itemId)) return false;
    this.stock.set(vendorId, [...ids, itemId]);
    return true;
  }

  async removeStock(vendorId: number, itemId: number): Promise<boolean> {
    const ids = this.stock.get(vendorId) ?? [];
    if (!ids.includes(itemId)) return false;
    this.stock.set(vendorId, ids.filter((id) => id !== itemId));
    return true;
  }

  async setPrice(itemId: number, column: PriceColumn, multiplier: number): Promise<void> {
    this.prices.push([itemId, column, multiplier]);
  }
}

// In-memory stand-in for the mail procedure. Post ids count up from 1000 for letters that are written.
export class FakeMailRepository implements MailRepository {
  characters: MailRecipientRow[] = [];
  items: MailItemRow[] = [];
  readonly sent: MailLetter[] = [];
  /** Character ids for which the procedure returns 0, as if the character was deleted after the check. */
  missingOnSend = new Set<number>();
  /** Character ids for which the call throws. */
  failOnSend = new Set<number>();
  /** Character ids that count as logged in. */
  online = new Set<number>();
  private nextPostId = 1000;

  async findCharacters(names: string[]): Promise<MailRecipientRow[]> {
    const wanted = new Set(names.map((name) => name.toLowerCase()));
    return this.characters.filter((c) => wanted.has(c.name.toLowerCase()));
  }

  async listCharacters(): Promise<MailCharacterRow[]> {
    return [...this.characters]
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
      .map((c) => ({ ...c, level: 1, classCode: 0, online: this.online.has(c.charId) }));
  }

  async findItems(itemIds: number[]): Promise<MailItemRow[]> {
    return this.items.filter((item) => itemIds.includes(item.itemId));
  }

  async sendLetter(letter: MailLetter): Promise<number> {
    if (this.failOnSend.has(letter.charId)) throw new Error('db down');
    if (this.missingOnSend.has(letter.charId)) return 0;
    this.sent.push(letter);
    return this.nextPostId++;
  }
}

// Stands in for the achievement tables and TPortalAchievementAward: everything lives in memory.
export class FakeAchievementsRepository implements AchievementsRepository {
  liveFlag = false;
  readonly liveChanges: { live: boolean; changedBy: string }[] = [];
  rewardRows: RewardRow[] = [];
  rows: AwardRow[] = [];
  /** Characters the "database" no longer has: awarding to one writes nothing. */
  readonly goneCharacters = new Set<number>();
  items: RewardItemRow[] = [];
  /** Everything award() was asked for, including calls that awarded nothing. */
  readonly sent: AwardInput[] = [];
  /** The letters that went out, with the reward the "database" attached. */
  readonly letters: { charId: number; title: string; message: string; reward: RewardRow | null }[] = [];
  active = true;
  activeChecks = 0;
  /** The database's clock: stamps new awards and ages old ones. */
  now = () => new Date();
  /** Every call fails with this. */
  failWith?: Error;
  /** Awards this returns true for fail. */
  failAward?: (input: AwardInput) => boolean;
  /** Runs after each award that was given: a test uses it to change something mid-batch. */
  onAward?: () => void;
  /** Plays another portal process that takes every announcement first. */
  claimedElsewhere = false;
  private nextId = 1;

  async live(): Promise<boolean> {
    if (this.failWith) throw this.failWith;
    return this.liveFlag;
  }

  async setLive(live: boolean, changedBy: string): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.liveFlag = live;
    this.liveChanges.push({ live, changedBy });
  }

  async rewards(): Promise<RewardRow[]> {
    if (this.failWith) throw this.failWith;
    return this.rewardRows;
  }

  async setReward(reward: RewardRow): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.rewardRows = this.rewardRows.filter((row) => !(row.achievementId === reward.achievementId && row.level === reward.level));
    if (!isEmptyReward(reward)) this.rewardRows.push(reward);
  }

  async awards(): Promise<AwardRow[]> {
    if (this.failWith) throw this.failWith;
    const now = this.now().getTime();
    return this.rows.map((row) => ({ ...row, ageSeconds: Math.floor((now - row.earnedAt.getTime()) / 1000) }));
  }

  async award(input: AwardInput): Promise<number> {
    if (this.failWith) throw this.failWith;
    this.sent.push(input);
    if (this.failAward?.(input)) throw new Error('award failed');
    if (!this.liveFlag) return AWARD_SWITCHED_OFF;
    const given = this.rows.some(
      (row) =>
        row.userId === input.userId &&
        row.charId === input.charId &&
        row.rebirth === input.rebirth &&
        row.achievementId === input.achievementId &&
        row.level === input.level,
    );
    if (given) return AWARD_ALREADY_GIVEN;
    // Only a character gets a letter, and with it the level's reward.
    if (input.charId !== NO_CHARACTER) {
      if (this.goneCharacters.has(input.charId)) return AWARD_NO_CHARACTER;
      const reward = this.rewardRows.find((row) => row.achievementId === input.achievementId && row.level === input.level) ?? null;
      this.letters.push({ charId: input.charId, title: input.title, message: input.message + (reward ? input.rewardNote : ''), reward });
    }
    const id = this.nextId++;
    this.rows.push({
      id,
      userId: input.userId,
      charId: input.charId,
      rebirth: input.rebirth,
      achievementId: input.achievementId,
      level: input.level,
      earnedAt: this.now(),
      ageSeconds: 0,
      text: input.text,
      announced: ANNOUNCE_WAITING,
    });
    this.onAward?.();
    return id;
  }


  async claimAnnouncement(id: number): Promise<boolean> {
    const row = this.rows.find((entry) => entry.id === id);
    if (!row || row.announced !== ANNOUNCE_WAITING) return false;
    row.announced = ANNOUNCE_SENT;
    return !this.claimedElsewhere;
  }

  async markAnnounced(id: number, state: number): Promise<void> {
    const row = this.rows.find((entry) => entry.id === id);
    if (row) row.announced = state;
  }

  async recentlyActive(): Promise<boolean> {
    this.activeChecks++;
    return this.active;
  }

  async findItems(itemIds: number[]): Promise<RewardItemRow[]> {
    return this.items.filter((item) => itemIds.includes(item.itemId));
  }
}

// In-memory stand-in for the wheel's tables and TPortalWheelSpin.
export class FakeWheelRepository implements WheelRepository {
  liveFlag = false;
  prizeRows: PrizeRow[] = [];
  spinRows: SpinRow[] = [];
  /** The characters the "database" has, for the checks the procedure makes. */
  characters: { charId: number; userId: number; name: string; level: number }[] = [];
  items: WheelItemRow[] = [];
  /** Everything spin() was asked for, including calls that wrote nothing. */
  readonly asked: SpinInput[] = [];
  /** The database's clock: stamps new spins, ages old ones and decides the day. */
  now = () => new Date();
  /** Every call fails with this. */
  failWith?: Error;
  /** Runs before each spin is checked: a test uses it to change a prize after the pick. */
  beforeSpin?: (input: SpinInput) => void;
  /** Plays another portal process that takes every announcement first. */
  claimedElsewhere = false;
  private nextPrizeId = 1;
  private nextSpinId = 1;

  private check(): void {
    if (this.failWith) throw this.failWith;
  }

  private day(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private aged(row: SpinRow): SpinRow {
    return { ...row, ageSeconds: Math.floor((this.now().getTime() - row.spunAt.getTime()) / 1000) };
  }

  /** Adds a prize the way a test wants it, and returns its row. */
  addPrize(prize: Partial<PrizeInput> = {}): PrizeRow {
    const row: PrizeRow = {
      id: this.nextPrizeId++,
      name: 'Prize',
      weight: 1,
      order: this.prizeRows.length,
      enabled: true,
      announce: false,
      gold: 1,
      silver: 0,
      copper: 0,
      items: [],
      ...prize,
    };
    this.prizeRows.push(row);
    return row;
  }

  async live(): Promise<boolean> {
    this.check();
    return this.liveFlag;
  }

  async setLive(live: boolean): Promise<void> {
    this.check();
    this.liveFlag = live;
  }

  async prizes(): Promise<PrizeRow[]> {
    this.check();
    return [...this.prizeRows].sort((a, b) => a.order - b.order || a.id - b.id);
  }

  async createPrize(prize: PrizeInput): Promise<number> {
    this.check();
    return this.addPrize(prize).id;
  }

  async updatePrize(id: number, prize: PrizeInput): Promise<boolean> {
    this.check();
    const index = this.prizeRows.findIndex((row) => row.id === id);
    if (index < 0) return false;
    this.prizeRows[index] = { id, ...prize };
    return true;
  }

  async deletePrize(id: number): Promise<boolean> {
    this.check();
    const before = this.prizeRows.length;
    this.prizeRows = this.prizeRows.filter((row) => row.id !== id);
    return this.prizeRows.length < before;
  }

  async spin(input: SpinInput): Promise<number> {
    this.check();
    this.asked.push(input);
    this.beforeSpin?.(input);
    if (!this.liveFlag) return SPIN_SWITCHED_OFF;
    const now = this.now();
    if (this.spinRows.some((row) => row.userId === input.userId && this.day(row.spunAt) === this.day(now))) return SPIN_ALREADY_TODAY;
    const character = this.characters.find((row) => row.charId === input.charId && row.userId === input.userId && row.level >= input.minLevel);
    if (!character) return SPIN_BAD_CHARACTER;
    const prize = this.prizeRows.find((row) => row.id === input.prizeId && row.enabled);
    if (!prize) return SPIN_PRIZE_GONE;
    const id = this.nextSpinId++;
    this.spinRows.push({
      id,
      userId: input.userId,
      charId: character.charId,
      character: character.name,
      spunAt: now,
      ageSeconds: 0,
      prizeId: prize.id,
      prize: prize.name,
      gold: prize.gold,
      silver: prize.silver,
      copper: prize.copper,
      items: prize.items,
      text: input.text.replace('{prize}', prize.name).replace('{name}', character.name),
      announce: prize.announce,
      announced: prize.announce ? WHEEL_ANNOUNCE_WAITING : WHEEL_ANNOUNCE_SKIPPED,
    });
    return id;
  }

  async today(userId: number): Promise<SpinRow | null> {
    this.check();
    const row = this.spinRows.find((entry) => entry.userId === userId && this.day(entry.spunAt) === this.day(this.now()));
    return row ? this.aged(row) : null;
  }

  async secondsToReset(): Promise<number> {
    this.check();
    const now = this.now();
    return 86_400 - (now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds());
  }

  private newestFirst(keep: (row: SpinRow) => boolean, limit: number): SpinRow[] {
    return this.spinRows
      .filter(keep)
      .sort((a, b) => b.id - a.id)
      .slice(0, limit)
      .map((row) => this.aged(row));
  }

  async spinsOf(userId: number, limit: number): Promise<SpinRow[]> {
    this.check();
    return this.newestFirst((row) => row.userId === userId, limit);
  }

  async winners(limit: number): Promise<SpinRow[]> {
    this.check();
    return this.newestFirst((row) => row.announce, limit);
  }

  async spinsToday(): Promise<number> {
    this.check();
    return this.spinRows.filter((row) => this.day(row.spunAt) === this.day(this.now())).length;
  }

  async waitingAnnouncements(): Promise<SpinRow[]> {
    this.check();
    return this.spinRows.filter((row) => row.announce && row.announced === WHEEL_ANNOUNCE_WAITING).map((row) => this.aged(row));
  }

  async claimAnnouncement(id: number): Promise<boolean> {
    const row = this.spinRows.find((entry) => entry.id === id);
    if (!row || row.announced !== WHEEL_ANNOUNCE_WAITING) return false;
    row.announced = WHEEL_ANNOUNCE_SENT;
    return !this.claimedElsewhere;
  }

  async markAnnounced(id: number, state: number): Promise<void> {
    const row = this.spinRows.find((entry) => entry.id === id);
    if (row) row.announced = state;
  }

  async findItems(itemIds: number[]): Promise<WheelItemRow[]> {
    this.check();
    return this.items.filter((item) => itemIds.includes(item.itemId));
  }
}

/** What a game's bet hands the wallet batch: whole Silver. */
export type FakeWalletMove = { userId: number; charId: number; stake: number; payout: number };
export type FakeWalletMoved =
  | { code: typeof BET_OK; name: string; wallet: Wallet }
  | { code: Exclude<BetCode, typeof BET_OK>; name: string | null };

// In-memory stand-in for the accounts' wallets, and for what the shared bet batch does to them, so every
// game's fake pays from and to the same rows.
export class FakeWalletsRepository implements WalletsRepository {
  rows: (WalletCharacterRow & { userId: number })[] = [];
  /** characters() rejects. */
  failing = false;

  async characters(userId: number): Promise<WalletCharacterRow[]> {
    if (this.failing) throw new Error('Invalid object name TCHARTABLE');
    return this.rows.filter((row) => row.userId === userId).map(({ userId: _owner, ...row }) => row);
  }

  /** The batch's checks and arithmetic, in the same order; `live` is the game's switch. */
  move(input: FakeWalletMove, live: boolean): FakeWalletMoved {
    return this.moveWith(input, live, () => 0, () => 0) as FakeWalletMoved;
  }

  /**
   * The same with a game's own steps, where the real batch runs them: `check` once every shared check has passed,
   * returning 0 or the game's code (then nothing moves); `before` after it, returning extra whole Silver paid with the
   * payout. Either may throw, as a THROW in the batch does; nothing has moved by then.
   */
  moveWith<C extends number>(input: FakeWalletMove, live: boolean, check: () => C | 0, before: () => number): FakeWalletMoved | { code: C; name: string } {
    // The real batch refuses the same way, before it reads anything.
    if (input.stake < 0 || input.payout < 0) throw new Error('Stake and payout cannot be negative');
    if (!live) return { code: BET_CLOSED, name: null };
    const row = this.rows.find((c) => c.charId === input.charId && c.userId === input.userId);
    if (!row) return { code: BET_NOT_YOURS, name: null };
    if (row.online) return { code: BET_ONLINE, name: row.name };
    // Bronze, like the database.
    const held = row.gold * 1_000_000 + row.silver * 1000 + row.copper;
    if (held < input.stake * 1000) return { code: BET_POOR, name: row.name };
    const code = check();
    if (code !== 0) return { code, name: row.name };
    const extra = before();
    if (!(extra >= 0)) throw new Error('Extra cannot be negative');
    const after = held - input.stake * 1000 + (input.payout + extra) * 1000;
    row.gold = Math.floor(after / 1_000_000);
    row.silver = Math.floor(after / 1000) % 1000;
    row.copper = after % 1000;
    return { code: BET_OK, name: row.name, wallet: { gold: row.gold, silver: row.silver, copper: row.copper } };
  }
}

// In-memory stand-in for the roulette's settings and spin table; it pays from and to `wallets`.
export class FakeRouletteRepository implements RouletteRepository {
  settingsRow: RouletteSettings = { live: false, ...ROULETTE_DEFAULT_LIMITS };
  spinRows: (RouletteSpinRow & { numberHit: boolean; bets: string })[] = [];
  /** The database's clock: stamps new spins and decides today. */
  now: () => Date = () => new Date();
  /** Every bet() call, including the ones that changed nothing. */
  readonly betCalls: BetInput[] = [];
  private nextId = 1;
  private down = false;

  constructor(readonly wallets: FakeWalletsRepository = new FakeWalletsRepository()) {}

  /** The wallets' rows, which the bet pays from and to. */
  get characterRows(): (WalletCharacterRow & { userId: number })[] {
    return this.wallets.rows;
  }
  set characterRows(rows: (WalletCharacterRow & { userId: number })[]) {
    this.wallets.rows = rows;
  }

  /** Every call rejects, the wallets' list too, as when the page can read nothing at all. */
  get failing(): boolean {
    return this.down;
  }
  set failing(value: boolean) {
    this.down = value;
    this.wallets.failing = value;
  }

  private check(): void {
    if (this.down) throw new Error('Invalid object name TPortalRouletteSpin');
  }

  private plain(row: RouletteSpinRow & { numberHit?: boolean; bets?: string }): RouletteSpinRow {
    const { id, userId, character, spunAt, pocket, stake, payout } = row;
    return { id, userId, character, spunAt, pocket, stake, payout };
  }

  async settings(): Promise<RouletteSettings> {
    this.check();
    return { ...this.settingsRow };
  }

  async saveSettings(settings: RouletteSettings): Promise<void> {
    this.check();
    this.settingsRow = { ...settings };
  }

  async bet(input: BetInput): Promise<BetOutcome> {
    this.check();
    this.betCalls.push(input);
    const moved = this.wallets.move(input, this.settingsRow.live);
    if (moved.code !== BET_OK) return moved;
    const id = this.nextId++;
    this.spinRows.push({
      id,
      userId: input.userId,
      character: moved.name,
      spunAt: this.now(),
      pocket: input.pocket,
      stake: input.stake,
      payout: input.payout,
      numberHit: input.numberHit,
      bets: input.bets,
    });
    return { code: BET_OK, id, wallet: moved.wallet };
  }

  private newest(rows: typeof this.spinRows, limit: number): RouletteSpinRow[] {
    return [...rows].sort((a, b) => b.id - a.id).slice(0, limit).map((row) => this.plain(row));
  }

  async spinsOf(userId: number, limit: number): Promise<RouletteSpinRow[]> {
    this.check();
    return this.newest(this.spinRows.filter((row) => row.userId === userId), limit);
  }

  async bigWins(limit: number): Promise<RouletteSpinRow[]> {
    this.check();
    return this.newest(this.spinRows.filter((row) => row.numberHit), limit);
  }

  async latest(limit: number): Promise<RouletteSpinRow[]> {
    this.check();
    return this.newest(this.spinRows, limit);
  }

  async totals(): Promise<{ today: RouletteTotalsRow; allTime: RouletteTotalsRow }> {
    this.check();
    const sum = (rows: typeof this.spinRows): RouletteTotalsRow => ({
      spins: rows.length,
      staked: rows.reduce((total, row) => total + row.stake, 0),
      paid: rows.reduce((total, row) => total + row.payout, 0),
    });
    const day = this.now().toISOString().slice(0, 10);
    return { today: sum(this.spinRows.filter((row) => row.spunAt.toISOString().slice(0, 10) === day)), allTime: sum(this.spinRows) };
  }
}

/** A planted or written spin row. `added` is the round's whole add in Bronze, like llAdded; `adds` each pot's (absent on a row from before the three pots). `rules` 1 is an old three-reel row, 2 a five-reel one. */
export type FakeSlotSpinRow = SlotSpinRow & { multiple: number; added: number; adds?: Record<SlotPot, number>; rules?: number };

/** The pots in the order the real batch locks their rows: 1 (Giga), 2 (Mini), 3 (Major). */
const SLOT_POTS_BY_ROW = [...SLOT_POTS].sort((a, b) => SLOT_POT_ROW[a] - SLOT_POT_ROW[b]);

// In-memory stand-in for the slots' settings, spin table, meters and pots; it pays from and to `wallets`.
export class FakeSlotsRepository implements SlotsRepository {
  settingsRow: SlotSettings = {
    live: false,
    machines: Object.fromEntries(SLOT_MACHINES.map((m) => [m.key, { live: true, stakes: [...m.stakes] }])) as SlotSettings['machines'],
    pots: {
      mini: { live: true, cap: SLOT_POT_DEFAULT_CAP.mini },
      major: { live: true, cap: SLOT_POT_DEFAULT_CAP.major },
      giga: { live: true, cap: SLOT_POT_DEFAULT_CAP.giga },
    },
    daily: SLOT_DAILY_DEFAULT,
  };
  /** machine is a string so a test can plant a spin for a machine the code no longer has. */
  spinRows: FakeSlotSpinRow[] = [];
  /** The three pots' rows, in Bronze; `cap` is null until a lost round first adds to the pot. */
  potRows: Record<SlotPot, { amount: number; cap: number | null }> = {
    mini: { amount: 0, cap: null },
    major: { amount: 0, cap: null },
    giga: { amount: 0, cap: null },
  };
  /** The pots cannot be read (no table, or a database without rows 2 and 3): pots() rejects, and so does a bet that feeds one. */
  potMissing = false;
  /** One row per account, machine and stake (whole Silver). machine is a string so a test can plant a retired one. */
  meterRows: { userId: number; machine: string; stake: number; points: number }[] = [];
  /** The database's clock: stamps new spins and decides today. */
  now: () => Date = () => new Date();
  /** Every bet() call, including the ones that changed nothing. */
  readonly betCalls: SlotBetInput[] = [];
  /** The slots' own tables reject. The wallets' list is another table and has its own flag (`wallets.failing`). */
  failing = false;
  /**
   * The spin table is one from before this change: the bet and the lists name columns it lacks and reject,
   * while the settings, the pots, the meters, the day's count and the totals still read.
   */
  columnsMissing = false;
  private nextId = 1;

  constructor(readonly wallets: FakeWalletsRepository = new FakeWalletsRepository()) {}

  /** The wallets' rows, which the bet pays from and to. */
  get characterRows(): (WalletCharacterRow & { userId: number })[] {
    return this.wallets.rows;
  }
  set characterRows(rows: (WalletCharacterRow & { userId: number })[]) {
    this.wallets.rows = rows;
  }

  private check(): void {
    if (this.failing) throw new Error('Invalid object name TPortalSlotSpin');
  }

  private checkColumns(): void {
    if (this.columnsMissing) throw new Error("Invalid column name 'szMeterFree'.");
  }

  private plain({ multiple: _multiple, added: _added, adds: _adds, rules: _rules, ...row }: FakeSlotSpinRow): SlotSpinRow {
    return row;
  }

  /** The lists leave out rows of older rules; the totals keep them. */
  private current(): FakeSlotSpinRow[] {
    return this.spinRows.filter((row) => (row.rules ?? SLOT_RULES) === SLOT_RULES);
  }

  /** The database's day, as totals() reads it. */
  private isToday(at: Date): boolean {
    return at.toISOString().slice(0, 10) === this.now().toISOString().slice(0, 10);
  }

  private meterRow(userId: number, machine: string, stake: number) {
    return this.meterRows.find((row) => row.userId === userId && row.machine === machine && row.stake === stake);
  }

  async settings(): Promise<SlotSettings> {
    this.check();
    return structuredClone(this.settingsRow);
  }

  async saveFloor(live: boolean): Promise<void> {
    this.check();
    this.settingsRow.live = live;
  }

  async saveMachine(key: SlotMachineKey, settings: { live: boolean; stakes: [number, number, number] }): Promise<void> {
    this.check();
    this.settingsRow.machines[key] = { live: settings.live, stakes: [...settings.stakes] };
  }

  async savePots(input: SlotPotsSettingsInput): Promise<void> {
    this.check();
    this.settingsRow.pots = structuredClone(input);
  }

  async saveDaily(rounds: number): Promise<void> {
    this.check();
    this.settingsRow.daily = rounds;
  }

  async pots(): Promise<SlotPotRow[]> {
    this.check();
    if (this.potMissing) throw new Error('Invalid object name TPortalSlotJackpot');
    return SLOT_POTS.map((pot) => ({ pot, ...this.potRows[pot] }));
  }

  async meters(userId: number): Promise<SlotMeterView[]> {
    this.check();
    return this.meterRows
      .filter((row): row is typeof row & { machine: SlotMachineKey } => row.userId === userId && (SLOT_MACHINE_KEYS as readonly string[]).includes(row.machine))
      .sort((a, b) => (a.machine === b.machine ? a.stake - b.stake : a.machine < b.machine ? -1 : 1))
      .map(({ machine, stake, points }) => ({ machine, stake, points }));
  }

  async meter(userId: number, machine: SlotMachineKey, stake: number): Promise<number> {
    this.check();
    return this.meterRow(userId, machine, stake)?.points ?? 0;
  }

  async roundsToday(userId: number): Promise<number> {
    this.check();
    return this.spinRows.filter((row) => row.userId === userId && this.isToday(row.spunAt)).length;
  }

  /**
   * Like the real batch, only the floor switch is checked of the settings; the rest is the service's job. The check
   * step (the day's rounds of every rules number, then the meter) runs after the shared checks; the pot step's
   * arithmetic is the SQL's, Giga, Mini, Major in row order; the meter and the pots change only when the wallet did.
   */
  async bet(input: SlotBetInput): Promise<SlotBetOutcome> {
    this.check();
    this.betCalls.push(input);
    this.checkColumns();
    const feeding = SLOT_POTS_BY_ROW.filter((pot) => input.adds[pot] > 0);
    const won: Record<SlotPot, number> = { mini: 0, major: 0, giga: 0 };
    const nextPots = structuredClone(this.potRows);
    const moved = this.wallets.moveWith<SlotRefusal>(
      { userId: input.userId, charId: input.charId, stake: input.stake, payout: input.payout },
      this.settingsRow.live,
      () => {
        // null is named because null >= 0 is true here.
        if (input.daily == null || input.meterBefore == null || input.meterAfter == null) throw new Error('A round needs its daily limit and its meter');
        if (this.spinRows.filter((row) => row.userId === input.userId && this.isToday(row.spunAt)).length >= input.daily) return SLOT_DAILY_REFUSED;
        if ((this.meterRow(input.userId, input.machine, input.stake)?.points ?? 0) !== input.meterBefore) return SLOT_METER_REFUSED;
        return 0;
      },
      () => {
        if (feeding.length === 0) return 0;
        // The pot step's refusals. The adds together are part of one lost stake.
        const total = feeding.reduce((sum, pot) => sum + input.adds[pot], 0);
        if (input.payout > 0 || total > input.stake * BRONZE_PER_SILVER) throw new Error('A round cannot add that to the jackpot');
        for (const pot of feeding) {
          const add = input.adds[pot];
          const roll = input.rolls[pot];
          if (add > input.stake * BRONZE_PER_SILVER || roll == null || !(roll >= 0 && roll < SLOT_JACKPOT_ROLLS)) {
            throw new Error('A round cannot add that to the jackpot');
          }
          if (this.potMissing) throw new Error('Invalid object name TPortalSlotJackpot');
          const row = nextPots[pot];
          const cap = row.cap ?? input.caps[pot] * BRONZE_PER_GOLD;
          const amount = row.amount + add;
          if (slotJackpotDrops(row.amount, add, cap, roll)) {
            won[pot] = Math.floor(amount / BRONZE_PER_SILVER);
            nextPots[pot] = { amount: amount % BRONZE_PER_SILVER, cap: null };
          } else {
            nextPots[pot] = { amount, cap };
          }
        }
        return won.mini + won.major + won.giga;
      },
    );
    if (moved.code !== BET_OK) return moved;
    this.potRows = nextPots;
    // The meter is written when it changes or its row is there; an absent meter left at 0 gets no row.
    const meter = this.meterRow(input.userId, input.machine, input.stake);
    if (meter) meter.points = input.meterAfter;
    else if (input.meterAfter !== 0) this.meterRows.push({ userId: input.userId, machine: input.machine, stake: input.stake, points: input.meterAfter });
    const adds = { mini: 0, major: 0, giga: 0 };
    for (const pot of feeding) adds[pot] = input.adds[pot];
    const id = this.nextId++;
    this.spinRows.push({
      id,
      userId: input.userId,
      character: moved.name,
      spunAt: this.now(),
      machine: input.machine,
      stops: input.stops,
      free: input.free,
      meterFree: input.meterFree,
      meterBefore: input.meterBefore,
      stake: input.stake,
      payout: input.payout,
      jackpot: won.mini + won.major + won.giga,
      pots: won,
      multiple: input.multiple,
      added: adds.mini + adds.major + adds.giga,
      adds,
      rules: SLOT_RULES,
    });
    return { code: BET_OK, id, wallet: moved.wallet, pots: { ...won } };
  }

  private newest(rows: FakeSlotSpinRow[], limit: number): SlotSpinRow[] {
    return [...rows].sort((a, b) => b.id - a.id).slice(0, limit).map((row) => this.plain(row));
  }

  async spinsOf(userId: number, limit: number): Promise<SlotSpinRow[]> {
    this.check();
    this.checkColumns();
    return this.newest(this.current().filter((row) => row.userId === userId), limit);
  }

  async bigWins(limit: number): Promise<SlotSpinRow[]> {
    this.check();
    this.checkColumns();
    return this.newest(this.current().filter((row) => row.multiple >= SLOT_BIG_WIN || row.pots.major > 0 || row.pots.giga > 0), limit);
  }

  async jackpotWins(pot: SlotPot, limit: number): Promise<SlotSpinRow[]> {
    this.check();
    this.checkColumns();
    return this.newest(this.current().filter((row) => row.pots[pot] > 0), limit);
  }

  async latest(limit: number): Promise<SlotSpinRow[]> {
    this.check();
    this.checkColumns();
    return this.newest(this.current(), limit);
  }

  async totals(): Promise<Record<string, { today: SlotTotalsRow; allTime: SlotTotalsRow }>> {
    this.check();
    const sum = (rows: FakeSlotSpinRow[]): SlotTotalsRow => ({
      spins: rows.length,
      staked: rows.reduce((total, row) => total + row.stake, 0),
      paid: rows.reduce((total, row) => total + row.payout, 0),
      added: Math.floor(rows.reduce((total, row) => total + row.added, 0) / BRONZE_PER_SILVER),
    });
    const machines = [...new Set(this.spinRows.map((row) => row.machine))];
    return Object.fromEntries(
      machines.map((machine) => {
        const rows = this.spinRows.filter((row) => row.machine === machine);
        return [machine, { today: sum(rows.filter((row) => this.isToday(row.spunAt))), allTime: sum(rows) }];
      }),
    );
  }

  /** A row from before the three pots put everything in the one pot, now the Giga. */
  async jackpotTotals(): Promise<Record<SlotPot, SlotJackpotTotalsRow>> {
    this.check();
    const old = (row: FakeSlotSpinRow) => (row.rules ?? SLOT_RULES) < SLOT_RULES;
    const added = (row: FakeSlotSpinRow, pot: SlotPot) => (old(row) ? (pot === 'giga' ? row.added : 0) : (row.adds?.[pot] ?? 0));
    const paid = (row: FakeSlotSpinRow, pot: SlotPot) => (old(row) ? (pot === 'giga' ? row.jackpot : 0) : row.pots[pot]);
    return Object.fromEntries(
      SLOT_POTS.map((pot) => [
        pot,
        {
          added: this.spinRows.reduce((total, row) => total + added(row, pot), 0),
          paid: this.spinRows.reduce((total, row) => total + paid(row, pot), 0),
          drops: this.spinRows.filter((row) => paid(row, pot) > 0).length,
        },
      ]),
    ) as Record<SlotPot, SlotJackpotTotalsRow>;
  }
}

// In-memory stand-in for the rebirth settings, TCHARREBIRTHTABLE, its log and the rewards. Its rebirth() only
// checks the nine outcomes the SQL batch has, in its order, and "mails" the saved reward into `letters`.
export class FakeRebirthRepository implements RebirthRepository {
  settingsRow: RebirthSettings = { ...REBIRTH_DEFAULT_SETTINGS };
  /** The characters find() and rebirth() see, with the account each belongs to. */
  characters: (RebirthCharacterRow & { userId: number; charId: number })[] = [];
  /** Oldest first, as written. ageSeconds is worked out from `now` when read. */
  logRows: RebirthLogRow[] = [];
  /** Everything rebirth() was asked for, including calls that changed nothing. */
  readonly rebirthCalls: RebirthInput[] = [];
  /** TPORTALREBIRTHREWARD, by rebirth number. */
  rewardRows: RebirthRewardRow[] = [];
  /** Every setReward() call, with who made it. */
  readonly rewardChanges: { reward: RebirthRewardRow; changedBy: string }[] = [];
  /** The item chart findItems() reads. */
  items: RewardItemRow[] = [];
  /** The reward letters rebirth() sent; postId is the index plus one. */
  readonly letters: { postId: number; charId: number; rebirth: number; reward: RebirthRewardRow }[] = [];
  /** The database's clock: stamps new rebirths and ages old ones. */
  now: () => Date = () => new Date();
  /** Every call rejects, as before the tables exist. */
  failing = false;

  private check(): void {
    if (this.failing) throw new Error('Invalid object name TCHARREBIRTHLOGTABLE');
  }

  private aged(row: RebirthLogRow): RebirthLogRow {
    return { ...row, ageSeconds: Math.floor((this.now().getTime() - row.at.getTime()) / 1000) };
  }

  async find(userId: number, charId: number): Promise<RebirthCharacterRow | null> {
    this.check();
    const row = this.characters.find((c) => c.charId === charId && c.userId === userId);
    if (!row) return null;
    const { userId: _owner, charId: _id, ...character } = row;
    return character;
  }

  async rebirth(input: RebirthInput): Promise<RebirthOutcome> {
    this.check();
    this.rebirthCalls.push(input);
    const settings = this.settingsRow;
    if (!rebirthIsOpen(settings)) return { code: REBIRTH_CLOSED };
    const row = this.characters.find((c) => c.charId === input.charId && c.userId === input.userId);
    if (!row) return { code: REBIRTH_NOT_YOURS };
    if (row.online) return { code: REBIRTH_ONLINE };
    if (row.level < REBIRTH_LEVEL) return { code: REBIRTH_LOW_LEVEL };
    if (row.wornItems > 0) return { code: REBIRTH_WEARING };
    if (row.rebirths >= settings.limit) return { code: REBIRTH_AT_LIMIT };
    const rebirth = row.rebirths + 1;
    const priceGold = rebirthPriceGold(rebirth, settings.priceGold);
    if (input.expectedPriceGold !== priceGold) return { code: REBIRTH_PRICE_CHANGED };
    const held = row.gold * BRONZE_PER_GOLD + row.silver * BRONZE_PER_SILVER + row.copper;
    if (held < priceGold * BRONZE_PER_GOLD) return { code: REBIRTH_POOR };
    const left = held - priceGold * BRONZE_PER_GOLD;
    const bonuses = {
      stats: rebirthBonus(rebirth, settings),
      exp: rebirthExtraBonus(rebirth, settings.limit, settings.expPercent),
      gold: rebirthExtraBonus(rebirth, settings.limit, settings.goldPercent),
    };
    Object.assign(row, {
      level: 1,
      rebirths: rebirth,
      statBonus: bonuses.stats,
      expBonus: bonuses.exp,
      goldBonus: bonuses.gold,
      gold: Math.floor(left / BRONZE_PER_GOLD),
      silver: Math.floor((left % BRONZE_PER_GOLD) / BRONZE_PER_SILVER),
      copper: left % BRONZE_PER_SILVER,
    });
    const id = Math.max(0, ...this.logRows.map((entry) => entry.id)) + 1;
    this.logRows.push({
      id,
      userId: input.userId,
      charId: input.charId,
      name: row.name,
      rebirth,
      bonus: bonuses.stats,
      priceGold,
      at: this.now(),
      ageSeconds: 0,
      text: input.text.replace('{name}', row.name).replace('{rebirth}', String(rebirth)),
      announced: REBIRTH_ANNOUNCE_WAITING,
    });
    const reward = this.rewardRows.find((entry) => entry.rebirth === rebirth);
    let postId = 0;
    if (reward && !isEmptyReward(reward)) {
      postId = this.letters.length + 1;
      this.letters.push({ postId, charId: input.charId, rebirth, reward: structuredClone(reward) });
    }
    const wallet = { gold: row.gold, silver: row.silver, copper: row.copper };
    return { code: REBIRTH_OK, id, name: row.name, rebirth, bonuses, priceGold, wallet, postId };
  }

  async settings(): Promise<RebirthSettings> {
    this.check();
    return { ...this.settingsRow };
  }

  async saveSettings(settings: RebirthSettings): Promise<void> {
    this.check();
    this.settingsRow = { ...settings };
    for (const row of this.characters) {
      if (row.rebirths === 0) continue;
      row.statBonus = rebirthBonus(row.rebirths, settings);
      row.expBonus = rebirthExtraBonus(row.rebirths, settings.limit, settings.expPercent);
      row.goldBonus = rebirthExtraBonus(row.rebirths, settings.limit, settings.goldPercent);
    }
  }

  async rewards(): Promise<RebirthRewardRow[]> {
    this.check();
    return structuredClone([...this.rewardRows].sort((a, b) => a.rebirth - b.rebirth));
  }

  async setReward(reward: RebirthRewardRow, changedBy: string): Promise<void> {
    this.check();
    this.rewardChanges.push({ reward: structuredClone(reward), changedBy });
    this.rewardRows = this.rewardRows.filter((row) => row.rebirth !== reward.rebirth);
    if (!isEmptyReward(reward)) this.rewardRows.push(structuredClone(reward));
  }

  async findItems(itemIds: number[]): Promise<RewardItemRow[]> {
    this.check();
    return this.items.filter((item) => itemIds.includes(item.itemId));
  }

  async recent(limit: number): Promise<RebirthLogRow[]> {
    this.check();
    return [...this.logRows].sort((a, b) => b.id - a.id).slice(0, limit).map((row) => this.aged(row));
  }

  async count(): Promise<number> {
    this.check();
    return this.characters.filter((row) => row.rebirths > 0).length;
  }

  async waitingAnnouncements(): Promise<RebirthLogRow[]> {
    this.check();
    return this.logRows
      .filter((row) => row.announced === REBIRTH_ANNOUNCE_WAITING)
      .sort((a, b) => a.id - b.id)
      .slice(0, 50)
      .map((row) => this.aged(row));
  }

  async claimAnnouncement(id: number): Promise<boolean> {
    this.check();
    const row = this.logRows.find((entry) => entry.id === id);
    if (!row || row.announced !== REBIRTH_ANNOUNCE_WAITING) return false;
    row.announced = REBIRTH_ANNOUNCE_SENT;
    return true;
  }

  async markAnnounced(id: number, state: number): Promise<void> {
    this.check();
    const row = this.logRows.find((entry) => entry.id === id);
    if (row) row.announced = state;
  }
}
