import {
  BRONZE_PER_GOLD,
  parseSlotFree,
  parseSlotStakes,
  SLOT_BIG_WIN,
  SLOT_DAILY_DEFAULT,
  SLOT_DAILY_MAX,
  SLOT_DAILY_MIN,
  SLOT_JACKPOT_MAX_CAP,
  SLOT_JACKPOT_MIN_CAP,
  SLOT_JACKPOT_ROLLS,
  SLOT_MACHINE_KEYS,
  SLOT_MACHINES,
  SLOT_POT_DEFAULT_CAP,
  SLOT_POT_ROW,
  SLOT_POTS,
  SLOT_RULES_CASCADE,
  slotFreeText,
  type SlotMachineKey,
  type SlotMeterView,
  type SlotPot,
  type SlotPotsSettingsInput,
  type SlotStakes,
  type SlotStops,
  type Wallet,
} from '@4story-portal/shared';
import { Injectable } from '@nestjs/common';
import sql from 'mssql';
import { DbService } from '../db/db.service.js';
import { BET_OK, type BetCode, settingIsOn, walletBetSql } from '../games/wallet-bet.js';

export type SlotSettings = {
  live: boolean;
  machines: Record<SlotMachineKey, { live: boolean; stakes: SlotStakes }>;
  /** Caps in whole Gold. */
  pots: Record<SlotPot, { live: boolean; cap: number }>;
  /** Rounds an account may play a day. */
  daily: number;
};

/** The rules number written on every new row; 1 is the old three-reel rows, 2 the five-reel rows without cascades. */
export const SLOT_RULES = SLOT_RULES_CASCADE;

/** The bet's own refusals, from its check step: the account has played today's rounds; the meter is not what was read. */
export const SLOT_DAILY_REFUSED = 10,
  SLOT_METER_REFUSED = 11;
export type SlotRefusal = typeof SLOT_DAILY_REFUSED | typeof SLOT_METER_REFUSED;

/**
 * One round: the paid spin's stops, its free spins and the meter's free spins. Money in Silver, the whole round's.
 * `pots` is the whole Silver won from each pot, 0 for one it did not win; `jackpot` is their sum.
 */
export type SlotSpinRow = {
  id: number;
  userId: number;
  character: string;
  spunAt: Date;
  machine: string;
  stops: SlotStops;
  free: SlotStops[];
  meterFree: SlotStops[];
  /** The meter's points before the round, which a replay needs to know whether the meter fired. */
  meterBefore: number;
  stake: number;
  payout: number;
  jackpot: number;
  pots: Record<SlotPot, number>;
};

/**
 * Money in Silver; the repository multiplies by 1000 for the database. `payout` is the whole round's.
 * `multiple` is min(32767, floor(payout / stake)), worked out by the caller.
 * `meterBefore` is the meter the caller read for this machine and stake, `meterAfter` what the round leaves it at.
 * `daily` is the most rounds the account may have played today for this one to play.
 * `adds` are Bronze, 0 to leave a pot alone. `caps` are whole Gold: the cap set now, taken by a pot that has none.
 * `rolls` are whole numbers from 0 up to SLOT_JACKPOT_ROLLS, read only for a pot whose add is above 0.
 */
export type SlotBetInput = {
  userId: number;
  charId: number;
  machine: SlotMachineKey;
  stops: SlotStops;
  free: SlotStops[];
  meterFree: SlotStops[];
  stake: number;
  payout: number;
  multiple: number;
  meterBefore: number;
  meterAfter: number;
  daily: number;
  adds: Record<SlotPot, number>;
  caps: Record<SlotPot, number>;
  rolls: Record<SlotPot, number>;
};

export type SlotBetOutcome =
  | { code: typeof BET_OK; id: number; wallet: Wallet; /** Whole Silver won from each pot. */ pots: Record<SlotPot, number> }
  | { code: Exclude<BetCode, typeof BET_OK> | SlotRefusal; name: string | null };

/** Money in Silver; `added` is whole Silver, rounded down. */
export type SlotTotalsRow = { spins: number; staked: number; paid: number; added: number };

