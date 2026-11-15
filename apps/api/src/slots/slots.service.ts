import { randomInt } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  BRONZE_PER_SILVER,
  type GmSlotMachine,
  type GmSlotPot,
  type GmSlots,
  type SessionUser,
  SLOT_DAILY_DEFAULT,
  SLOT_JACKPOT_ROLLS,
  SLOT_LINE_COUNT,
  SLOT_MACHINES,
  SLOT_POT_DEFAULT_CAP,
  SLOT_POTS,
  SLOT_REEL_STOPS,
  SLOT_REELS,
  slotJackpotAdds,
  type SlotJackpotView,
  slotMachine,
  type SlotMachine,
  type SlotMachineKey,
  type SlotMachineSettingsInput,
  type SlotMachineState,
  type SlotMeterView,
  slotPlayRound,
  type SlotPot,
  type SlotPotsSettingsInput,
  slotReplayRound,
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
import {
  SLOT_DAILY_REFUSED,
  SLOT_METER_REFUSED,
  SLOTS_REPOSITORY,
  type SlotJackpotTotalsRow,
  type SlotPotRow,
  type SlotSettings,
  type SlotsRepository,
  type SlotSpinRow,
  type SlotTotalsRow,
} from './slots.repository.js';

type Actor = { username: string; ip: string };

const AUDIT_COMMAND = 'SLOTS';
const MINE = 10;
const BIG_WINS = 10;
const LATEST = 20;
const UNAVAILABLE = 'Slots are not available right now';
const CLOSED_FLOOR = 'The slots are not open yet';

/** A value for each pot, worked out in the order Mini, Major, Giga. */
const eachPot = <T>(value: (pot: SlotPot) => T) => Object.fromEntries(SLOT_POTS.map((pot) => [pot, value(pot)])) as Record<SlotPot, T>;

