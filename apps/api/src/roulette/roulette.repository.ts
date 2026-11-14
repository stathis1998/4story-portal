import { ROULETTE_DEFAULT_LIMITS, ROULETTE_MAX_LIMIT, type RouletteLimits, type Wallet } from '@4story-portal/shared';
import { Injectable } from '@nestjs/common';
import sql from 'mssql';
import { DbService } from '../db/db.service.js';
import { BET_OK, type BetCode, walletBetSql, walletCharactersSql } from '../games/wallet-bet.js';

export type RouletteSettings = RouletteLimits & { live: boolean };

export type WalletCharacterRow = {
  charId: number;
  name: string;
  level: number;
  classCode: number;
  gold: number;
  silver: number;
  copper: number;
  online: boolean;
};

/** Money in Silver. */
export type RouletteSpinRow = { id: number; userId: number; character: string; spunAt: Date; pocket: number; stake: number; payout: number };

/** Money in Silver; the repository multiplies by 1000 for the database. */
export type BetInput = { userId: number; charId: number; pocket: number; stake: number; payout: number; bets: string; numberHit: boolean };

export type BetOutcome = { code: typeof BET_OK; id: number; wallet: Wallet } | { code: Exclude<BetCode, typeof BET_OK>; name: string | null };

export type RouletteTotalsRow = { spins: number; staked: number; paid: number };

export interface RouletteRepository {
  /** Closed with the starting limits when rows are missing or unreadable. */
  settings(): Promise<RouletteSettings>;
  saveSettings(settings: RouletteSettings, changedBy: string): Promise<void>;
  characters(userId: number): Promise<WalletCharacterRow[]>;
  /** Takes the stake and pays the payout in the character's wallet and records the spin, together, or refuses. */
  bet(input: BetInput): Promise<BetOutcome>;
  /** Newest first. */
  spinsOf(userId: number, limit: number): Promise<RouletteSpinRow[]>;
  /** Spins where a number bet won, newest first. */
  bigWins(limit: number): Promise<RouletteSpinRow[]>;
  /** Anyone's spins, newest first. */
  latest(limit: number): Promise<RouletteSpinRow[]>;
  /** Today by the database's own date. */
  totals(): Promise<{ today: RouletteTotalsRow; allTime: RouletteTotalsRow }>;
}

export const ROULETTE_REPOSITORY = Symbol('ROULETTE_REPOSITORY');
export const ROULETTE_LIVE_KEY = 'roulette_live';

const LIMIT_KEYS = { minBet: 'roulette_min_bet', maxNumber: 'roulette_max_number', maxOutside: 'roulette_max_outside' } as const;
const SILVER = 1000; // Bronze in one Silver

/** A whole number of Silver the table can use, or undefined. */
function readLimit(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  const limit = Number(value);
  return limit >= 1 && limit <= ROULETTE_MAX_LIMIT ? limit : undefined;
}

type RawTotals = Record<'spins' | 'todaySpins', number> & Record<'staked' | 'paid' | 'todayStaked' | 'todayPaid', string>;

@Injectable()
export class SqlRouletteRepository implements RouletteRepository {
  private tx?: sql.Transaction;

  constructor(private readonly db: DbService) {}

  /** Returns a copy whose queries run on tx (used by tests to roll back). */
  withTransaction(tx: sql.Transaction): SqlRouletteRepository {
    const copy = new SqlRouletteRepository(this.db);
    copy.tx = tx;
    return copy;
  }

  private request(): sql.Request {
    return this.tx ? new sql.Request(this.tx) : this.db.pool.request();
  }

  async settings(): Promise<RouletteSettings> {
    const result = await this.request()
      .input('live', sql.VarChar(40), ROULETTE_LIVE_KEY)
      .input('minBet', sql.VarChar(40), LIMIT_KEYS.minBet)
      .input('maxNumber', sql.VarChar(40), LIMIT_KEYS.maxNumber)
      .input('maxOutside', sql.VarChar(40), LIMIT_KEYS.maxOutside)
      .query<{ key: string; value: string }>(
        `SELECT szKey AS [key], szValue AS value FROM ${this.db.tables.portalSettings}
         WHERE szKey IN (@live, @minBet, @maxNumber, @maxOutside)`,
      );
    const values = new Map(result.recordset.map((row) => [row.key, row.value]));
    const limits: RouletteLimits = {
      minBet: readLimit(values.get(LIMIT_KEYS.minBet)) ?? ROULETTE_DEFAULT_LIMITS.minBet,
      maxNumber: readLimit(values.get(LIMIT_KEYS.maxNumber)) ?? ROULETTE_DEFAULT_LIMITS.maxNumber,
      maxOutside: readLimit(values.get(LIMIT_KEYS.maxOutside)) ?? ROULETTE_DEFAULT_LIMITS.maxOutside,
    };
    // Limits that cannot all hold at once are not a table anyone can play; start over from the defaults.
    const usable = limits.minBet <= limits.maxNumber && limits.minBet <= limits.maxOutside;
    // Read the switch as the bet's SQL does (case-insensitive collation, trailing spaces ignored), so a
    // hand-edited row means the same on the pages as on a POST.
    const live = values.get(ROULETTE_LIVE_KEY)?.trimEnd().toLowerCase() === 'true';
    return { live, ...(usable ? limits : ROULETTE_DEFAULT_LIMITS) };
  }

