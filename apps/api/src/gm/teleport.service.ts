import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { OnlinePlayer, TeleportRequest, TeleportResult } from '@4story-portal/shared';
import { className } from '../characters/character-codes.js';
import { ControlClient, ControlUnavailableError } from '../control/control-client.js';
import { GM_REPOSITORY, type GmRepository } from './gm.repository.js';

type Actor = { username: string; ip: string };

@Injectable()
export class TeleportService {
  private readonly logger = new Logger(TeleportService.name);

  constructor(
    private readonly control: ControlClient,
    @Inject(GM_REPOSITORY) private readonly repo: GmRepository,
  ) {}

  async onlinePlayers(): Promise<OnlinePlayer[]> {
    const rows = await this.repo.listOnlinePlayers();
    return rows.map(({ classCode, ...player }) => ({ ...player, className: className(classCode) }));
  }

  async teleport(req: TeleportRequest, actor: Actor): Promise<TeleportResult> {
    const { names, destination } = req;

    if (destination.kind === 'position' && !(await this.repo.isLocationHosted(destination))) {
      await this.reject('no-server', describe(names, destination), actor);
      throw new UnprocessableEntityException('No server hosts that location');
    }

    // Case-insensitive match; the stored spelling is what goes into the packet.
    const online = new Map(
      (await this.repo.listOnlinePlayers())
        .filter((p) => p.world === destination.world)
        .map((p) => [p.name.toLowerCase(), p.name]),
    );
    const wanted = destination.kind === 'character' ? [...names, destination.target] : names;
    const missing = wanted.filter((n) => !online.has(n.toLowerCase()));
    if (missing.length > 0) {
      await this.reject('offline', describe(names, destination), actor);
      throw new ConflictException(`Not online: ${missing.join(', ')}`);
    }

    const stored = names.map((n) => online.get(n.toLowerCase())!);
    const target = destination.kind === 'character' ? online.get(destination.target.toLowerCase())! : undefined;
    try {
      if (destination.kind === 'position') this.control.moveToPosition(destination, stored);
      else this.control.moveToCharacter(destination.world, target!, stored);
    } catch (error) {
      if (error instanceof ControlUnavailableError) {
        await this.reject('disconnected', describe(names, destination), actor);
        throw new HttpException('Game server is not connected', 503);
      }
      throw error;
    }

    await this.audit(describe(stored, destination, target), actor);
    return { sent: true, names: stored };
  }

  private reject(reason: string, text: string, actor: Actor): Promise<void> {
    return this.audit(`REJECTED ${reason}: ${text}`, actor);
  }

  private async audit(log: string, actor: Actor): Promise<void> {
    try {
      await this.repo.writeAudit({ ip: actor.ip, gmId: actor.username, log });
    } catch (error) {
      this.logger.warn(`Could not write the teleport audit row: ${error instanceof Error ? error.message : error}`);
    }
  }
}

// One format for success and REJECTED lines.
function describe(names: string[], destination: TeleportRequest['destination'], target?: string): string {
  const who = names.join(',');
  if (destination.kind === 'character') return `${who} -> char ${target ?? destination.target}`;
  const { world, channel, mapId, x, y, z } = destination;
  return `${who} -> w${world} ch${channel} map${mapId} (${x},${y},${z})`;
}
