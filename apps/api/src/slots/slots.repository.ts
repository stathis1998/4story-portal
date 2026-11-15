import {
  BRONZE_PER_GOLD,
  parseSlotFree,
  parseSlotStakes,
  SLOT_BIG_WIN,
  SLOT_JACKPOT_DEFAULT_CAP,
  SLOT_JACKPOT_MAX_CAP,
  SLOT_JACKPOT_MIN_CAP,
  SLOT_JACKPOT_ROLLS,
  SLOT_MACHINES,
  slotFreeText,
  type SlotMachineKey,
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
  jackpot: { live: boolean; /** Whole Gold. */ cap: number };
};

/** The rules number written on every new row; 1 is the old three-reel rows. */
export const SLOT_RULES = 2;

/** One round: the paid spin's stops and its free spins. Money in Silver, the whole round's. `jackpot` is whole Silver, 0 for a round that did not win it. */
export type SlotSpinRow = {
  id: number;
  userId: number;
  character: string;
  spunAt: Date;
  machine: string;
  stops: SlotStops;
  free: SlotStops[];
  stake: number;
  payout: number;
  jackpot: number;
};

/**
 * Money in Silver; the repository multiplies by 1000 for the database. `payout` is the whole round's.
 * `multiple` is min(32767, floor(payout / stake)), worked out by the caller.
 * `add` is Bronze, 0 to leave the pot alone. `cap` is whole Gold: the cap set now, taken by a pot that has none.
 * `roll` is a whole number from 0 up to SLOT_JACKPOT_ROLLS.
 */
export type SlotBetInput = {
  userId: number;
  charId: number;
  machine: SlotMachineKey;
  stops: SlotStops;
  free: SlotStops[];
  stake: number;
  payout: number;
  multiple: number;
  add: number;
  cap: number;
  roll: number;
};

export type SlotBetOutcome =
  | { code: typeof BET_OK; id: number; wallet: Wallet; /** Whole Silver won from the pot. */ jackpot: number }
  | { code: Exclude<BetCode, typeof BET_OK>; name: string | null };

/** Money in Silver; `added` is whole Silver, rounded down. */
export type SlotTotalsRow = { spins: number; staked: number; paid: number; added: number };

/** Both Bronze; `cap` is null until a lost round first adds to this pot. */
export type SlotPotRow = { pot: number; cap: number | null };

/** `added` is Bronze, `paid` whole Silver. */
export type SlotJackpotTotalsRow = { added: number; paid: number; drops: number };

export interface SlotsRepository {
  /** Floor closed, machines open and starting stakes, jackpot on with its starting cap, where rows are missing or unreadable. */
  settings(): Promise<SlotSettings>;
  saveFloor(live: boolean, changedBy: string): Promise<void>;
  saveMachine(key: SlotMachineKey, settings: { live: boolean; stakes: SlotStakes }, changedBy: string): Promise<void>;
  saveJackpot(settings: { live: boolean; cap: number }, changedBy: string): Promise<void>;
  /**
   * Takes the stake and pays the payout in the character's wallet and records the spin, together, or refuses.
   * A round that adds to the pot also adds to it, and on a drop is paid the pot's whole Silver, in the same step.
   */
  bet(input: SlotBetInput): Promise<SlotBetOutcome>;
  /** Throws when the jackpot's table is not there. */
  pot(): Promise<SlotPotRow>;
  /** Newest first. */
  spinsOf(userId: number, limit: number): Promise<SlotSpinRow[]>;
  /** Spins that paid SLOT_BIG_WIN times the stake or more, or won the jackpot, newest first. */
  bigWins(limit: number): Promise<SlotSpinRow[]>;
  /** Spins that won the jackpot, newest first. */
  jackpotWins(limit: number): Promise<SlotSpinRow[]>;
  /** Anyone's spins, newest first. */
  latest(limit: number): Promise<SlotSpinRow[]>;
  /** Keyed by szMachine, so a machine the code no longer has still counts; today by the database's own date. */
  totals(): Promise<Record<string, { today: SlotTotalsRow; allTime: SlotTotalsRow }>>;
  jackpotTotals(): Promise<SlotJackpotTotalsRow>;
}

export const SLOTS_REPOSITORY = Symbol('SLOTS_REPOSITORY');
export const SLOTS_LIVE_KEY = 'slots_live';
export const SLOTS_JACKPOT_LIVE_KEY = 'slots_jackpot_live';
export const SLOTS_JACKPOT_CAP_KEY = 'slots_jackpot_cap';

const machineLiveKey = (key: SlotMachineKey) => `slots_${key}_live`;
const machineStakesKey = (key: SlotMachineKey) => `slots_${key}_stakes`;
const SILVER = 1000; // Bronze in one Silver

