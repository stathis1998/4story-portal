import { timingSafeEqual } from 'node:crypto';
import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { LoginRequest, RegisterRequest, SessionUser } from '@4story-portal/shared';
import { ACCOUNTS_REPOSITORY, type AccountsRepository } from './accounts.repository.js';
import { sha1Hex } from './sha1.js';

const INVALID_LOGIN = 'Invalid username or password';

@Injectable()
export class AuthService {
  constructor(@Inject(ACCOUNTS_REPOSITORY) private readonly accounts: AccountsRepository) {}

  async register(input: RegisterRequest): Promise<SessionUser> {
    const userId = await this.accounts.createAccount(input.username, sha1Hex(input.password));
    if (userId === null) throw new ConflictException('Username is already taken');
    return { userId, username: input.username };
  }

  async login(input: LoginRequest): Promise<SessionUser> {
    const account = await this.accounts.findByUsername(input.username);
    if (!account || !hashesMatch(sha1Hex(input.password), account.passwordHash)) {
      throw new UnauthorizedException(INVALID_LOGIN);
    }
    // Return the stored spelling: the database matches usernames case-insensitively.
    return { userId: account.userId, username: account.username };
  }
}

function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
