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
  type GmSlotMachine,
  type GmSlots,
  type SessionUser,
  SLOT_JACKPOT_DEFAULT_CAP,
  SLOT_MACHINES,
  SLOT_REEL_STOPS,
  slotMachine,
  type SlotMachineKey,
  type SlotMachineSettingsInput,
  type SlotMachineState,
  slotPrize,
  type SlotSpinRequest,
  type SlotSpinResult,
  type SlotSpinView,
  type SlotsState,
  type SlotStops,
  type SlotTotals,
} from '@4story-portal/shared';
import { GM_REPOSITORY, type GmRepository } from '../gm/gm.repository.js';
import { BET_CLOSED, BET_NOT_YOURS, BET_ONLINE, BET_POOR } from '../games/wallet-bet.js';
import { WALLETS_REPOSITORY, type WalletCharacterRow, walletCharacterView, type WalletsRepository } from '../games/wallets.repository.js';
import { SLOTS_REPOSITORY, type SlotSettings, type SlotsRepository, type SlotSpinRow, type SlotTotalsRow } from './slots.repository.js';

type Actor = { username: string; ip: string };

const AUDIT_COMMAND = 'SLOTS';
const MINE = 10;
const BIG_WINS = 10;
const LATEST = 20;
const UNAVAILABLE = 'Slots are not available right now';
const CLOSED_FLOOR = 'The slots are not open yet';

const CLOSED: SlotSettings = {
  live: false,
  machines: Object.fromEntries(SLOT_MACHINES.map((m) => [m.key, { live: true, stakes: [...m.stakes] }])) as SlotSettings['machines'],
  jackpot: { live: true, cap: SLOT_JACKPOT_DEFAULT_CAP },
};
const NO_TOTALS: SlotTotalsRow = { spins: 0, staked: 0, paid: 0, added: 0 };

@Injectable()
export class SlotsService {
  private readonly logger = new Logger(SlotsService.name);
  /** A whole number from 0 up to (not including) `max`. The operating system's random source; tests replace it. */
  random: (max: number) => number = randomInt;

  constructor(
    @Inject(SLOTS_REPOSITORY) private readonly repo: SlotsRepository,
    @Inject(WALLETS_REPOSITORY) private readonly wallets: WalletsRepository,
    @Inject(GM_REPOSITORY) private readonly gm: GmRepository,
  ) {}

  async state(user: SessionUser): Promise<SlotsState> {
    // The page still opens when the tables can't be read (before they are added to the game database,
    // say): it shows a closed floor with the starting stakes and nothing on it.
    const [settings, characters, mine, bigWins] = await Promise.all([
      this.readOr('settings', () => this.repo.settings(), CLOSED),
      this.readOr<WalletCharacterRow[]>("account's characters", () => this.wallets.characters(user.userId), []),
      this.readOr<SlotSpinRow[]>("account's spins", () => this.repo.spinsOf(user.userId, MINE), []),
      this.readOr<SlotSpinRow[]>('big wins', () => this.repo.bigWins(BIG_WINS), []),
    ]);
    return {
      live: settings.live,
      machines: machineStates(settings),
      characters: characters.map(walletCharacterView),
      mine: spinViews(mine),
      bigWins: spinViews(bigWins),
    };
  }

  async spin(user: SessionUser, request: SlotSpinRequest): Promise<SlotSpinResult> {
    const settings = await this.write(() => this.repo.settings());
    const machine = slotMachine(request.machine);
    // The repository checks only the floor switch and pays whatever it is given, so every other refusal is made here.
    if (!machine) throw new NotFoundException('There is no such machine');
    if (!settings.live) throw new ServiceUnavailableException(CLOSED_FLOOR);
    const own = settings.machines[machine.key];
    if (!own.live) throw new ConflictException('That machine is closed');
    if (!own.stakes.includes(request.stake)) throw new UnprocessableEntityException('That stake is no longer offered on this machine');

    // Reel 1 first.
    const stops: SlotStops = [this.random(SLOT_REEL_STOPS), this.random(SLOT_REEL_STOPS), this.random(SLOT_REEL_STOPS)];
    const { multiple } = slotPrize(machine, stops);
    const stake = request.stake;
    const payout = stake * multiple;
    const outcome = await this.write(() =>
      this.repo.bet({
        userId: user.userId,
        charId: request.characterId,
        machine: machine.key,
        stops,
        stake,
        payout,
        multiple,
        add: 0,
        cap: settings.jackpot.cap,
        roll: 0,
      }),
    );

    switch (outcome.code) {
      case BET_CLOSED:
        throw new ServiceUnavailableException(CLOSED_FLOOR);
      case BET_NOT_YOURS:
        throw new UnprocessableEntityException('Pick one of your own characters');
      case BET_ONLINE:
        throw new ConflictException(`Log out of ${outcome.name} in the game first`);
      case BET_POOR:
        throw new UnprocessableEntityException('Not enough money in that wallet');
    }

    const state = await this.state(user);
    const spin: SlotSpinView = state.mine.find((row) => row.id === outcome.id) ?? {
      id: outcome.id,
      at: new Date().toISOString(),
      character: state.characters.find((c) => c.id === request.characterId)?.name ?? '',
      machine: machine.key,
      stops,
      stake,
      payout,
    };
    return { spin, wallet: outcome.wallet, state };
  }

