import { randomInt } from 'node:crypto';
import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  checkBets,
  type GmRoulette,
  ROULETTE_DEFAULT_LIMITS,
  type RouletteBet,
  type RouletteSettingsInput,
  type RouletteSpinResult,
  type RouletteSpinView,
  type RouletteState,
  type RouletteTotals,
  type SessionUser,
  settleBets,
  type WalletCharacter,
} from '@4story-portal/shared';
import { className } from '../characters/character-codes.js';
import { GM_REPOSITORY, type GmRepository } from '../gm/gm.repository.js';
import { BET_CLOSED, BET_NOT_YOURS, BET_ONLINE, BET_POOR } from '../games/wallet-bet.js';
import {
  ROULETTE_REPOSITORY,
  type RouletteRepository,
  type RouletteSettings,
  type RouletteSpinRow,
  type RouletteTotalsRow,
  type WalletCharacterRow,
} from './roulette.repository.js';

type Actor = { username: string; ip: string };

const AUDIT_COMMAND = 'ROULETTE';
const MINE = 15;
const BIG_WINS = 10;
const LATEST = 20;
const UNAVAILABLE = 'Roulette is not available right now';

const CLOSED: RouletteSettings = { live: false, ...ROULETTE_DEFAULT_LIMITS };
const NO_TOTALS: RouletteTotalsRow = { spins: 0, staked: 0, paid: 0 };

@Injectable()
export class RouletteService {
  private readonly logger = new Logger(RouletteService.name);
  /** A whole number from 0 up to (not including) `max`. The operating system's random source; tests replace it. */
  random: (max: number) => number = randomInt;

  constructor(
    @Inject(ROULETTE_REPOSITORY) private readonly repo: RouletteRepository,
    @Inject(GM_REPOSITORY) private readonly gm: GmRepository,
  ) {}

  async state(user: SessionUser): Promise<RouletteState> {
    // The page still opens when the tables can't be read (before they are added to the game database,
    // say): it shows a closed table with the starting limits and nothing on it.
    const [settings, characters, mine, bigWins] = await Promise.all([
      this.readOr('settings', () => this.repo.settings(), CLOSED),
      this.readOr<WalletCharacterRow[]>("account's characters", () => this.repo.characters(user.userId), []),
      this.readOr<RouletteSpinRow[]>("account's spins", () => this.repo.spinsOf(user.userId, MINE), []),
      this.readOr<RouletteSpinRow[]>('big wins', () => this.repo.bigWins(BIG_WINS), []),
    ]);
    return {
      live: settings.live,
      limits: limitsOf(settings),
      characters: characters.map(characterView),
      mine: mine.map(spinView),
      bigWins: bigWins.map(spinView),
    };
  }

  async spin(user: SessionUser, characterId: number, bets: RouletteBet[]): Promise<RouletteSpinResult> {
    const settings = await this.write(() => this.repo.settings());
    // The repository trusts what it is given, so nothing reaches it unless the bets hold against today's limits.
    const refusal = checkBets(bets, limitsOf(settings));
    if (refusal) throw new UnprocessableEntityException(refusal);

    const pocket = this.random(37);
    const { stake, payout, winning, numberHit } = settleBets(bets, pocket);
    const outcome = await this.write(() =>
      this.repo.bet({
        userId: user.userId,
        charId: characterId,
        pocket,
        stake,
        payout,
        bets: bets.map((bet) => `${bet.spot}:${bet.amount}`).join(','),
        numberHit,
      }),
    );

    switch (outcome.code) {
      case BET_CLOSED:
        throw new ServiceUnavailableException('The table is not open yet');
      case BET_NOT_YOURS:
        throw new UnprocessableEntityException('Pick one of your own characters');
      case BET_ONLINE:
        throw new ConflictException(`Log out of ${outcome.name} in the game first`);
      case BET_POOR:
        throw new UnprocessableEntityException('Not enough money in that wallet');
    }

    const state = await this.state(user);
    const spin = state.mine.find((row) => row.id === outcome.id) ?? {
      id: outcome.id,
      at: new Date().toISOString(),
      character: state.characters.find((c) => c.id === characterId)?.name ?? '',
      pocket,
      stake,
      payout,
    };
    return { spin, winning, wallet: outcome.wallet, state };
  }

  async gmState(): Promise<GmRoulette> {
    const [settings, totals, latest] = await Promise.all([
      this.readOr('settings', () => this.repo.settings(), CLOSED),
      this.readOr('totals', () => this.repo.totals(), { today: NO_TOTALS, allTime: NO_TOTALS }),
      this.readOr<RouletteSpinRow[]>('latest spins', () => this.repo.latest(LATEST), []),
    ]);
    return {
      live: settings.live,
      limits: limitsOf(settings),
      today: totalsView(totals.today),
      allTime: totalsView(totals.allTime),
      latest: latest.map(spinView),
    };
  }

  async saveSettings(settings: RouletteSettingsInput, actor: Actor): Promise<GmRoulette> {
    await this.write(() => this.repo.saveSettings(settings, actor.username));
    await this.audit(
      `SET ${settings.live ? 'on' : 'off'} min ${settings.minBet} number ${settings.maxNumber} outside ${settings.maxOutside}`,
      actor,
    );
    return this.gmState();
  }

  private async readOr<T>(what: string, read: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await read();
    } catch (error) {
      this.logger.warn(`Could not read the roulette's ${what}: ${describe(error)}`);
      return fallback;
    }
  }

  /** Anything that has to work, or the request fails: most likely the roulette's tables are not in this game database yet. */
  private async write<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      this.logger.warn(`The roulette's tables could not be used: ${describe(error)}`);
      throw new HttpException(UNAVAILABLE, 503);
    }
  }

  private async audit(log: string, actor: Actor): Promise<void> {
    try {
      await this.gm.writeAudit({ ip: actor.ip, gmId: actor.username, command: AUDIT_COMMAND, log });
    } catch (error) {
      this.logger.warn(`Could not write the roulette audit row: ${describe(error)}`);
    }
  }
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

const limitsOf = ({ minBet, maxNumber, maxOutside }: RouletteSettings) => ({ minBet, maxNumber, maxOutside });

const totalsView = (row: RouletteTotalsRow): RouletteTotals => ({ spins: row.spins, staked: row.staked, paid: row.paid });

const spinView = (row: RouletteSpinRow): RouletteSpinView => ({
  id: row.id,
  at: row.spunAt.toISOString(),
  character: row.character,
  pocket: row.pocket,
  stake: row.stake,
  payout: row.payout,
});

const characterView = (row: WalletCharacterRow): WalletCharacter => ({
  id: row.charId,
  name: row.name,
  level: row.level,
  className: className(row.classCode),
  online: row.online,
  wallet: { gold: row.gold, silver: row.silver, copper: row.copper },
});
