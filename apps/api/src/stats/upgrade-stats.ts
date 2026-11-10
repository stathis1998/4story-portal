// Shapes the upgrade log for the Upgrade Stats page. No database or clock in here: rows and `today`
// are passed in, and the caller decides which characters count.

import type { UpgradeDay, UpgradeKindStats, UpgradeOutcomes } from '@4story-portal/shared';
import {
  UPGRADE_DESTROYED,
  UPGRADE_LOST_LEVELS,
  UPGRADE_SAVED,
  UPGRADE_SUCCESS,
  type UpgradeAttemptRow,
} from './stats-rules.js';

const DAYS_SHOWN = 30;
const DAY_MS = 86_400_000;

const noOutcomes = (): UpgradeOutcomes => ({ success: 0, saved: 0, lostLevels: 0, destroyed: 0 });

const OUTCOME_BY_RESULT: Record<number, keyof UpgradeOutcomes> = {
  [UPGRADE_SUCCESS]: 'success',
  [UPGRADE_SAVED]: 'saved',
  [UPGRADE_LOST_LEVELS]: 'lostLevels',
  [UPGRADE_DESTROYED]: 'destroyed',
};

/** Adds a group of rows into running totals. Rows with an unknown result are left out. */
function tally(outcomes: UpgradeOutcomes, row: UpgradeAttemptRow): boolean {
  const outcome = OUTCOME_BY_RESULT[row.result];
  if (!outcome) return false;
  outcomes[outcome] += row.attempts;
  return true;
}

/** The last 30 days ending on `today`, oldest first. */
export function lastDays(today: string): string[] {
  const end = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: DAYS_SHOWN }, (_, i) => new Date(end - (DAYS_SHOWN - 1 - i) * DAY_MS).toISOString().slice(0, 10));
}

/**
 * One kind of attempt (scrolls or gemstones). `counts` picks the characters in the server-wide
 * numbers, `mine` the viewer's own, and the two can overlap or not.
 */
export function upgradeKindStats(
  rows: UpgradeAttemptRow[],
  kind: number,
  counts: (charId: number) => boolean,
  mine: (charId: number) => boolean,
  today: string,
): UpgradeKindStats {
  const totals = noOutcomes();
  const you = { ...noOutcomes(), expectedSuccesses: 0 };
  let chanceTotal = 0;
  const levels = new Map<number, { outcomes: UpgradeOutcomes; attempts: number; chanceTotal: number }>();
  const days = new Map(lastDays(today).map((date) => [date, { date, success: 0, failed: 0 } satisfies UpgradeDay]));

  for (const row of rows) {
    if (row.kind !== kind) continue;
    if (mine(row.charId) && tally(you, row)) you.expectedSuccesses += row.chanceTotal / 100;
    if (!counts(row.charId) || !tally(totals, row)) continue;
    chanceTotal += row.chanceTotal;

    const level = levels.get(row.level) ?? { outcomes: noOutcomes(), attempts: 0, chanceTotal: 0 };
    tally(level.outcomes, row);
    level.attempts += row.attempts;
    level.chanceTotal += row.chanceTotal;
    levels.set(row.level, level);

    const day = days.get(row.day);
    if (day) {
      if (row.result === UPGRADE_SUCCESS) day.success += row.attempts;
      else day.failed += row.attempts;
    }
  }

  return {
    totals,
    expectedSuccesses: chanceTotal / 100,
    levels: [...levels.entries()]
      .sort(([a], [b]) => a - b)
      .map(([level, { outcomes, attempts, chanceTotal: chances }]) => ({
        level,
        ...outcomes,
        expectedRate: chances / 100 / attempts,
      })),
    days: [...days.values()],
    you,
  };
}

/** The earliest day any counted character tried, or null. */
export function firstUpgradeDay(rows: UpgradeAttemptRow[], counts: (charId: number) => boolean): string | null {
  return rows.filter((row) => counts(row.charId)).reduce<string | null>((first, row) => (!first || row.day < first ? row.day : first), null);
}
