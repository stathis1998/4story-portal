import {
  parseSlotStakes,
  SLOT_BIG_WIN,
  SLOT_MACHINES,
  type SlotMachineKey,
  type SlotStakes,
  type SlotStops,
  type Wallet,
} from '@4story-portal/shared';
import { Injectable } from '@nestjs/common';
import sql from 'mssql';
import { DbService } from '../db/db.service.js';
import { BET_OK, type BetCode, type BetOutcome, settingIsOn, walletBetSql } from '../games/wallet-bet.js';

export type SlotSettings = { live: boolean; machines: Record<SlotMachineKey, { live: boolean; stakes: SlotStakes }> };

/** Money in Silver. */
export type SlotSpinRow = { id: number; userId: number; character: string; spunAt: Date; machine: string; stops: SlotStops; stake: number; payout: number };

/** Money in Silver; the repository multiplies by 1000 for the database. */
export type SlotBetInput = { userId: number; charId: number; machine: SlotMachineKey; stops: SlotStops; stake: number; payout: number; multiple: number };

export type SlotTotalsRow = { spins: number; staked: number; paid: number };

export interface SlotsRepository {
  /** Floor closed, machines open and starting stakes where rows are missing or unreadable. */
  settings(): Promise<SlotSettings>;
  saveFloor(live: boolean, changedBy: string): Promise<void>;
  saveMachine(key: SlotMachineKey, settings: { live: boolean; stakes: SlotStakes }, changedBy: string): Promise<void>;
  /** Takes the stake and pays the payout in the character's wallet and records the spin, together, or refuses. */
  bet(input: SlotBetInput): Promise<BetOutcome>;
  /** Newest first. */
  spinsOf(userId: number, limit: number): Promise<SlotSpinRow[]>;
  /** Spins that paid SLOT_BIG_WIN times the stake or more, newest first. */
  bigWins(limit: number): Promise<SlotSpinRow[]>;
  /** Anyone's spins, newest first. */
  latest(limit: number): Promise<SlotSpinRow[]>;
  /** Keyed by szMachine, so a machine the code no longer has still counts; today by the database's own date. */
  totals(): Promise<Record<string, { today: SlotTotalsRow; allTime: SlotTotalsRow }>>;
}

export const SLOTS_REPOSITORY = Symbol('SLOTS_REPOSITORY');
export const SLOTS_LIVE_KEY = 'slots_live';

const machineLiveKey = (key: SlotMachineKey) => `slots_${key}_live`;
const machineStakesKey = (key: SlotMachineKey) => `slots_${key}_stakes`;
const SILVER = 1000; // Bronze in one Silver

type RawSpin = Omit<SlotSpinRow, 'stops'> & { stop1: number; stop2: number; stop3: number };
type RawTotals = { machine: string } & Record<'spins' | 'todaySpins', number> & Record<'staked' | 'paid' | 'todayStaked' | 'todayPaid', string>;

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
    // Read the switch as the bet's SQL does, so a hand-edited row means the same on the pages as on a POST.
    return { live: settingIsOn(values.get(SLOTS_LIVE_KEY)), machines };
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

  async bet(input: SlotBetInput): Promise<BetOutcome> {
    const record = `INSERT INTO ${this.db.tables.slotSpins}
      (dwUserID, dwCharID, szCharName, szMachine, bStop1, bStop2, bStop3, llStake, llPayout, llWallet, wMultiple)
      VALUES (@userId, @charId, @name, @machine, @stop1, @stop2, @stop3, @stake, @payout, @wallet, @multiple)`;
    const [stop1, stop2, stop3] = input.stops;
    const result = await this.request()
      .input('userId', sql.Int, input.userId)
      .input('charId', sql.Int, input.charId)
      .input('stake', sql.BigInt, input.stake * SILVER)
      .input('payout', sql.BigInt, input.payout * SILVER)
      .input('machine', sql.VarChar(20), input.machine)
      .input('stop1', sql.TinyInt, stop1)
      .input('stop2', sql.TinyInt, stop2)
      .input('stop3', sql.TinyInt, stop3)
      .input('multiple', sql.SmallInt, input.multiple)
      .query<{ code: BetCode; id: number; name: string | null } & Wallet>(walletBetSql(this.db.tables, SLOTS_LIVE_KEY, record));
    const { code, id, name, gold, silver, copper } = result.recordset[0];
    return code === BET_OK ? { code, id, wallet: { gold, silver, copper } } : { code, name };
  }

  private async spins(top: number, where: string, bind: (request: sql.Request) => sql.Request = (r) => r): Promise<SlotSpinRow[]> {
    const result = await bind(this.request())
      .input('top', sql.Int, top)
      .query<RawSpin>(
        `SELECT TOP (@top) dwID AS id, dwUserID AS userId, szCharName AS character, dSpun AS spunAt, szMachine AS machine,
                bStop1 AS stop1, bStop2 AS stop2, bStop3 AS stop3,
                CAST(llStake / ${SILVER} AS INT) AS stake, CAST(llPayout / ${SILVER} AS INT) AS payout
         FROM ${this.db.tables.slotSpins}
         WHERE ${where}
         ORDER BY dwID DESC`,
      );
    return result.recordset.map(({ stop1, stop2, stop3, ...row }): SlotSpinRow => ({ ...row, stops: [stop1, stop2, stop3] }));
  }

  spinsOf(userId: number, limit: number): Promise<SlotSpinRow[]> {
    return this.spins(limit, 'dwUserID = @userId', (r) => r.input('userId', sql.Int, userId));
  }

  bigWins(limit: number): Promise<SlotSpinRow[]> {
    return this.spins(limit, 'wMultiple >= @bigWin', (r) => r.input('bigWin', sql.SmallInt, SLOT_BIG_WIN));
  }

  latest(limit: number): Promise<SlotSpinRow[]> {
    return this.spins(limit, '1 = 1');
  }

  async totals(): Promise<Record<string, { today: SlotTotalsRow; allTime: SlotTotalsRow }>> {
    // Sums of BIGINT come back from the driver as strings.
    const result = await this.request().query<RawTotals>(
      `DECLARE @today DATETIME = CAST(CAST(GETDATE() AS DATE) AS DATETIME);
       SELECT szMachine AS machine,
              COUNT(*) AS spins, SUM(llStake) / ${SILVER} AS staked, SUM(llPayout) / ${SILVER} AS paid,
              COUNT(CASE WHEN dSpun >= @today THEN 1 END) AS todaySpins,
              ISNULL(SUM(CASE WHEN dSpun >= @today THEN llStake END), 0) / ${SILVER} AS todayStaked,
              ISNULL(SUM(CASE WHEN dSpun >= @today THEN llPayout END), 0) / ${SILVER} AS todayPaid
       FROM ${this.db.tables.slotSpins}
       GROUP BY szMachine`,
    );
    return Object.fromEntries(
      result.recordset.map((row) => [
        row.machine,
        {
          today: { spins: row.todaySpins, staked: Number(row.todayStaked), paid: Number(row.todayPaid) },
          allTime: { spins: row.spins, staked: Number(row.staked), paid: Number(row.paid) },
        },
      ]),
    );
  }
}