/** `amount` and `cap` are Bronze; `cap` is null until a lost round first adds to this pot. */
export type SlotPotRow = { pot: SlotPot; amount: number; cap: number | null };

/** `added` is Bronze, `paid` whole Silver. */
export type SlotJackpotTotalsRow = { added: number; paid: number; drops: number };

export interface SlotsRepository {
  /**
   * Floor closed, machines open and starting stakes, every pot on with its starting cap, 1,500 rounds a day, where rows
   * are missing or unreadable. Caps that do not rise Mini, Major, Giga all go back to their starting caps together.
   */
  settings(): Promise<SlotSettings>;
  saveFloor(live: boolean, changedBy: string): Promise<void>;
  saveMachine(key: SlotMachineKey, settings: { live: boolean; stakes: SlotStakes }, changedBy: string): Promise<void>;
  /** Caps in whole Gold; the caller has checked they rise. */
  savePots(input: SlotPotsSettingsInput, changedBy: string): Promise<void>;
  saveDaily(rounds: number, changedBy: string): Promise<void>;
  /**
   * Takes the stake and pays the payout in the character's wallet, moves the meter and records the round, together,
   * or refuses with nothing moved: past today's rounds (SLOT_DAILY_REFUSED), a meter that is not meterBefore
   * (SLOT_METER_REFUSED), or a shared refusal. Each pot whose add is above 0 takes it, and on a drop is paid its whole
   * Silver, in the same step.
   */
  bet(input: SlotBetInput): Promise<SlotBetOutcome>;
  /** All three, Mini first. Throws when the table cannot be read or a row is missing (a database without the three pots). */
  pots(): Promise<SlotPotRow[]>;
  /** The account's meters on the machines the code has, by machine and stake. */
  meters(userId: number): Promise<SlotMeterView[]>;
  /** The account's points on this machine at this stake (whole Silver); 0 when there is no row. */
  meter(userId: number, machine: SlotMachineKey, stake: number): Promise<number>;
  /** The account's rounds since the database's midnight, of every rules number. */
  roundsToday(userId: number): Promise<number>;
  /** Newest first. */
  spinsOf(userId: number, limit: number): Promise<SlotSpinRow[]>;
  /** Spins that paid SLOT_BIG_WIN times the stake or more, or won a jackpot, newest first. */
  bigWins(limit: number): Promise<SlotSpinRow[]>;
  /** Spins that won this pot, newest first. */
  jackpotWins(pot: SlotPot, limit: number): Promise<SlotSpinRow[]>;
  /** Anyone's spins, newest first. */
  latest(limit: number): Promise<SlotSpinRow[]>;
  /** Keyed by szMachine, so a machine the code no longer has still counts; today by the database's own date. */
  totals(): Promise<Record<string, { today: SlotTotalsRow; allTime: SlotTotalsRow }>>;
  /** Every row of every rules number; what the one pot took and paid before the three is the Giga's. */
  jackpotTotals(): Promise<Record<SlotPot, SlotJackpotTotalsRow>>;
}

export const SLOTS_REPOSITORY = Symbol('SLOTS_REPOSITORY');
export const SLOTS_LIVE_KEY = 'slots_live';
export const SLOTS_DAILY_KEY = 'slots_daily_rounds';
/** The Giga keeps the keys of the one pot that came before the three. */
export const SLOTS_POT_KEYS: Record<SlotPot, { live: string; cap: string }> = {
  mini: { live: 'slots_jackpot_mini_live', cap: 'slots_jackpot_mini_cap' },
  major: { live: 'slots_jackpot_major_live', cap: 'slots_jackpot_major_cap' },
  giga: { live: 'slots_jackpot_live', cap: 'slots_jackpot_cap' },
};

const machineLiveKey = (key: SlotMachineKey) => `slots_${key}_live`;
const machineStakesKey = (key: SlotMachineKey) => `slots_${key}_stakes`;
const SILVER = 1000; // Bronze in one Silver

