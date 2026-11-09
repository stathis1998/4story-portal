import type { ControlState, PositionDestination } from '@4story-portal/shared';
import type { AccountRecord, AccountsRepository } from '../src/auth/accounts.repository.js';
import type { CharacterRow, CharactersRepository, LevelFreezeRow } from '../src/characters/characters.repository.js';
import type { AuditEntry, GmRepository, LoginRow, OnlinePlayerRow } from '../src/gm/gm.repository.js';
import type { ItemRow, PriceColumn, StockRow, VendorRow, VendorsRepository } from '../src/gm/vendors.repository.js';
import type { StatRows } from '../src/stats/stats-rules.js';
import type { StatsRepository } from '../src/stats/stats.repository.js';
import { type ControlClient, ControlUnavailableError } from '../src/control/control-client.js';
import { type ControlEvent, EVENT_KIND, type EventKind } from '../src/control/control-protocol.js';

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
  rows: StatRows = { characters: [], sessions: [], gear: [], companions: [], titles: [], titlesTotal: 110, optionRules: [], social: [], combat: [], spending: [], soulLottery: [], accounts: [] };
  loads = 0;
  failWith?: Error;

  async loadRows(): Promise<StatRows> {
    this.loads++;
    if (this.failWith) throw this.failWith;
    return this.rows;
  }
}

export class FakeControlClient
  implements Pick<ControlClient, 'status' | 'moveToPosition' | 'moveToCharacter' | 'kick' | 'listEvents' | 'changeEvent'>
{
  state: ControlState = 'connected';
  worlds: { id: number; name: string }[] = [{ id: 1, name: 'Lapiris' }];
  readonly moves: unknown[] = [];
  readonly kicks: string[] = [];
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