/** The cap a GM saved, when it is a whole number of Gold within the limits; otherwise the starting cap. */
function parseJackpotCap(text: string | undefined): number {
  if (text === undefined || !/^\d+$/.test(text)) return SLOT_JACKPOT_DEFAULT_CAP;
  const cap = Number(text);
  return cap >= SLOT_JACKPOT_MIN_CAP && cap <= SLOT_JACKPOT_MAX_CAP ? cap : SLOT_JACKPOT_DEFAULT_CAP;
}

/**
 * The jackpot's part of the bet batch, run after every check has passed. It locks the pot after the online list and
 * the character, so every spin takes the locks in the same order. The rule is slotJackpotDrops in whole numbers;
 * DECIMAL because a 10,000 Gold cap times the roll range is past what a BIGINT holds. Only assignments and statements
 * that return no rows, so the batch's own result stays its first.
 * A round that pays, adds more than its stake or brings a roll outside the range would make or win gold that no
 * real round can, and the pot would still be what was added less what was paid, so nothing else would show it.
 * It is refused before the pot is read; under XACT_ABORT the THROW rolls everything back. NULL is named on its own.
 */
const potStep = (jackpot: string) => `IF @add IS NULL OR @roll IS NULL OR @add > @stake OR @payout > 0 OR @roll < 0 OR @roll >= ${SLOT_JACKPOT_ROLLS}
    THROW 50000, 'A round cannot add that to the jackpot', 1;
  DECLARE @pot BIGINT, @cap BIGINT, @from BIGINT, @to BIGINT;
  SELECT @pot = llPot, @cap = ISNULL(llCap, @nextCap) FROM ${jackpot} WITH (UPDLOCK, ROWLOCK) WHERE bID = 1;
  IF @pot IS NULL THROW 50001, 'The jackpot row is missing', 1;
  SET @from = CASE WHEN @pot > @cap / 10 THEN @pot ELSE @cap / 10 END;
  SET @pot = @pot + @add;
  SET @to = CASE WHEN @pot > @cap / 10 THEN @pot ELSE @cap / 10 END;
  IF @from >= @cap OR CAST(@roll AS DECIMAL(38,0)) * (@cap - @from) < CAST(@to - @from AS DECIMAL(38,0)) * ${SLOT_JACKPOT_ROLLS}
  BEGIN
    -- The whole Silver is paid; the odd Bronze stays as the next pot, which takes the cap set when it next grows.
    SET @extra = (@pot / ${SILVER}) * ${SILVER};
    UPDATE ${jackpot} SET llPot = @pot % ${SILVER}, llCap = NULL WHERE bID = 1;
  END
  ELSE UPDATE ${jackpot} SET llPot = @pot, llCap = @cap WHERE bID = 1`;

/** The money is BIGINT, so strings from the driver. */
type RawSpin = Omit<SlotSpinRow, 'stops' | 'free' | 'stake' | 'payout' | 'jackpot'> &
  Record<'stake' | 'payout' | 'jackpot', string> & { stop1: number; stop2: number; stop3: number; stop4: number; stop5: number; free: string };