  async gmState(): Promise<GmSlots> {
    const [settings, totals, latest] = await Promise.all([
      this.readOr('settings', () => this.repo.settings(), CLOSED),
      this.readOr('totals', () => this.repo.totals(), {} as Awaited<ReturnType<SlotsRepository['totals']>>),
      this.readOr<SlotSpinRow[]>('latest spins', () => this.repo.latest(LATEST), []),
    ]);
    return {
      live: settings.live,
      machines: machineStates(settings).map(
        (machine): GmSlotMachine => ({
          ...machine,
          today: totalsView(totals[machine.key]?.today),
          allTime: totalsView(totals[machine.key]?.allTime),
        }),
      ),
      latest: spinViews(latest),
    };
  }

  async saveFloor(live: boolean, actor: Actor): Promise<GmSlots> {
    await this.write(() => this.repo.saveFloor(live, actor.username));
    await this.audit(`FLOOR ${onOff(live)}`, actor);
    return this.gmState();
  }

  async saveMachine(key: SlotMachineKey, settings: SlotMachineSettingsInput, actor: Actor): Promise<GmSlots> {
    if (!slotMachine(key)) throw new NotFoundException('There is no such machine');
    await this.write(() => this.repo.saveMachine(key, settings, actor.username));
    await this.audit(`SET ${key} ${onOff(settings.live)} stakes ${settings.stakes.join(',')}`, actor);
    return this.gmState();
  }

  private async readOr<T>(what: string, read: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await read();
    } catch (error) {
      this.logger.warn(`Could not read the slots' ${what}: ${describe(error)}`);
      return fallback;
    }
  }

  /** Anything that has to work, or the request fails: most likely the slots' tables are not in this game database yet. */
  private async write<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      this.logger.warn(`The slots' tables could not be used: ${describe(error)}`);
      throw new HttpException(UNAVAILABLE, 503);
    }
  }

  private async audit(log: string, actor: Actor): Promise<void> {
    try {
      await this.gm.writeAudit({ ip: actor.ip, gmId: actor.username, command: AUDIT_COMMAND, log });
    } catch (error) {
      this.logger.warn(`Could not write the slots audit row: ${describe(error)}`);
    }
  }
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));
const onOff = (live: boolean) => (live ? 'on' : 'off');

const machineStates = (settings: SlotSettings): SlotMachineState[] =>
  SLOT_MACHINES.map((m) => ({ key: m.key, live: settings.machines[m.key].live, stakes: [...settings.machines[m.key].stakes] }));

const totalsView = (row: SlotTotalsRow = NO_TOTALS): SlotTotals => ({ spins: row.spins, staked: row.staked, paid: row.paid });

const stopsInRange = (stops: SlotStops) => stops.length === 3 && stops.every((s) => Number.isInteger(s) && s >= 0 && s < SLOT_REEL_STOPS);

/** A spin for a machine the code no longer has, or with stops that cannot be shown, is left out. */
const spinViews = (rows: SlotSpinRow[]): SlotSpinView[] =>
  rows.flatMap((row) => {
    const machine = slotMachine(row.machine);
    if (!machine || !stopsInRange(row.stops)) return [];
    return [
      {
        id: row.id,
        at: row.spunAt.toISOString(),
        character: row.character,
        machine: machine.key,
        stops: [...row.stops] as SlotStops,
        stake: row.stake,
        payout: row.payout,
      },
    ];
  });