  async saveSettings(settings: RouletteSettings, changedBy: string): Promise<void> {
    // One MERGE, so the switch and the three limits change together.
    await this.request()
      .input('liveKey', sql.VarChar(40), ROULETTE_LIVE_KEY)
      .input('liveValue', sql.VarChar(200), String(settings.live))
      .input('minBetKey', sql.VarChar(40), LIMIT_KEYS.minBet)
      .input('minBetValue', sql.VarChar(200), String(settings.minBet))
      .input('maxNumberKey', sql.VarChar(40), LIMIT_KEYS.maxNumber)
      .input('maxNumberValue', sql.VarChar(200), String(settings.maxNumber))
      .input('maxOutsideKey', sql.VarChar(40), LIMIT_KEYS.maxOutside)
      .input('maxOutsideValue', sql.VarChar(200), String(settings.maxOutside))
      .input('by', sql.VarChar(50), changedBy)
      .query(
        `MERGE ${this.db.tables.portalSettings} WITH (HOLDLOCK) AS target
         USING (VALUES (@liveKey, @liveValue), (@minBetKey, @minBetValue), (@maxNumberKey, @maxNumberValue), (@maxOutsideKey, @maxOutsideValue))
           AS source (szKey, szValue) ON target.szKey = source.szKey
         WHEN MATCHED THEN UPDATE SET szValue = source.szValue, szUpdatedBy = @by, dUpdated = GETDATE()
         WHEN NOT MATCHED THEN INSERT (szKey, szValue, szUpdatedBy) VALUES (source.szKey, source.szValue, @by);`,
      );
  }

  async characters(userId: number): Promise<WalletCharacterRow[]> {
    const result = await this.request().input('userId', sql.Int, userId).query<WalletCharacterRow>(walletCharactersSql(this.db.tables));
    return result.recordset;
  }

  async bet(input: BetInput): Promise<BetOutcome> {
    const record = `INSERT INTO ${this.db.tables.rouletteSpins}
      (dwUserID, dwCharID, szCharName, bPocket, llStake, llPayout, llWallet, szBets, bNumberHit)
      VALUES (@userId, @charId, @name, @pocket, @stake, @payout, @wallet, @bets, @numberHit)`;
    const result = await this.request()
      .input('userId', sql.Int, input.userId)
      .input('charId', sql.Int, input.charId)
      .input('stake', sql.BigInt, input.stake * SILVER)
      .input('payout', sql.BigInt, input.payout * SILVER)
      .input('pocket', sql.TinyInt, input.pocket)
      .input('bets', sql.VarChar(1000), input.bets)
      .input('numberHit', sql.TinyInt, input.numberHit ? 1 : 0)
      .query<{ code: BetCode; id: number; name: string | null } & Wallet>(walletBetSql(this.db.tables, ROULETTE_LIVE_KEY, record));
    const { code, id, name, gold, silver, copper } = result.recordset[0];
    return code === BET_OK ? { code, id, wallet: { gold, silver, copper } } : { code, name };
  }

  private async spins(top: number, where: string, bind: (request: sql.Request) => sql.Request = (r) => r): Promise<RouletteSpinRow[]> {
    const result = await bind(this.request())
      .input('top', sql.Int, top)
      .query<RouletteSpinRow>(
        `SELECT TOP (@top) dwID AS id, dwUserID AS userId, szCharName AS character, dSpun AS spunAt, bPocket AS pocket,
                CAST(llStake / ${SILVER} AS INT) AS stake, CAST(llPayout / ${SILVER} AS INT) AS payout
         FROM ${this.db.tables.rouletteSpins}
         WHERE ${where}
         ORDER BY dwID DESC`,
      );
    return result.recordset;
  }

  spinsOf(userId: number, limit: number): Promise<RouletteSpinRow[]> {
    return this.spins(limit, 'dwUserID = @userId', (r) => r.input('userId', sql.Int, userId));
  }

  bigWins(limit: number): Promise<RouletteSpinRow[]> {
    return this.spins(limit, 'bNumberHit = 1');
  }

  latest(limit: number): Promise<RouletteSpinRow[]> {
    return this.spins(limit, '1 = 1');
  }

  async totals(): Promise<{ today: RouletteTotalsRow; allTime: RouletteTotalsRow }> {
    // Sums of BIGINT come back from the driver as strings.
    const result = await this.request().query<RawTotals>(
      `DECLARE @today DATETIME = CAST(CAST(GETDATE() AS DATE) AS DATETIME);
       SELECT COUNT(*) AS spins, ISNULL(SUM(llStake), 0) / ${SILVER} AS staked, ISNULL(SUM(llPayout), 0) / ${SILVER} AS paid,
              COUNT(CASE WHEN dSpun >= @today THEN 1 END) AS todaySpins,
              ISNULL(SUM(CASE WHEN dSpun >= @today THEN llStake END), 0) / ${SILVER} AS todayStaked,
              ISNULL(SUM(CASE WHEN dSpun >= @today THEN llPayout END), 0) / ${SILVER} AS todayPaid
       FROM ${this.db.tables.rouletteSpins}`,
    );
    const row = result.recordset[0];
    return {
      today: { spins: row.todaySpins, staked: Number(row.todayStaked), paid: Number(row.todayPaid) },
      allTime: { spins: row.spins, staked: Number(row.staked), paid: Number(row.paid) },
    };
  }
}
