import type { AccountRecord, AccountsRepository } from '../src/auth/accounts.repository.js';
import type { CharacterRow, CharactersRepository } from '../src/characters/characters.repository.js';

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
