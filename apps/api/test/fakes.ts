import type { ControlState, PositionDestination } from '@4story-portal/shared';
import type { AccountRecord, AccountsRepository } from '../src/auth/accounts.repository.js';
import type { CharacterRow, CharactersRepository } from '../src/characters/characters.repository.js';
import type { AuditEntry, GmRepository, LoginRow, OnlinePlayerRow } from '../src/gm/gm.repository.js';
import { type ControlClient, ControlUnavailableError } from '../src/control/control-client.js';

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
export class FakeControlClient implements Pick<ControlClient, 'status' | 'moveToPosition' | 'moveToCharacter' | 'kick'> {
  state: ControlState = 'connected';
  worlds: { id: number; name: string }[] = [{ id: 1, name: 'Lapiris' }];
  readonly moves: unknown[] = [];
  readonly kicks: string[] = [];
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
