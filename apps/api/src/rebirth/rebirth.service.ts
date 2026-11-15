import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  type GmRebirth,
  REBIRTH_LEVEL,
  rebirthBonus,
  rebirthIsOpen,
  rebirthPriceGold,
  type RebirthSettingsInput,
  type RebirthState,
} from '@4story-portal/shared';
import { GM_REPOSITORY, type GmRepository } from '../gm/gm.repository.js';
import { StatsService } from '../stats/stats.service.js';
import {
  REBIRTH_AT_LIMIT,
  REBIRTH_CLOSED,
  REBIRTH_LOW_LEVEL,
  REBIRTH_NOT_YOURS,
  REBIRTH_OK,
  REBIRTH_ONLINE,
  REBIRTH_POOR,
  REBIRTH_PRICE_CHANGED,
  REBIRTH_WEARING,
  type RebirthCode,
} from './rebirth-sql.js';
import { REBIRTH_REPOSITORY, type RebirthLogRow, type RebirthRepository } from './rebirth.repository.js';

type Actor = { username: string; ip: string };

const AUDIT_COMMAND = 'REBIRTH';
const RECENT = 20;
const LOG_TEXT = '{name} was reborn (rebirth {rebirth})';
const NOT_FOUND = 'Character not found';

@Injectable()
export class RebirthService {
  private readonly logger = new Logger(RebirthService.name);

  constructor(
    @Inject(REBIRTH_REPOSITORY) private readonly repo: RebirthRepository,
    @Inject(GM_REPOSITORY) private readonly gm: GmRepository,
    private readonly stats: StatsService,
  ) {}

  async state(userId: number, charId: number): Promise<RebirthState> {
    const [character, settings] = await Promise.all([this.repo.find(userId, charId), this.repo.settings()]);
    if (!character) throw new NotFoundException(NOT_FOUND);
    const number = character.rebirths + 1;
    return {
      characterId: charId,
      name: character.name,
      level: character.level,
      online: character.online,
      wornItems: character.wornItems,
      wallet: { gold: character.gold, silver: character.silver, copper: character.copper },
      rebirths: character.rebirths,
      bonus: character.bonus,
      open: rebirthIsOpen(settings),
      next:
        character.rebirths >= settings.limit
          ? null
          : { number, bonus: rebirthBonus(number, settings), priceGold: rebirthPriceGold(number, settings.priceGold) },
    };
  }

  async rebirth(userId: number, charId: number, expectedPriceGold: number): Promise<RebirthState> {
    // A stranger's character is refused before anything is read for it, and the cheap refusals come before
    // the full stats load. The batch checks everything again and stays the authority.
    const [character, settings] = await Promise.all([this.repo.find(userId, charId), this.repo.settings()]);
    if (!character) throw new NotFoundException(NOT_FOUND);
    if (!rebirthIsOpen(settings)) refuse(REBIRTH_CLOSED);
    if (character.online) refuse(REBIRTH_ONLINE);
    if (character.level < REBIRTH_LEVEL) refuse(REBIRTH_LOW_LEVEL);
    // Without a baseline every counter would pay again from zero, so no baseline means no rebirth.
    const fresh = await this.stats.freshBaseline(charId);
    if (!fresh) throw new ServiceUnavailableException('Rebirth is not available right now. Try again in a minute');
    const outcome = await this.repo.rebirth({ userId, charId, expectedPriceGold, baseline: JSON.stringify(fresh), text: LOG_TEXT });
    if (outcome.code !== REBIRTH_OK) refuse(outcome.code);
    // The character's counters just started over: the next stats page must not serve the old snapshot.
    this.stats.dropCache();
    return this.state(userId, charId);
  }

  async gmState(): Promise<GmRebirth> {
    const [settings, reborn, recent] = await Promise.all([this.repo.settings(), this.repo.count(), this.repo.recent(RECENT)]);
    return { settings, reborn, recent: recent.map(entryView) };
  }

  async saveSettings(settings: RebirthSettingsInput, actor: Actor): Promise<GmRebirth> {
    await this.repo.saveSettings(settings, actor.username);
    await this.audit(
      `SET ${settings.live ? 'on' : 'off'} price ${settings.priceGold} percent ${settings.percent} limit ${settings.limit}`,
      actor,
    );
    return this.gmState();
  }

  private async audit(log: string, actor: Actor): Promise<void> {
    try {
      await this.gm.writeAudit({ ip: actor.ip, gmId: actor.username, command: AUDIT_COMMAND, log });
    } catch (error) {
      this.logger.warn(`Could not write the rebirth audit row: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/** Throws the answer for a refusal, whether the service or the batch found it. */
function refuse(code: Exclude<RebirthCode, typeof REBIRTH_OK>): never {
  switch (code) {
    case REBIRTH_NOT_YOURS:
      throw new NotFoundException(NOT_FOUND);
    case REBIRTH_CLOSED:
      throw new ConflictException('Rebirth is closed right now');
    case REBIRTH_ONLINE:
      throw new ConflictException('Log out of the game with this character first');
    case REBIRTH_PRICE_CHANGED:
      throw new ConflictException('The price has changed. Check it and confirm again');
    case REBIRTH_LOW_LEVEL:
      throw new UnprocessableEntityException('This character is not level 90 yet');
    case REBIRTH_WEARING:
      throw new UnprocessableEntityException('Take off everything this character is wearing first');
    case REBIRTH_AT_LIMIT:
      throw new UnprocessableEntityException('This character has reached the rebirth limit');
    case REBIRTH_POOR:
      throw new UnprocessableEntityException('This character does not have enough Gold');
  }
}

const entryView = (row: RebirthLogRow) => ({
  id: row.id,
  at: row.at.toISOString(),
  name: row.name,
  rebirth: row.rebirth,
  bonus: row.bonus,
  priceGold: row.priceGold,
});
