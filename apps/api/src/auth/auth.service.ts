import { timingSafeEqual } from 'node:crypto';
import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { LoginRequest, RegisterRequest, SessionUser } from '@4story-portal/shared';
import { ACCOUNTS_REPOSITORY, type AccountsRepository } from './accounts.repository.js';
import { GmAccess } from './gm-access.js';
import { sha1Hex } from './sha1.js';

const USERNAME_TAKEN = 'Username is already taken';
const INVALID_LOGIN = 'Invalid username or password';

@Injectable()
export class AuthService {
  constructor(
    @Inject(ACCOUNTS_REPOSITORY) private readonly accounts: AccountsRepository,
    private readonly gm: GmAccess,
  ) {}

  async register(input: RegisterRequest): Promise<SessionUser> {
    // A GM name nobody has registered yet must not be claimable; answer like a taken name.
    if (this.gm.isGm(input.username)) throw new ConflictException(USERNAME_TAKEN);
    const userId = await this.accounts.createAccount(input.username, sha1Hex(input.password));
    if (userId === null) throw new ConflictException(USERNAME_TAKEN);
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