/** Each pot's name in the batch's variables and the spin table's columns: @addMini, llWonMini. Constants, never input. */
const POT_NAME: Record<SlotPot, 'Mini' | 'Major' | 'Giga'> = { mini: 'Mini', major: 'Major', giga: 'Giga' };
/** The pots in the order the batch locks their rows: 1 (Giga), 2 (Mini), 3 (Major). */
const POTS_BY_ROW = [...SLOT_POTS].sort((a, b) => SLOT_POT_ROW[a] - SLOT_POT_ROW[b]);

/** A whole number written as digits only, within the limits; otherwise null. */
function parseWhole(text: string | undefined, min: number, max: number): number | null {
  if (text === undefined || !/^\d+$/.test(text)) return null;
  const n = Number(text);
  return n >= min && n <= max ? n : null;
}

/** Each pot's switch (on until a GM turns it off) and cap; caps that do not rise Mini < Major < Giga all start over. */
function potSettings(values: Map<string, string>): SlotSettings['pots'] {
  const read = (pot: SlotPot) => {
    const live = values.get(SLOTS_POT_KEYS[pot].live);
    return {
      live: live === undefined || settingIsOn(live),
      cap: parseWhole(values.get(SLOTS_POT_KEYS[pot].cap), SLOT_JACKPOT_MIN_CAP, SLOT_JACKPOT_MAX_CAP) ?? SLOT_POT_DEFAULT_CAP[pot],
    };
  };
  const pots = { mini: read('mini'), major: read('major'), giga: read('giga') };
  if (!(pots.mini.cap < pots.major.cap && pots.major.cap < pots.giga.cap)) {
    for (const pot of SLOT_POTS) pots[pot].cap = SLOT_POT_DEFAULT_CAP[pot];
  }
  return pots;
}

/**
 * The account's rounds since the database's midnight, every rules number, on the account-and-time index. Binds @userId.
 * Rows of every rules number count, so the limit cannot be dodged across a change of rules.
 */
const roundsTodaySql = (spins: string) =>
  `SELECT @played = COUNT(*) FROM ${spins} WITH (INDEX(IX_TPORTALSLOTSPIN_USER_TIME))
  WHERE dwUserID = @userId AND dSpun >= CAST(CAST(GETDATE() AS DATE) AS DATETIME)`;

/**
 * The slots' check step: the daily limit, then the meter. Lock order for the whole bet: the account's rows in the online
 * list, then the character (both taken by the shared part), then the meter row (here), then the pots in row order
 * 1, 2, 3 (in the pot step). Every bet takes them in that order, so two bets never wait on each other in a circle.
 * The count takes no lock of its own: it is right because the shared part already holds the range lock on the
 * account's online-list rows, which every bet of this account takes first, so one account's bets run one at a time
 * and none can add a row between this count and this bet's INSERT. The meter row is read with UPDLOCK and HOLDLOCK,
 * so where there is no row the key range is held and a meter cannot appear under it before the COMMIT.
 * NULL is named on its own, since a comparison with it is unknown and would let the round through.
 * Only assignments, so the batch's own result stays its first. @points is NULL when there is no row.
 */
const checkStep = (spins: string, meters: string) => `DECLARE @played INT, @points INT;
  IF @daily IS NULL OR @meterBefore IS NULL OR @meterAfter IS NULL THROW 50000, 'A round needs its daily limit and its meter', 1;
  ${roundsTodaySql(spins)};
  IF @played >= @daily SET @code = ${SLOT_DAILY_REFUSED};
  ELSE
  BEGIN
    SELECT @points = bPoints FROM ${meters} WITH (UPDLOCK, HOLDLOCK)
    WHERE dwUserID = @userId AND szMachine = @machine AND dwStake = @meterStake;
    IF ISNULL(@points, 0) <> @meterBefore SET @code = ${SLOT_METER_REFUSED};
  END`;

/**
 * One pot's part of the pot step, under the lock order above. The rule is slotJackpotDrops in whole numbers; DECIMAL
 * because a 10,000 Gold cap times the roll range is past what a BIGINT holds.
 * A round that pays, adds more than its stake or brings a roll outside the range would make or win gold that no real
 * round can, and the pot would still be what was added less what was paid, so nothing else would show it. It is
 * refused before the pot is read; under XACT_ABORT the THROW rolls everything back. NULL is named on its own.
 * @pot is emptied first: a SELECT that finds no row assigns nothing, and would keep the amount of the pot handled before.
 */
