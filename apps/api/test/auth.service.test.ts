import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from '../src/auth/auth.service.js';
import { sha1Hex } from '../src/auth/sha1.js';
import { FakeAccountsRepository } from './fakes.js';

describe('AuthService', () => {
  let accounts: FakeAccountsRepository;
  let service: AuthService;

  beforeEach(() => {
    accounts = new FakeAccountsRepository();
    service = new AuthService(accounts);
  });

  describe('register', () => {
    it('creates the account with the SHA-1 hash and returns the session user', async () => {
      const user = await service.register({ username: 'newuser', password: 'secret1' });

      expect(user).toEqual({ userId: accounts.accounts[0].userId, username: 'newuser' });
      expect(accounts.accounts[0].passwordHash).toBe(sha1Hex('secret1'));
    });

    it('rejects a taken username with ConflictException', async () => {
      accounts.seed('moose', sha1Hex('secret1'));

      await expect(service.register({ username: 'moose', password: 'other12' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('login', () => {
    beforeEach(() => accounts.seed('moose', sha1Hex('secret1')));

    it('returns the session user for the right password', async () =>
      expect(await service.login({ username: 'moose', password: 'secret1' })).toEqual({
        userId: accounts.accounts[0].userId,
        username: 'moose',
      }));

    it.each([
      ['wrong password', { username: 'moose', password: 'wrong12' }],
      ['unknown user', { username: 'nobody', password: 'secret1' }],
    ])('rejects a %s with the same message', async (_case, input) => {
      const attempt = service.login(input);
      await expect(attempt).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(attempt).rejects.toThrow('Invalid username or password');
    });

    it('accepts a differently cased username and returns the stored spelling', async () =>
      expect(await service.login({ username: 'MOOSE', password: 'secret1' })).toMatchObject({
        username: 'moose',
      }));
  });
});
