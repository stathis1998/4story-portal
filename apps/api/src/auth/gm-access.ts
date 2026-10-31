import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Me, SessionUser } from '@4story-portal/shared';
import type { Request } from 'express';
import { type AppConfig, CONFIG } from '../config/config.js';

type AuthedRequest = Request & { user?: SessionUser };

@Injectable()
export class GmAccess {
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  isGm(username: string): boolean {
    return this.config.gm.usernames.includes(username.toLowerCase());
  }

  me(user: SessionUser): Me {
    return { ...user, isGm: this.isGm(user.username) };
  }
}

/** Must be listed after SessionGuard, which sets `req.user`. */
@Injectable()
export class GmGuard implements CanActivate {
  constructor(private readonly gm: GmAccess) {}

  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<AuthedRequest>().user;
    if (!user || !this.gm.isGm(user.username)) throw new ForbiddenException('GM access required');
    return true;
  }
}