const onePot = (jackpot: string, pot: SlotPot) => {
  const n = POT_NAME[pot];
  const row = SLOT_POT_ROW[pot];
  return `IF @add${n} IS NULL OR @roll${n} IS NULL OR @cap${n} IS NULL OR @add${n} > @stake OR @payout > 0 OR @roll${n} < 0 OR @roll${n} >= ${SLOT_JACKPOT_ROLLS}
    THROW 50000, 'A round cannot add that to the jackpot', 1;
  SET @pot = NULL;
  SELECT @pot = llPot, @cap = ISNULL(llCap, @cap${n}) FROM ${jackpot} WITH (UPDLOCK, ROWLOCK) WHERE bID = ${row};
  IF @pot IS NULL THROW 50001, 'The jackpot row is missing', 1;
  SET @from = CASE WHEN @pot > @cap / 10 THEN @pot ELSE @cap / 10 END;
  SET @pot = @pot + @add${n};
  SET @to = CASE WHEN @pot > @cap / 10 THEN @pot ELSE @cap / 10 END;
  IF @from >= @cap OR CAST(@roll${n} AS DECIMAL(38,0)) * (@cap - @from) < CAST(@to - @from AS DECIMAL(38,0)) * ${SLOT_JACKPOT_ROLLS}
  BEGIN
    -- The whole Silver is paid; the odd Bronze stays as the next pot, which takes the cap set when it next grows.
    SET @won${n} = (@pot / ${SILVER}) * ${SILVER};
    SET @extra = @extra + @won${n};
    UPDATE ${jackpot} SET llPot = @pot % ${SILVER}, llCap = NULL WHERE bID = ${row};
  END
  ELSE UPDATE ${jackpot} SET llPot = @pot, llCap = @cap WHERE bID = ${row}`;
};

/**
 * The slots' before step, run once every check has passed: the meter, then each pot whose add is above 0, in row order.
 * The meter is written only when it changes or its row is there; a round that leaves an absent meter at 0 writes none.
 * (An absent row was read as 0, so that is a round that starts and ends at 0.) Only statements that return no rows.
 * @wonMini, @wonMajor and @wonGiga are what each pot paid, in Bronze; the record and the batch's last SELECT read them.
 */
const beforeStep = (tables: { slotJackpot: string; slotMeters: string }, feeding: SlotPot[]) => {
  const meter = `IF @points IS NOT NULL OR @meterAfter <> 0
    MERGE ${tables.slotMeters} WITH (HOLDLOCK) AS target
    USING (VALUES (@userId, @machine, @meterStake)) AS source (dwUserID, szMachine, dwStake)
      ON target.dwUserID = source.dwUserID AND target.szMachine = source.szMachine AND target.dwStake = source.dwStake
    WHEN MATCHED THEN UPDATE SET bPoints = @meterAfter, dUpdated = GETDATE()
    WHEN NOT MATCHED THEN INSERT (dwUserID, szMachine, dwStake, bPoints) VALUES (source.dwUserID, source.szMachine, source.dwStake, @meterAfter)`;
  // The adds together are part of one lost stake too, so the same refusal.
  const pots = feeding.length
    ? [
        `IF @payout > 0 OR @addMini + @addMajor + @addGiga > @stake THROW 50000, 'A round cannot add that to the jackpot', 1`,
        'DECLARE @pot BIGINT, @cap BIGINT, @from BIGINT, @to BIGINT',
        ...feeding.map((pot) => onePot(tables.slotJackpot, pot)),
      ]
    : [];
  // Statements joined by semicolons; the batch ends the last one.
  return ['DECLARE @wonMini BIGINT = 0, @wonMajor BIGINT = 0, @wonGiga BIGINT = 0', meter, ...pots].join(';\n  ');
};

/** The money is BIGINT, so strings from the driver. */
type RawSpin = Omit<SlotSpinRow, 'stops' | 'free' | 'meterFree' | 'stake' | 'payout' | 'jackpot' | 'pots'> &
  Record<'stake' | 'payout' | 'jackpot' | 'wonMini' | 'wonMajor' | 'wonGiga', string> & {
    stop1: number;
    stop2: number;
    stop3: number;
    stop4: number;
    stop5: number;
    free: string;
    meterFree: string;
  };