const CLOSED: SlotSettings = {
  live: false,
  machines: Object.fromEntries(SLOT_MACHINES.map((m) => [m.key, { live: true, stakes: [...m.stakes] }])) as SlotSettings['machines'],
  pots: eachPot((pot) => ({ live: true, cap: SLOT_POT_DEFAULT_CAP[pot] })),
  daily: SLOT_DAILY_DEFAULT,
};
const NO_TOTALS: SlotTotalsRow = { spins: 0, staked: 0, paid: 0, added: 0 };
const NO_JACKPOT_TOTALS: SlotJackpotTotalsRow = { added: 0, paid: 0, drops: 0 };
const NOTHING: Record<SlotPot, number> = { mini: 0, major: 0, giga: 0 };
/** One Gold is this many Silver. */
const SILVER_PER_GOLD = 1000;
const JACKPOT_WINS = 10;
/** The most a SMALLINT column holds. */
const MAX_MULTIPLE = 32_767;

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
    // say): it shows a closed floor with the starting stakes and nothing on it. On a database without the
    // cascades' columns and tables, the lists, the pots and the meters are empty.
    const [settings, characters, mine, bigWins, pots, lastWins, meters, played] = await Promise.all([
      this.readOr('settings', () => this.repo.settings(), CLOSED),
      this.readOr<WalletCharacterRow[]>("account's characters", () => this.wallets.characters(user.userId), []),
      this.readOr<SlotSpinRow[]>("account's spins", () => this.repo.spinsOf(user.userId, MINE), []),
      this.readOr<SlotSpinRow[]>('big wins', () => this.repo.bigWins(BIG_WINS), []),
      this.readOr<SlotPotRow[]>('jackpots', () => this.repo.pots(), []),
      this.eachPotRead((pot) => this.readOr<SlotSpinRow[]>(`latest ${pot} win`, () => this.repo.jackpotWins(pot, 1), [])),
      this.readOr<SlotMeterView[]>("account's meters", () => this.repo.meters(user.userId), []),
      this.readOr("account's rounds today", () => this.repo.roundsToday(user.userId), 0),
    ]);
    return {
      live: settings.live,
      machines: machineStates(settings),
      characters: characters.map(walletCharacterView),
      mine: spinViews(mine),
      bigWins: spinViews(bigWins),
      jackpots: pots.map((row) => jackpotView(settings, row, lastWins[row.pot][0])),
      meters,
      daily: { limit: settings.daily, played },
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
    const stake = request.stake;
    // The round needs the meter to know whether it fills, so it is read before anything is drawn. A database
    // without the meter table refuses here, with nothing drawn. The money step checks it has not moved since.
    const meterBefore = await this.write(() => this.repo.meter(user.userId, machine.key, stake));

    // Draws, in order: the paid spin's five reels, each free spin's five reels as played, each meter free spin's,
    // then, for a lost round, the three jackpot numbers.
    const round = slotPlayRound(machine, meterBefore, () => this.reels());
    // Stakes are multiples of the line count, so this is whole Silver.
    const payout = (round.lineStakes * stake) / SLOT_LINE_COUNT;
    // The column is a SMALLINT.
    const multiple = Math.min(MAX_MULTIPLE, Math.floor(payout / stake));
    // Only a round that pays nothing in all feeds the pots. The three numbers are drawn whenever any pot is on, even
    // for the pots that are off, so the draws never depend on which pots are on.
    const feeds = payout === 0 && SLOT_POTS.some((pot) => settings.pots[pot].live);
    const shares = feeds ? slotJackpotAdds(machine, stake) : NOTHING;
    // The money step does not read the switches: a pot that is off is kept out here, with an add of 0.
    const adds = eachPot((pot) => (settings.pots[pot].live ? shares[pot] : 0));
    // An object literal's values are worked out in the order written: Mini, Major, Giga.
    const rolls = feeds
      ? { mini: this.random(SLOT_JACKPOT_ROLLS), major: this.random(SLOT_JACKPOT_ROLLS), giga: this.random(SLOT_JACKPOT_ROLLS) }
      : { ...NOTHING };
    const outcome = await this.write(() =>
      this.repo.bet({
        userId: user.userId,
        charId: request.characterId,
        machine: machine.key,
        stops: round.stops,
        free: round.free,
        meterFree: round.meterFree,
        stake,
        payout,
        multiple,
        meterBefore,
        meterAfter: round.meterAfter,
        daily: settings.daily,
        adds,
        caps: eachPot((pot) => settings.pots[pot].cap),
        rolls,
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
      case SLOT_DAILY_REFUSED:
        throw new ForbiddenException(`You have played today's ${settings.daily.toLocaleString('en-US')} rounds. The slots open again for you tomorrow.`);
      case SLOT_METER_REFUSED:
        throw new ConflictException('Your meter changed. Press Spin again.');
    }

    const state = await this.state(user);
    const spin: SlotSpinView = state.mine.find((row) => row.id === outcome.id) ?? {
      id: outcome.id,
      at: new Date().toISOString(),
      character: state.characters.find((c) => c.id === request.characterId)?.name ?? '',
      machine: machine.key,
      stops: round.stops,
      free: round.free,
      meterFree: round.meterFree,
      meterBefore,
      stake,
      payout,
      jackpot: SLOT_POTS.reduce((sum, pot) => sum + outcome.pots[pot], 0),
      pots: outcome.pots,
    };
    return { spin, wallet: outcome.wallet, state, meter: { machine: machine.key, stake, points: round.meterAfter } };
  }

  /** One spin's five reels, reel 1 first. */
  private reels(): SlotStops {
    return Array.from({ length: SLOT_REELS }, () => this.random(SLOT_REEL_STOPS)) as SlotStops;
  }

  async gmState(): Promise<GmSlots> {
    const [settings, totals, latest, pots, jackpotTotals, wins] = await Promise.all([
      this.readOr('settings', () => this.repo.settings(), CLOSED),
      this.readOr('totals', () => this.repo.totals(), {} as Awaited<ReturnType<SlotsRepository['totals']>>),
      this.readOr<SlotSpinRow[]>('latest spins', () => this.repo.latest(LATEST), []),
      this.readOr<SlotPotRow[]>('jackpots', () => this.repo.pots(), []),
      this.readOr<Record<SlotPot, SlotJackpotTotalsRow> | null>('jackpot totals', () => this.repo.jackpotTotals(), null),
      this.eachPotRead((pot) => this.readOr<SlotSpinRow[]>(`${pot} wins`, () => this.repo.jackpotWins(pot, JACKPOT_WINS), [])),
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
      jackpots: SLOT_POTS.map((pot): GmSlotPot => {
        const row = pots.find((p) => p.pot === pot);
        const sums = jackpotTotals?.[pot] ?? NO_JACKPOT_TOTALS;
        return {
          pot,
          live: settings.pots[pot].live,
          setCap: settings.pots[pot].cap,
          running: row ? potView(settings, row) : null,
          added: Math.floor(sums.added / BRONZE_PER_SILVER),
          paid: sums.paid,
          drops: sums.drops,
          wins: spinViews(wins[pot]),
        };
      }),
      daily: { limit: settings.daily },
    };
  }

  async savePots(settings: SlotPotsSettingsInput, actor: Actor): Promise<GmSlots> {
    await this.write(() => this.repo.savePots(settings, actor.username));
    await this.audit(`JACKPOTS ${SLOT_POTS.map((pot) => `${pot} ${onOff(settings[pot].live)} ${settings[pot].cap}`).join(' ')}`, actor);
    return this.gmState();
  }

  async saveDaily(rounds: number, actor: Actor): Promise<GmSlots> {
    await this.write(() => this.repo.saveDaily(rounds, actor.username));
    await this.audit(`DAILY ${rounds}`, actor);
    return this.gmState();
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

  /** One read per pot, together. The pot comes from SLOT_POTS only: the repository puts its name into SQL. */
  private async eachPotRead<T>(read: (pot: SlotPot) => Promise<T>): Promise<Record<SlotPot, T>> {
    const values = await Promise.all(SLOT_POTS.map(read));
    return Object.fromEntries(SLOT_POTS.map((pot, i) => [pot, values[i]])) as Record<SlotPot, T>;
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

const totalsView = (row: SlotTotalsRow = NO_TOTALS): SlotTotals => ({ spins: row.spins, staked: row.staked, paid: row.paid, added: row.added });

/** Whole Silver. The pot's own cap while it has one; the cap set now only while it has none. */
const potView = (settings: SlotSettings, row: SlotPotRow) => {
  const cap = row.cap === null ? settings.pots[row.pot].cap * SILVER_PER_GOLD : Math.floor(row.cap / BRONZE_PER_SILVER);
  return { pot: Math.floor(row.amount / BRONZE_PER_SILVER), cap, floor: Math.floor(cap / 10) };
};

const jackpotView = (settings: SlotSettings, row: SlotPotRow, last: SlotSpinRow | undefined): SlotJackpotView => {
  const { pot: amount, cap, floor } = potView(settings, row);
  return {
    pot: row.pot,
    live: settings.pots[row.pot].live,
    amount,
    cap,
    floor,
    last: last ? { character: last.character, amount: last.pots[row.pot], at: last.spunAt.toISOString() } : null,
  };
};

const stopsInRange = (stops: SlotStops) => stops.length === SLOT_REELS && stops.every((s) => Number.isInteger(s) && s >= 0 && s < SLOT_REEL_STOPS);

/** Whether the rules can play the round again from its stops, as the page does: the right number of free and meter spins. */
const replays = (machine: SlotMachine, row: SlotSpinRow) => {
  try {
    slotReplayRound(machine, row);
    return true;
  } catch {
    return false;
  }
};

/** A spin for a machine the code no longer has, with stops that cannot be shown, or that the rules cannot replay, is left out. */
const spinViews = (rows: SlotSpinRow[]): SlotSpinView[] =>
  rows.flatMap((row) => {
    const machine = slotMachine(row.machine);
    if (!machine || !stopsInRange(row.stops) || !row.free.every(stopsInRange) || !row.meterFree.every(stopsInRange)) return [];
    if (!replays(machine, row)) return [];
    return [
      {
        id: row.id,
        at: row.spunAt.toISOString(),
        character: row.character,
        machine: machine.key,
        stops: [...row.stops] as SlotStops,
        free: row.free.map((stops) => [...stops] as SlotStops),
        meterFree: row.meterFree.map((stops) => [...stops] as SlotStops),
        meterBefore: row.meterBefore,
        stake: row.stake,
        payout: row.payout,
        jackpot: row.jackpot,
        pots: { ...row.pots },
      },
    ];
  });
