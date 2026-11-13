import sql from 'mssql';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { DbService } from '../../src/db/db.service.js';
import type { LotteryStreakRow } from '../../src/stats/stats-rules.js';
import { SqlStatsRepository } from '../../src/stats/stats.repository.js';
import { connectTestDb, inRolledBackTransaction } from './db-test-helpers.js';

let db: DbService;
let a: number;
let b: number;
let c: number;

beforeAll(async () => {
  db = await connectTestDb();
  const result = await db.pool
    .request()
    .query<{ id: number }>(`SELECT TOP 3 dwCharID AS id FROM ${db.tables.characters} WHERE bDelete = 0 ORDER BY dwCharID`);
  [a, b, c] = result.recordset.map((row) => row.id);
});
afterAll(() => db.onModuleDestroy());

type Draw = [charId: number, result: 'W' | 'L'];
const each = (charId: number, results: string): Draw[] => [...results].map((result) => [charId, result as 'W' | 'L']);

// Writes the draws through the game's own procedure, in this order, then reads the streaks back.
// Everything happens in a rolled-back transaction.
async function streaksAfter(draws: Draw[], deleted: number[] = []): Promise<Map<number, LotteryStreakRow>> {
  const procedure = db.tables.soulLotteryLog.replace('TSOULLOTTERYLOGTABLE', 'TLogSoulLottery');
  let found = new Map<number, LotteryStreakRow>();
  await inRolledBackTransaction(db, async (tx) => {
    for (const id of deleted) {
      await new sql.Request(tx).input('id', sql.Int, id).query(`UPDATE ${db.tables.characters} SET bDelete = 1 WHERE dwCharID = @id`);
    }
    for (const [charId, result] of draws) {
      await new sql.Request(tx)
        .input('charId', sql.Int, charId)
        .input('won', sql.TinyInt, result === 'W' ? 1 : 0)
        .query(`EXEC ${procedure} @charId, 50, @won, 7, 1000`);
    }
    const repo = new SqlStatsRepository({ pool: tx, tables: db.tables } as unknown as DbService);
    const rows = await (repo as unknown as { lotteryStreaks(): Promise<LotteryStreakRow[]> }).lotteryStreaks();
    found = new Map(rows.map((row) => [row.charId, row]));
  });
  return found;
}

it('finds the longest run of losses and the run since the last win', async () => {
  const streaks = await streaksAfter([...each(a, 'LLWLLLWL'), ...each(b, 'LL'), ...each(c, 'W')]);

  expect(streaks.get(a)).toEqual({ charId: a, longestLoseStreak: 3, currentLoseStreak: 1 });
  expect(streaks.get(b)).toEqual({ charId: b, longestLoseStreak: 2, currentLoseStreak: 2 });
  expect(streaks.has(c)).toBe(false);
});

it('reports 0 as the current run right after a win', async () => {
  expect((await streaksAfter(each(a, 'LLLLW'))).get(a)).toEqual({ charId: a, longestLoseStreak: 4, currentLoseStreak: 0 });
});

it('keeps characters apart when their draws interleave', async () => {
  const streaks = await streaksAfter([
    [a, 'L'],
    [b, 'W'],
    [a, 'L'],
    [b, 'L'],
    [a, 'L'],
    [b, 'L'],
  ]);

  expect(streaks.get(a)).toEqual({ charId: a, longestLoseStreak: 3, currentLoseStreak: 3 });
  expect(streaks.get(b)).toEqual({ charId: b, longestLoseStreak: 2, currentLoseStreak: 2 });
});

it('leaves out deleted characters', async () => {
  expect((await streaksAfter(each(a, 'LLL'), [a])).has(a)).toBe(false);
});
