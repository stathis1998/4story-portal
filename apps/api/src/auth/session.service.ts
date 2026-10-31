import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { SessionUser } from '@4story-portal/shared';
import type { CookieOptions } from 'express';

export const SESSION_COOKIE = 'session';
const SESSION_DAYS = 7;

type SessionPayload = { sub: number; username: string };

@Injectable()
export class SessionService {
  constructor(private readonly jwt: JwtService) {}

  sign(user: SessionUser): string {
    const payload: SessionPayload = { sub: user.userId, username: user.username };
    return this.jwt.sign(payload, { expiresIn: `${SESSION_DAYS}d` });
  }

  /** Returns null for a bad signature, an expired token or an unexpected payload. */
  verify(token: string): SessionUser | null {
    try {
      const payload = this.jwt.verify<Partial<SessionPayload>>(token);
      if (typeof payload.sub !== 'number' || typeof payload.username !== 'string') return null;
      return { userId: payload.sub, username: payload.username };
    } catch {
      return null;
    }
  }

  // No `secure` flag: the portal is served over plain HTTP inside the VPN.
  cookieOptions(): CookieOptions {
    return { httpOnly: true, sameSite: 'lax', path: '/', maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000 };
  }
}
