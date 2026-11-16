import { randomInt } from 'node:crypto';
import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  type AchievementReward,
  type GmWheel,
  type SessionUser,
  WHEEL_MAX_PRIZES,
  WHEEL_MIN_LEVEL,
  type WheelPrizeInput,
  type WheelSpin,
  type WheelSpinResult,
  type WheelState,
} from '@4story-portal/shared';
import { ControlClient } from '../control/control-client.js';
import { itemIcons } from '../gm/game-icons.generated.js';
import { checkRewardItems } from '../gm/reward-items.js';
import { GM_REPOSITORY, type GmRepository } from '../gm/gm.repository.js';
import {
  isEmptyReward,
  type PrizeRow,
  SPIN_ALREADY_TODAY,
  SPIN_BAD_CHARACTER,
  SPIN_PRIZE_GONE,
  SPIN_SWITCHED_OFF,
  type SpinRow,
  WHEEL_REPOSITORY,
  type WheelRepository,
  type WheelReward,
} from './wheel.repository.js';

type Actor = { username: string; ip: string };

const SENDER = 'Wheel of Fortune';
const TITLE = 'Wheel of Fortune: {prize}';
const MESSAGE = 'You spun the Wheel of Fortune on the portal and won {prize}. Come back tomorrow for another free spin.';
const ANNOUNCEMENT = '{name} won {prize} on the Wheel of Fortune';
const AUDIT_COMMAND = 'WHEEL';
const HISTORY = 10;
// A GM can disable the picked prize between the pick and the spin. Each retry reads the prizes again.
const PICK_ATTEMPTS = 3;

/** The prize `roll` lands on, with `roll` anywhere from 0 up to (not including) the total weight. */
export function pickPrize<T extends { weight: number }>(prizes: T[], roll: number): T {
  let left = roll;
  for (const prize of prizes) {
    if (left < prize.weight) return prize;
    left -= prize.weight;
  }
  return prizes[prizes.length - 1];
}

const totalWeight = (prizes: { weight: number }[]) => prizes.reduce((sum, prize) => sum + prize.weight, 0);

@Injectable()
export class WheelService {
  private readonly logger = new Logger(WheelService.name);
  /** A whole number from 0 up to (not including) `max`. The operating system's random source; tests replace it. */
  random: (max: number) => number = randomInt;

  constructor(
    @Inject(WHEEL_REPOSITORY) private readonly repo: WheelRepository,
    @Inject(GM_REPOSITORY) private readonly gm: GmRepository,
    private readonly control: ControlClient,
  ) {}

  async state(user: SessionUser): Promise<WheelState> {
    // The page still opens when the wheel's tables can't be read (before they are added to the game
    // database, say): it shows a closed wheel with nothing on it.
    const [live, rows, today, secondsToReset, mine, winners] = await Promise.all([
      this.readOr('switch', () => this.repo.live(), false),
      this.readOr<PrizeRow[]>('prizes', () => this.repo.prizes(), []),
      this.readOr<SpinRow | null>("account's spin today", () => this.repo.today(user.userId), null),
      this.readOr('clock', () => this.repo.secondsToReset(), 0),
      this.readOr<SpinRow[]>("account's spins", () => this.repo.spinsOf(user.userId, HISTORY), []),
      this.readOr<SpinRow[]>('winners', () => this.repo.winners(HISTORY), []),
    ]);
    const prizes = rows.filter((row) => row.enabled);
    const names = await this.itemNames([...prizes, ...mine, ...winners, ...(today ? [today] : [])]);
    const total = totalWeight(prizes);
    return {
      live,
      minLevel: WHEEL_MIN_LEVEL,
      prizes: prizes.map((row) => ({
        id: row.id,
        name: row.name,
        chance: (row.weight / total) * 100,
        reward: rewardView(row, names),
        announce: row.announce,
      })),
      today: today && spinView(today, names),
      secondsToReset,
      mine: mine.map((row) => spinView(row, names)),
      winners: winners.map((row) => spinView(row, names)),
    };
  }

  async spin(user: SessionUser, characterId: number): Promise<WheelSpinResult> {
    for (let attempt = 0; attempt < PICK_ATTEMPTS; attempt++) {
      const prizes = (await this.write(() => this.repo.prizes())).filter((row) => row.enabled);
      if (prizes.length === 0) throw new ServiceUnavailableException('The wheel has no prizes yet');
      const prize = pickPrize(prizes, this.random(totalWeight(prizes)));
      const id = await this.write(() =>
        this.repo.spin({
          userId: user.userId,
          charId: characterId,
          prizeId: prize.id,
          minLevel: WHEEL_MIN_LEVEL,
          sender: SENDER,
          title: TITLE,
          message: MESSAGE,
          text: ANNOUNCEMENT,
        }),
      );
      if (id === SPIN_PRIZE_GONE) continue;
      if (id === SPIN_SWITCHED_OFF) throw new ServiceUnavailableException('The wheel is not open yet');
      if (id === SPIN_ALREADY_TODAY) throw new ConflictException('You have already spun today');
      if (id === SPIN_BAD_CHARACTER) {
        throw new UnprocessableEntityException(`Pick one of your own characters at level ${WHEEL_MIN_LEVEL} or higher`);
      }
      const state = await this.state(user);
      // The spin is in the database whatever the page can read back of it.
      const spin = state.today ?? { id, at: new Date().toISOString(), character: '', prize: prize.name, reward: null };
      return { spin, prizeId: prize.id, state };
    }
    throw new ServiceUnavailableException('The prizes are being changed, try again in a moment');
  }