type RawTotals = { machine: string } & Record<'spins' | 'todaySpins', number> &
  Record<'staked' | 'paid' | 'added' | 'todayStaked' | 'todayPaid' | 'todayAdded', string>;

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
            stakes: (stakes === undefined ? null : parseSlotStakes(stakes)) ?? [...machine.stakes],
          },
        ];
      }),
    ) as SlotSettings['machines'];
    const jackpotLive = values.get(SLOTS_JACKPOT_LIVE_KEY);
    return {
      // Read the switch as the bet's SQL does, so a hand-edited row means the same on the pages as on a POST.
      live: settingIsOn(values.get(SLOTS_LIVE_KEY)),
      machines,
      // The jackpot is on until a GM turns it off.
      jackpot: { live: jackpotLive === undefined || settingIsOn(jackpotLive), cap: parseJackpotCap(values.get(SLOTS_JACKPOT_CAP_KEY)) },
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

  saveJackpot(settings: { live: boolean; cap: number }, changedBy: string): Promise<void> {
    return this.save(
      [
        [SLOTS_JACKPOT_LIVE_KEY, String(settings.live)],
        [SLOTS_JACKPOT_CAP_KEY, String(settings.cap)],
      ],
      changedBy,
    );
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
    const record = `INSERT INTO ${this.db.tables.slotSpins}
      (dwUserID, dwCharID, szCharName, szMachine, bStop1, bStop2, bStop3, bStop4, bStop5, bRules, szFree,
       llStake, llPayout, llWallet, wMultiple, llAdded, llJackpot)
      VALUES (@userId, @charId, @name, @machine, @stop1, @stop2, @stop3, @stop4, @stop5, @rules, @free,
       @stake, @payout, @wallet, @multiple, @add, @extra)`;
    const [stop1, stop2, stop3, stop4, stop5] = input.stops;
    // A round that adds nothing does not touch the pot's row at all, so it neither waits for its lock nor sets its cap.
    const feeds = input.add > 0;
    const request = this.request().input('add', sql.BigInt, feeds ? input.add : 0);
    if (feeds) request.input('nextCap', sql.BigInt, input.cap * BRONZE_PER_GOLD).input('roll', sql.BigInt, input.roll);
    const result = await request
      .input('userId', sql.Int, input.userId)
      .input('charId', sql.Int, input.charId)
      .input('stake', sql.BigInt, input.stake * SILVER)
      .input('payout', sql.BigInt, input.payout * SILVER)
      .input('machine', sql.VarChar(20), input.machine)
      .input('stop1', sql.TinyInt, stop1)
      .input('stop2', sql.TinyInt, stop2)
      .input('stop3', sql.TinyInt, stop3)
      .input('stop4', sql.TinyInt, stop4)
      .input('stop5', sql.TinyInt, stop5)
      .input('rules', sql.TinyInt, SLOT_RULES)
      .input('free', sql.VarChar(400), slotFreeText(input.free))
      .input('multiple', sql.SmallInt, input.multiple)
      .query<{ code: BetCode; id: number; name: string | null; extra: string } & Wallet>(
        walletBetSql(this.db.tables, SLOTS_LIVE_KEY, record, feeds ? potStep(this.db.tables.slotJackpot) : ''),
      );
    const { code, id, name, gold, silver, copper, extra } = result.recordset[0];
    // extra is always whole Silver: the step pays the pot rounded down to it.
    return code === BET_OK ? { code, id, wallet: { gold, silver, copper }, jackpot: Number(extra) / SILVER } : { code, name };
  }

  async pot(): Promise<SlotPotRow> {
    const result = await this.request().query<{ pot: string; cap: string | null }>(
      `SELECT llPot AS pot, llCap AS cap FROM ${this.db.tables.slotJackpot} WHERE bID = 1`,
    );
    const row = result.recordset[0];
    if (!row) throw new Error('The jackpot row is missing');
    return { pot: Number(row.pot), cap: row.cap === null ? null : Number(row.cap) };
  }

  private async spins(top: number, where: string, bind: (request: sql.Request) => sql.Request = (r) => r): Promise<SlotSpinRow[]> {
    const result = await bind(this.request())
      .input('top', sql.Int, top)
      .query<RawSpin>(
        `SELECT TOP (@top) dwID AS id, dwUserID AS userId, szCharName AS character, dSpun AS spunAt, szMachine AS machine,
                bStop1 AS stop1, bStop2 AS stop2, bStop3 AS stop3, bStop4 AS stop4, bStop5 AS stop5, szFree AS free,
                CAST(llStake / ${SILVER} AS BIGINT) AS stake, CAST(llPayout / ${SILVER} AS BIGINT) AS payout,
                CAST(llJackpot / ${SILVER} AS BIGINT) AS jackpot
         FROM ${this.db.tables.slotSpins}
         WHERE bRules = ${SLOT_RULES} AND (${where})
         ORDER BY dwID DESC`,
      );
    // A row whose free spins cannot be read is left out, like one whose stops are out of range.
    return result.recordset.flatMap(({ stop1, stop2, stop3, stop4, stop5, free, stake, payout, jackpot, ...row }): SlotSpinRow[] => {
      const spins = parseSlotFree(free);
      const money = { stake: Number(stake), payout: Number(payout), jackpot: Number(jackpot) };
      return spins ? [{ ...row, ...money, stops: [stop1, stop2, stop3, stop4, stop5], free: spins }] : [];
    });
  }

  spinsOf(userId: number, limit: number): Promise<SlotSpinRow[]> {
    return this.spins(limit, 'dwUserID = @userId', (r) => r.input('userId', sql.Int, userId));
  }

  bigWins(limit: number): Promise<SlotSpinRow[]> {
    return this.spins(limit, 'wMultiple >= @bigWin OR llJackpot > 0', (r) => r.input('bigWin', sql.SmallInt, SLOT_BIG_WIN));
  }

  jackpotWins(limit: number): Promise<SlotSpinRow[]> {
    return this.spins(limit, 'llJackpot > 0');
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

  async jackpotTotals(): Promise<SlotJackpotTotalsRow> {
    const result = await this.request().query<{ added: string; paid: string; drops: number }>(
      `SELECT ISNULL(SUM(llAdded), 0) AS added, ISNULL(SUM(llJackpot), 0) / ${SILVER} AS paid,
              COUNT(CASE WHEN llJackpot > 0 THEN 1 END) AS drops
       FROM ${this.db.tables.slotSpins}`,
    );
    const { added, paid, drops } = result.recordset[0];
    return { added: Number(added), paid: Number(paid), drops };
  }
}
