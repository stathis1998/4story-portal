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
  type AchievementReward,
  type AchievementRewardInput,
  type GmRebirth,
  type GmRebirthReward,
  REBIRTH_LEVEL,
  rebirthBonus,
  type RebirthBonuses,
  rebirthExtraBonus,
  rebirthIsOpen,
  rebirthPriceGold,
  type RebirthSettings,
  type RebirthSettingsInput,
  type RebirthState,
} from '@4story-portal/shared';
import { itemIcons } from '../gm/game-icons.generated.js';
import { GM_REPOSITORY, type GmRepository } from '../gm/gm.repository.js';
import { checkRewardItems } from '../gm/reward-items.js';
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
import { REBIRTH_REPOSITORY, type RebirthLogRow, type RebirthRepository, type RebirthRewardRow } from './rebirth.repository.js';

type Actor = { username: string; ip: string };

const AUDIT_COMMAND = 'REBIRTH';
const RECENT = 20;
const LOG_TEXT = '{name} was reborn (rebirth {rebirth})';
const NOT_FOUND = 'Character not found';
const UNAVAILABLE = 'Rebirth could not be completed right now. Nothing was taken. Try again in a minute';
const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

@Injectable()
export class RebirthService {
  private readonly logger = new Logger(RebirthService.name);

  constructor(
    @Inject(REBIRTH_REPOSITORY) private readonly repo: RebirthRepository,
    @Inject(GM_REPOSITORY) private readonly gm: GmRepository,
    private readonly stats: StatsService,
  ) {}

  async state(userId: number, charId: number): Promise<RebirthState> {
    const [character, settings, rewards] = await Promise.all([this.repo.find(userId, charId), this.repo.settings(), this.rewardRows()]);
    if (!character) throw new NotFoundException(NOT_FOUND);
    const number = character.rebirths + 1;
    const saved = rewards.find((row) => row.rebirth === number);
    const atLimit = character.rebirths >= settings.limit;
    return {
      characterId: charId,
      name: character.name,
      level: character.level,
      online: character.online,
      wornItems: character.wornItems,
      wallet: { gold: character.gold, silver: character.silver, copper: character.copper },
      rebirths: character.rebirths,
      bonuses: { stats: character.statBonus, exp: character.expBonus, gold: character.goldBonus },
      open: rebirthIsOpen(settings),
      next: atLimit
        ? null
        : {
            number,
            bonuses: bonusesAfter(number, settings),
            priceGold: rebirthPriceGold(number, settings.priceGold),
            reward: saved ? (await this.rewardViews([saved]))[0].reward : null,
          },
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
    let outcome;
    try {
      outcome = await this.repo.rebirth({ userId, charId, expectedPriceGold, baseline: JSON.stringify(fresh), text: LOG_TEXT });
    } catch (error) {
      // The batch rolls everything back when it fails, including when the reward letter cannot be sent.
      this.logger.error(`The rebirth of character ${charId} failed: ${describe(error)}`);
      throw new ServiceUnavailableException(UNAVAILABLE);
    }
    if (outcome.code !== REBIRTH_OK) refuse(outcome.code);
    // The character's counters just started over: the next stats page must not serve the old snapshot.
    this.stats.dropCache();
    return this.state(userId, charId);
  }

  async gmState(): Promise<GmRebirth> {
    const [settings, reborn, recent, rewards] = await Promise.all([
      this.repo.settings(),
      this.repo.count(),
      this.repo.recent(RECENT),
      this.rewardRows(),
    ]);
    return { settings, reborn, recent: recent.map(entryView), rewards: await this.rewardViews(rewards) };
  }

  async saveSettings(settings: RebirthSettingsInput, actor: Actor): Promise<GmRebirth> {
    await this.repo.saveSettings(settings, actor.username);
    await this.audit(
      `SET ${settings.live ? 'on' : 'off'} price ${settings.priceGold} percent ${settings.percent} limit ${settings.limit} exp ${settings.expPercent} gold ${settings.goldPercent}`,
      actor,
    );
    return this.gmState();
  }

  async setReward(rebirth: number, reward: AchievementRewardInput, actor: Actor): Promise<GmRebirth> {
    await checkRewardItems(reward.items, (ids) => this.repo.findItems(ids));
    await this.repo.setReward({ rebirth, ...reward }, actor.username);
    const items = reward.items.length ? reward.items.map((item) => `${item.itemId} x ${item.count}`).join(', ') : 'none';
    await this.audit(`REWARD ${rebirth} gold ${reward.gold} silver ${reward.silver} copper ${reward.copper} items ${items}`, actor);
    return this.gmState();
  }

  /** Every saved reward. Empty while the reward table is not in this game database, so the page still shows. */
  private async rewardRows(): Promise<RebirthRewardRow[]> {
    try {
      return await this.repo.rewards();
    } catch (error) {
      this.logger.warn(`Could not read the rebirth rewards: ${describe(error)}`);
      return [];
    }
  }

  private async rewardViews(rows: RebirthRewardRow[]): Promise<GmRebirthReward[]> {
    const ids = [...new Set(rows.flatMap((row) => row.items.map((item) => item.itemId)))];
    let found: { itemId: number; name: string }[] = [];
    if (ids.length > 0) {
      try {
        found = await this.repo.findItems(ids);
      } catch (error) {
        this.logger.warn(`Could not read the rebirth reward item names: ${describe(error)}`);
      }
    }
    const names = new Map(found.map((row) => [row.itemId, row.name]));
    return rows.map(({ rebirth, gold, silver, copper, items }) => {
      const reward: AchievementReward = {
        gold,
        silver,
        copper,
        items: items.map(({ itemId, count }) => ({ itemId, count, name: names.get(itemId) || `Item ${itemId}`, icon: itemIcons[itemId] ?? null })),
      };
      return { rebirth, reward };
    });
  }

  private async audit(log: string, actor: Actor): Promise<void> {
    try {
      await this.gm.writeAudit({ ip: actor.ip, gmId: actor.username, command: AUDIT_COMMAND, log });
    } catch (error) {
      this.logger.warn(`Could not write the rebirth audit row: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

const bonusesAfter = (number: number, s: RebirthSettings): RebirthBonuses => ({
  stats: rebirthBonus(number, s),
  exp: rebirthExtraBonus(number, s.limit, s.expPercent),
  gold: rebirthExtraBonus(number, s.limit, s.goldPercent),
});

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