  async gmState(): Promise<GmWheel> {
    const [live, rows, spinsToday] = await Promise.all([
      this.readOr('switch', () => this.repo.live(), false),
      this.readOr<PrizeRow[]>('prizes', () => this.repo.prizes(), []),
      this.readOr('spins today', () => this.repo.spinsToday(), 0),
    ]);
    const names = await this.itemNames(rows);
    const total = totalWeight(rows.filter((row) => row.enabled));
    return {
      live,
      control: this.control.status().state,
      spinsToday,
      prizes: rows.map((row) => ({
        ...row,
        chance: row.enabled ? (row.weight / total) * 100 : 0,
        reward: rewardView(row, names),
      })),
    };
  }

  async createPrize(prize: WheelPrizeInput, actor: Actor): Promise<GmWheel> {
    const existing = await this.write(() => this.repo.prizes());
    if (existing.length >= WHEEL_MAX_PRIZES) throw new UnprocessableEntityException(`The wheel holds at most ${WHEEL_MAX_PRIZES} prizes`);
    await checkRewardItems(prize.items, (ids) => this.write(() => this.repo.findItems(ids)));
    const id = await this.write(() => this.repo.createPrize(prize, actor.username));
    await this.audit(`ADD ${id} ${describePrize(prize)}`, actor);
    return this.gmState();
  }

  async updatePrize(id: number, prize: WheelPrizeInput, actor: Actor): Promise<GmWheel> {
    await checkRewardItems(prize.items, (ids) => this.write(() => this.repo.findItems(ids)));
    if (!(await this.write(() => this.repo.updatePrize(id, prize, actor.username)))) throw new NotFoundException('No such prize');
    await this.audit(`SET ${id} ${describePrize(prize)}`, actor);
    return this.gmState();
  }

  async deletePrize(id: number, actor: Actor): Promise<GmWheel> {
    const prize = (await this.write(() => this.repo.prizes())).find((row) => row.id === id);
    if (!prize || !(await this.write(() => this.repo.deletePrize(id)))) throw new NotFoundException('No such prize');
    await this.audit(`DEL ${id} ${describePrize(prize)}`, actor);
    return this.gmState();
  }

  async setLive(live: boolean, actor: Actor): Promise<GmWheel> {
    await this.write(() => this.repo.setLive(live, actor.username));
    await this.audit(live ? 'ON' : 'OFF', actor);
    return this.gmState();
  }

  private async itemNames(rewards: WheelReward[]): Promise<Map<number, string>> {
    const ids = [...new Set(rewards.flatMap((reward) => reward.items.map((item) => item.itemId)))];
    const found = await this.readOr('item names', () => this.repo.findItems(ids), []);
    return new Map(found.map((row) => [row.itemId, row.name]));
  }

  private async readOr<T>(what: string, read: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await read();
    } catch (error) {
      this.logger.warn(`Could not read the wheel's ${what}: ${describe(error)}`);
      return fallback;
    }
  }

  /** Anything that has to work, or the request fails: most likely the wheel's tables are not in this game database yet. */
  private async write<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      this.logger.warn(`The wheel's tables could not be used: ${describe(error)}`);
      throw new HttpException('The wheel is not available right now', 503);
    }
  }

  private async audit(log: string, actor: Actor): Promise<void> {
    try {
      await this.gm.writeAudit({ ip: actor.ip, gmId: actor.username, command: AUDIT_COMMAND, log });
    } catch (error) {
      this.logger.warn(`Could not write the wheel audit row: ${describe(error)}`);
    }
  }
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

function describePrize(prize: WheelPrizeInput): string {
  const items = prize.items.length ? prize.items.map((item) => `${item.itemId}x${item.count}`).join(',') : 'none';
  const flags = `${prize.enabled ? 'enabled' : 'disabled'}${prize.announce ? ' announce' : ''}`;
  return `"${prize.name}" weight ${prize.weight} order ${prize.order} ${flags} money ${prize.gold}/${prize.silver}/${prize.copper} items ${items}`;
}

/** A reward ready to show. Null for an empty one. */
function rewardView(reward: WheelReward, names: Map<number, string>): AchievementReward | null {
  if (isEmptyReward(reward)) return null;
  return {
    gold: reward.gold,
    silver: reward.silver,
    copper: reward.copper,
    items: reward.items.map(({ itemId, count }) => ({
      itemId,
      count,
      name: names.get(itemId) || `Item ${itemId}`,
      icon: itemIcons[itemId] ?? null,
    })),
  };
}

const spinView = (row: SpinRow, names: Map<number, string>): WheelSpin => ({
  id: row.id,
  at: row.spunAt.toISOString(),
  character: row.character,
  prize: row.prize,
  reward: rewardView(row, names),
});