type RawTotals = { machine: string } & Record<'spins' | 'todaySpins', number> &
  Record<'staked' | 'paid' | 'added' | 'todayStaked' | 'todayPaid' | 'todayAdded', string>;

/**
 * Each pot's add and win on a row, in Bronze. A row from before the three pots put everything in the one pot, now the
 * Giga, and holds 0 in the per-pot columns; on a cascade row llAdded and llJackpot are the three pots' sums.
 */
const potColumns = (pot: SlotPot) =>
  pot === 'giga'
    ? { add: `CASE WHEN bRules < ${SLOT_RULES} THEN llAdded ELSE llAddGiga END`, won: `CASE WHEN bRules < ${SLOT_RULES} THEN llJackpot ELSE llWonGiga END` }
    : { add: `llAdd${POT_NAME[pot]}`, won: `llWon${POT_NAME[pot]}` };

@Injectable()
export class SqlSlotsRepository implements SlotsRepository {
  private tx?: sql.Transaction;

  constructor(private readonly db: DbService) {}

  /** Returns a copy whose queries run on tx (used by tests to roll back). */
  withTransaction(tx: sql.Transaction): SqlSlotsRepository {
    const copy = new SqlSlotsRepository(this.db);
    copy.tx = tx;
    return copy;
  }

  private request(): sql.Request {
    return this.tx ? new sql.Request(this.tx) : this.db.pool.request();
  }

  async settings(): Promise<SlotSettings> {
    const result = await this.request().query<{ key: string; value: string }>(
      `SELECT szKey AS [key], szValue AS value FROM ${this.db.tables.portalSettings} WHERE szKey LIKE 'slots[_]%'`,
    );
    const values = new Map(result.recordset.map((row) => [row.key, row.value]));
    const machines = Object.fromEntries(
      SLOT_MACHINES.map((machine) => {
        const live = values.get(machineLiveKey(machine.key));
        const stakes = values.get(machineStakesKey(machine.key));
        return [
          machine.key,
          {
            // A machine is open until a GM closes it; the floor switch closes them all.
            live: live === undefined || settingIsOn(live),
            // parseSlotStakes refuses a stake above 5 Gold, so a row saved under the old limit starts over too.
            stakes: (stakes === undefined ? null : parseSlotStakes(stakes)) ?? [...machine.stakes],
          },
        ];
      }),
    ) as SlotSettings['machines'];
    return {
      // Read the switch as the bet's SQL does, so a hand-edited row means the same on the pages as on a POST.
      live: settingIsOn(values.get(SLOTS_LIVE_KEY)),
      machines,
      pots: potSettings(values),
      daily: parseWhole(values.get(SLOTS_DAILY_KEY), SLOT_DAILY_MIN, SLOT_DAILY_MAX) ?? SLOT_DAILY_DEFAULT,
    };
  }

  saveFloor(live: boolean, changedBy: string): Promise<void> {
    return this.save([[SLOTS_LIVE_KEY, String(live)]], changedBy);
  }

  saveMachine(key: SlotMachineKey, settings: { live: boolean; stakes: SlotStakes }, changedBy: string): Promise<void> {
    return this.save(
      [
        [machineLiveKey(key), String(settings.live)],
        [machineStakesKey(key), settings.stakes.join(',')],
      ],
      changedBy,
    );
  }

  savePots(input: SlotPotsSettingsInput, changedBy: string): Promise<void> {
    return this.save(
      SLOT_POTS.flatMap((pot): [string, string][] => [
        [SLOTS_POT_KEYS[pot].live, String(input[pot].live)],
        [SLOTS_POT_KEYS[pot].cap, String(input[pot].cap)],
      ]),
      changedBy,
    );
  }

  saveDaily(rounds: number, changedBy: string): Promise<void> {
    return this.save([[SLOTS_DAILY_KEY, String(rounds)]], changedBy);
  }

