import { HttpException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { GmLogin, GmLoginClearResult } from '@4story-portal/shared';
import { ControlClient, ControlUnavailableError } from '../control/control-client.js';
import { GM_REPOSITORY, type GmRepository, type LoginRow } from './gm.repository.js';

export const LOGIN_CLEAR_TIMING = Symbol('LOGIN_CLEAR_TIMING');
export type LoginClearTiming = { pollMs: number; waitMs: number };

type Actor = { username: string; ip: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// TCURRENTUSER can't tell a real session from one left behind by a server closed without /exit,
// so a clear kicks first: a real session then logs out normally and removes its own row, with the
// final save. A row still there after the wait has no session behind it and is safe to delete.
@Injectable()
export class LoginsService {
  private readonly logger = new Logger(LoginsService.name);

  constructor(
    private readonly control: ControlClient,
    @Inject(GM_REPOSITORY) private readonly repo: GmRepository,
    @Inject(LOGIN_CLEAR_TIMING) private readonly timing: LoginClearTiming,
  ) {}

  async list(): Promise<GmLogin[]> {
    const rows = await this.repo.listLogins();
    return rows.map((row) => ({ ...row, loggedInAt: row.loggedInAt.toISOString() }));
  }

  async clear(key: number, actor: Actor): Promise<GmLoginClearResult> {
    const login = await this.repo.findLogin(key);
    if (!login) throw new NotFoundException('That login is already gone');

    // No character means no game session to kick: the worst a delete does is ask them to log in again.
    if (login.character) {
      try {
        this.control.kick(login.character);
      } catch (error) {
        if (error instanceof ControlUnavailableError) {
          await this.audit(`REJECTED disconnected: ${describe(login)}`, actor);
          throw new HttpException('Game server is not connected', 503);
        }
        throw error;
      }
      if (await this.loggedOutInTime(key)) return this.finish('logged-out', login, actor);
    }

    // The key guards against deleting a newer session if the player logged back in meanwhile.
    return this.finish((await this.repo.deleteLogin(key)) ? 'cleared' : 'logged-out', login, actor);
  }

  private async loggedOutInTime(key: number): Promise<boolean> {
    const deadline = Date.now() + this.timing.waitMs;
    while (Date.now() < deadline) {
      await sleep(this.timing.pollMs);
      if (!(await this.repo.findLogin(key))) return true;
    }
    return false;
  }

  private async finish(
    outcome: GmLoginClearResult['outcome'],
    login: LoginRow,
    actor: Actor,
  ): Promise<GmLoginClearResult> {
    const result = outcome === 'cleared' ? 'stuck login cleared' : 'logged out by kick';
    await this.audit(`${describe(login)}: ${result}`, actor);
    return { outcome };
  }

  private async audit(log: string, actor: Actor): Promise<void> {
    try {
      await this.repo.writeAudit({ ip: actor.ip, gmId: actor.username, command: 'CLEARLOGIN', log });
    } catch (error) {
      this.logger.warn(`Could not write the clear login audit row: ${error instanceof Error ? error.message : error}`);
    }
  }
}

const describe = ({ character, account }: LoginRow) => (character ? `${character} (${account})` : account);
