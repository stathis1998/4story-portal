import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { SessionUser } from '@4story-portal/shared';
import type { Request } from 'express';
import { SESSION_COOKIE, SessionService } from './session.service.js';

type AuthedRequest = Request & { user?: SessionUser };

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    const user = typeof token === 'string' ? this.sessions.verify(token) : null;
    if (!user) throw new UnauthorizedException('Not signed in');
    req.user = user;
    return true;
  }
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SessionUser =>
    context.switchToHttp().getRequest<AuthedRequest>().user!,
);