  /** One MERGE, so the rows change together. */
  private async save(rows: [key: string, value: string][], changedBy: string): Promise<void> {
    const request = this.request().input('by', sql.VarChar(50), changedBy);
    rows.forEach(([key, value], i) => request.input(`key${i}`, sql.VarChar(40), key).input(`value${i}`, sql.VarChar(200), value));
    await request.query(
      `MERGE ${this.db.tables.portalSettings} WITH (HOLDLOCK) AS target
       USING (VALUES ${rows.map((_, i) => `(@key${i}, @value${i})`).join(', ')})
         AS source (szKey, szValue) ON target.szKey = source.szKey
       WHEN MATCHED THEN UPDATE SET szValue = source.szValue, szUpdatedBy = @by, dUpdated = GETDATE()
       WHEN NOT MATCHED THEN INSERT (szKey, szValue, szUpdatedBy) VALUES (source.szKey, source.szValue, @by);`,
    );
  }

  async bet(input: SlotBetInput): Promise<SlotBetOutcome> {
    const { tables } = this.db;
    const record = `INSERT INTO ${tables.slotSpins}
      (dwUserID, dwCharID, szCharName, szMachine, bStop1, bStop2, bStop3, bStop4, bStop5, bRules, szFree, szMeterFree,
       llStake, llPayout, llWallet, wMultiple, llAdded, llJackpot, llAddMini, llAddMajor, llAddGiga, llWonMini, llWonMajor, llWonGiga,
       bMeterBefore)
      VALUES (@userId, @charId, @name, @machine, @stop1, @stop2, @stop3, @stop4, @stop5, @rules, @free, @meterFree,
       @stake, @payout, @wallet, @multiple, @addMini + @addMajor + @addGiga, @extra, @addMini, @addMajor, @addGiga, @wonMini, @wonMajor, @wonGiga,
       @meterBefore)`;
    const [stop1, stop2, stop3, stop4, stop5] = input.stops;
    // A pot whose add is 0 is not touched at all, so it neither waits for its lock nor sets its cap.
    const feeding = POTS_BY_ROW.filter((pot) => input.adds[pot] > 0);
    const request = this.request();
    for (const pot of SLOT_POTS) {
      const n = POT_NAME[pot];
      const feeds = feeding.includes(pot);
      request.input(`add${n}`, sql.BigInt, feeds ? input.adds[pot] : 0);
      if (feeds) request.input(`cap${n}`, sql.BigInt, input.caps[pot] * BRONZE_PER_GOLD).input(`roll${n}`, sql.BigInt, input.rolls[pot]);
    }
    // The batch's own row comes first; the last SELECT says what each pot paid.
    const batch = `${walletBetSql(tables, SLOTS_LIVE_KEY, record, beforeStep(tables, feeding), checkStep(tables.slotSpins, tables.slotMeters))}
SELECT @wonMini AS mini, @wonMajor AS major, @wonGiga AS giga;`;
    const result = await request
      .input('userId', sql.Int, input.userId)
      .input('charId', sql.Int, input.charId)
      .input('stake', sql.BigInt, input.stake * SILVER)
      .input('payout', sql.BigInt, input.payout * SILVER)
      .input('machine', sql.VarChar(20), input.machine)
      .input('meterStake', sql.Int, input.stake)
      .input('meterBefore', sql.TinyInt, input.meterBefore)
      .input('meterAfter', sql.TinyInt, input.meterAfter)
      .input('daily', sql.Int, input.daily)
      .input('stop1', sql.TinyInt, stop1)
      .input('stop2', sql.TinyInt, stop2)
      .input('stop3', sql.TinyInt, stop3)
      .input('stop4', sql.TinyInt, stop4)
      .input('stop5', sql.TinyInt, stop5)
      .input('rules', sql.TinyInt, SLOT_RULES)
      .input('free', sql.VarChar(800), slotFreeText(input.free))
      .input('meterFree', sql.VarChar(800), slotFreeText(input.meterFree))
      .input('multiple', sql.SmallInt, input.multiple)
      .query(batch);
    const [outcome, won] = result.recordsets as unknown as [
      sql.IRecordSet<{ code: BetCode | SlotRefusal; id: number; name: string | null } & Wallet>,
      sql.IRecordSet<Record<SlotPot, string>>,
    ];
    const { code, id, name, gold, silver, copper } = outcome[0];
    if (code !== BET_OK) return { code, name };
    // Each pot pays whole Silver: the step rounds it down to that.
    const pots = Object.fromEntries(SLOT_POTS.map((pot) => [pot, Number(won[0][pot]) / SILVER])) as Record<SlotPot, number>;
    return { code, id, wallet: { gold, silver, copper }, pots };
  }

