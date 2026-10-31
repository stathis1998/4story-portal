import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sha1Hex } from '../src/auth/sha1.js';
import { FakeAccountsRepository } from './fakes.js';
import { validEnv } from './fixtures.js';
import { createTestApp } from './test-app.js';

function sessionCookie(res: request.Response): string {
  const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const session = cookies.find((c) => c.startsWith('session='));
  if (!session) throw new Error('no session cookie');
  return session.split(';')[0];
}

describe('auth HTTP', () => {
  let app: INestApplication;
  let accounts: FakeAccountsRepository;

  beforeEach(async () => {
    accounts = new FakeAccountsRepository();
    accounts.seed('moose', sha1Hex('secret1'));
    app = await createTestApp({ accounts });
  });

  afterEach(() => app.close());

  const http = () => request(app.getHttpServer());

  describe('POST /api/auth/register', () => {
    it('creates the account, returns the user and sets an httpOnly lax session cookie', async () => {
      const res = await http().post('/api/auth/register').send({ username: 'newuser', password: 'secret1' });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ userId: expect.any(Number), username: 'newuser' });
      const raw = ([] as string[]).concat(res.headers['set-cookie']).find((c) => c.startsWith('session='))!;
      expect(raw).toMatch(/HttpOnly/i);
      expect(raw).toMatch(/SameSite=Lax/i);
    });

    it('returns 400 with field errors for invalid input', async () => {
      const res = await http().post('/api/auth/register').send({ username: 'ab', password: 'x' });

      expect(res.status).toBe(400);
      expect(res.body.fieldErrors.username).toEqual(expect.any(Array));
      expect(res.body.fieldErrors.password).toEqual(expect.any(Array));
    });

    it('returns 409 for a taken username', async () => {
      const res = await http().post('/api/auth/register').send({ username: 'moose', password: 'secret2' });

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ statusCode: 409, message: 'Username is already taken' });
    });
  });

  describe('POST /api/auth/login', () => {
    it('returns the user and a session cookie for the right password', async () => {
      const res = await http().post('/api/auth/login').send({ username: 'moose', password: 'secret1' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ userId: accounts.accounts[0].userId, username: 'moose' });
      expect(sessionCookie(res)).toMatch(/^session=.+/);
    });

    it('lets an existing game account log in even if it predates the registration rules', async () => {
      accounts.seed('1', sha1Hex('abc'));

      const res = await http().post('/api/auth/login').send({ username: '1', password: 'abc' });

      expect(res.status).toBe(200);
      expect(res.body.username).toBe('1');
    });

    it('returns 401 for a wrong password', async () => {
      const res = await http().post('/api/auth/login').send({ username: 'moose', password: 'wrong12' });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Invalid username or password');
    });

    it('returns 429 on the 11th attempt within a minute', async () => {
      for (let i = 0; i < 10; i++) {
        await http().post('/api/auth/login').send({ username: 'moose', password: 'wrong12' });
      }
      const res = await http().post('/api/auth/login').send({ username: 'moose', password: 'wrong12' });

      expect(res.status).toBe(429);
    });

    it('returns a generic 500 without driver details when the database fails', async () => {
      accounts.findByUsername = async () => {
        throw new Error('Login failed for user sa; table TACCOUNT_PW');
      };

      const res = await http().post('/api/auth/login').send({ username: 'moose', password: 'secret1' });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ statusCode: 500, message: 'Internal server error' });
    });
  });

  describe('GET /api/auth/me', () => {
    it('returns the user for a valid session cookie', async () => {
      const login = await http().post('/api/auth/login').send({ username: 'moose', password: 'secret1' });

      const res = await http().get('/api/auth/me').set('Cookie', sessionCookie(login));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ userId: accounts.accounts[0].userId, username: 'moose' });
    });

    it('returns 401 without a cookie', async () =>
      expect((await http().get('/api/auth/me')).status).toBe(401));

    it('returns 401 for a token signed with a different secret', async () => {
      const forged = new JwtService({ secret: 'b'.repeat(32) }).sign({ sub: 1, username: 'moose' });

      const res = await http().get('/api/auth/me').set('Cookie', `session=${forged}`);

      expect(res.status).toBe(401);
    });

    it('returns 401 for an expired token', async () => {
      const expired = new JwtService({ secret: validEnv.JWT_SECRET }).sign(
        { sub: 1, username: 'moose' },
        { expiresIn: -10 },
      );

      const res = await http().get('/api/auth/me').set('Cookie', `session=${expired}`);

      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('returns 204 and clears the session cookie', async () => {
      const res = await http().post('/api/auth/logout');

      expect(res.status).toBe(204);
      const raw = ([] as string[]).concat(res.headers['set-cookie']).find((c) => c.startsWith('session='))!;
      expect(raw).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/i);
    });
  });
});
