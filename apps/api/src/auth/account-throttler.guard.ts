import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { SessionUser } from '@4story-portal/shared';

/**
 * Counts by signed-in account, so many accounts behind one address (a household, a café) do not share a limit.
 * Needs SessionGuard to have run first; without a user it counts by address like the plain guard.
 */
@Injectable()
export class AccountThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, any>): Promise<string> {
    const user = req.user as SessionUser | undefined;
    return user ? `account:${user.userId}` : String(req.ip);
  }
}