  async pots(): Promise<SlotPotRow[]> {
    const result = await this.request().query<{ id: number; amount: string; cap: string | null }>(
      `SELECT bID AS id, llPot AS amount, llCap AS cap FROM ${this.db.tables.slotJackpot} WHERE bID BETWEEN 1 AND 3`,
    );
    const rows = new Map(result.recordset.map((row) => [row.id, row]));
    const missing = SLOT_POTS.filter((pot) => !rows.has(SLOT_POT_ROW[pot]));
    if (missing.length) throw new Error(`The jackpot rows are missing: ${missing.join(', ')}`);
    return SLOT_POTS.map((pot) => {
      const row = rows.get(SLOT_POT_ROW[pot])!;
      return { pot, amount: Number(row.amount), cap: row.cap === null ? null : Number(row.cap) };
    });
  }

  async meters(userId: number): Promise<SlotMeterView[]> {
    const result = await this.request()
      .input('userId', sql.Int, userId)
      .query<{ machine: string; stake: number; points: number }>(
        `SELECT szMachine AS machine, dwStake AS stake, bPoints AS points FROM ${this.db.tables.slotMeters}
         WHERE dwUserID = @userId ORDER BY szMachine, dwStake`,
      );
    // A meter for a machine the code no longer has stays stored, out of sight.
    return result.recordset.filter((row): row is SlotMeterView => (SLOT_MACHINE_KEYS as readonly string[]).includes(row.machine));
  }

  async meter(userId: number, machine: SlotMachineKey, stake: number): Promise<number> {
    const result = await this.request()
      .input('userId', sql.Int, userId)
      .input('machine', sql.VarChar(20), machine)
      .input('stake', sql.Int, stake)
      .query<{ points: number }>(
        `SELECT bPoints AS points FROM ${this.db.tables.slotMeters} WHERE dwUserID = @userId AND szMachine = @machine AND dwStake = @stake`,
      );
    return result.recordset[0]?.points ?? 0;
  }

  async roundsToday(userId: number): Promise<number> {
    const result = await this.request()
      .input('userId', sql.Int, userId)
      .query<{ played: number }>(`DECLARE @played INT; ${roundsTodaySql(this.db.tables.slotSpins)}; SELECT @played AS played;`);
    return result.recordset[0].played;
  }

  private async spins(top: number, where: string, bind: (request: sql.Request) => sql.Request = (r) => r): Promise<SlotSpinRow[]> {
    const result = await bind(this.request())
      .input('top', sql.Int, top)
      .query<RawSpin>(
        `SELECT TOP (@top) dwID AS id, dwUserID AS userId, szCharName AS character, dSpun AS spunAt, szMachine AS machine,
                bStop1 AS stop1, bStop2 AS stop2, bStop3 AS stop3, bStop4 AS stop4, bStop5 AS stop5,
                szFree AS free, szMeterFree AS meterFree, bMeterBefore AS meterBefore,
                CAST(llStake / ${SILVER} AS BIGINT) AS stake, CAST(llPayout / ${SILVER} AS BIGINT) AS payout,
                CAST(llJackpot / ${SILVER} AS BIGINT) AS jackpot, CAST(llWonMini / ${SILVER} AS BIGINT) AS wonMini,
                CAST(llWonMajor / ${SILVER} AS BIGINT) AS wonMajor, CAST(llWonGiga / ${SILVER} AS BIGINT) AS wonGiga
         FROM ${this.db.tables.slotSpins}
         WHERE bRules = ${SLOT_RULES} AND (${where})
         ORDER BY dwID DESC`,
      );
    // A row whose free or meter spins cannot be read is left out, like one whose stops are out of range.
    return result.recordset.flatMap(
      ({ stop1, stop2, stop3, stop4, stop5, free, meterFree, stake, payout, jackpot, wonMini, wonMajor, wonGiga, ...row }): SlotSpinRow[] => {
        const freeSpins = parseSlotFree(free);
        const meterSpins = parseSlotFree(meterFree);
        if (!freeSpins || !meterSpins) return [];
        return [
          {
            ...row,
            stops: [stop1, stop2, stop3, stop4, stop5],
            free: freeSpins,
            meterFree: meterSpins,
            stake: Number(stake),
            payout: Number(payout),
            jackpot: Number(jackpot),
            pots: { mini: Number(wonMini), major: Number(wonMajor), giga: Number(wonGiga) },
          },
        ];
      },
    );
  }

