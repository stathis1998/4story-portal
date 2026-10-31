import type { AccountRecord, AccountsRepository } from '../src/auth/accounts.repository.js';

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