  spinsOf(userId: number, limit: number): Promise<SlotSpinRow[]> {
    return this.spins(limit, 'dwUserID = @userId', (r) => r.input('userId', sql.Int, userId));
  }

  bigWins(limit: number): Promise<SlotSpinRow[]> {
    return this.spins(limit, 'wMultiple >= @bigWin OR llJackpot > 0', (r) => r.input('bigWin', sql.SmallInt, SLOT_BIG_WIN));
  }

  jackpotWins(pot: SlotPot, limit: number): Promise<SlotSpinRow[]> {
    // The column comes from a constant per pot, never from input.
    return this.spins(limit, `llWon${POT_NAME[pot]} > 0`);
  }

  latest(limit: number): Promise<SlotSpinRow[]> {
    return this.spins(limit, '1 = 1');
  }

  async totals(): Promise<Record<string, { today: SlotTotalsRow; allTime: SlotTotalsRow }>> {
    // Sums of BIGINT come back from the driver as strings.
    const result = await this.request().query<RawTotals>(
      `DECLARE @today DATETIME = CAST(CAST(GETDATE() AS DATE) AS DATETIME);
       SELECT szMachine AS machine,
              COUNT(*) AS spins, SUM(llStake) / ${SILVER} AS staked, SUM(llPayout) / ${SILVER} AS paid, SUM(llAdded) / ${SILVER} AS added,
              COUNT(CASE WHEN dSpun >= @today THEN 1 END) AS todaySpins,
              ISNULL(SUM(CASE WHEN dSpun >= @today THEN llStake END), 0) / ${SILVER} AS todayStaked,
              ISNULL(SUM(CASE WHEN dSpun >= @today THEN llPayout END), 0) / ${SILVER} AS todayPaid,
              ISNULL(SUM(CASE WHEN dSpun >= @today THEN llAdded END), 0) / ${SILVER} AS todayAdded
       FROM ${this.db.tables.slotSpins}
       GROUP BY szMachine`,
    );
    return Object.fromEntries(
      result.recordset.map((row) => [
        row.machine,
        {
          today: { spins: row.todaySpins, staked: Number(row.todayStaked), paid: Number(row.todayPaid), added: Number(row.todayAdded) },
          allTime: { spins: row.spins, staked: Number(row.staked), paid: Number(row.paid), added: Number(row.added) },
        },
      ]),
    );
  }

  async jackpotTotals(): Promise<Record<SlotPot, SlotJackpotTotalsRow>> {
    const columns = SLOT_POTS.map((pot) => {
      const { add, won } = potColumns(pot);
      return `ISNULL(SUM(${add}), 0) AS ${pot}Added, ISNULL(SUM(${won}), 0) / ${SILVER} AS ${pot}Paid, COUNT(CASE WHEN ${won} > 0 THEN 1 END) AS ${pot}Drops`;
    });
    const result = await this.request().query<Record<string, string | number>>(`SELECT ${columns.join(',\n       ')} FROM ${this.db.tables.slotSpins}`);
    const row = result.recordset[0];
    return Object.fromEntries(
      SLOT_POTS.map((pot) => [pot, { added: Number(row[`${pot}Added`]), paid: Number(row[`${pot}Paid`]), drops: Number(row[`${pot}Drops`]) }]),
    ) as Record<SlotPot, SlotJackpotTotalsRow>;
  }
}
