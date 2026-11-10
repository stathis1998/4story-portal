import { describe, expect, it } from 'vitest';
import type { UpgradeAttemptRow } from '../src/stats/stats-rules.js';
import { firstUpgradeDay, lastDays, upgradeKindStats } from '../src/stats/upgrade-stats.js';

const TODAY = '2026-11-10';
const SCROLL = 1;
const GEM = 2;

const row = (overrides: Partial<UpgradeAttemptRow>): UpgradeAttemptRow => ({
  charId: 1,
  kind: SCROLL,
  level: 0,
  result: 1,
  day: TODAY,
  attempts: 1,
  chanceTotal: 100,
  ...overrides,
});

const everyone = () => true;
const nobody = () => false;

describe('upgrade stats', () => {
  it('splits failures into saved, lost levels and destroyed', () => {
    const stats = upgradeKindStats(
      [row({ result: 1, attempts: 5 }), row({ result: 2, attempts: 1 }), row({ result: 3, attempts: 2 }), row({ result: 4, attempts: 3 })],
      SCROLL,
      everyone,
      nobody,
      TODAY,
    );
    expect(stats.totals).toEqual({ success: 5, destroyed: 1, lostLevels: 2, saved: 3 });
  });

  it('works out the odds per level and in total from the chances rolled against', () => {
    const stats = upgradeKindStats(
      [
        row({ level: 11, result: 1, attempts: 1, chanceTotal: 35 }),
        row({ level: 11, result: 2, attempts: 3, chanceTotal: 105 }),
        row({ level: 0, result: 1, attempts: 2, chanceTotal: 200 }),
      ],
      SCROLL,
      everyone,
      nobody,
      TODAY,
    );
    expect(stats.levels).toEqual([
      { level: 0, success: 2, saved: 0, lostLevels: 0, destroyed: 0, expectedRate: 1 },
      { level: 11, success: 1, saved: 0, lostLevels: 0, destroyed: 3, expectedRate: 0.35 },
    ]);
    expect(stats.expectedSuccesses).toBeCloseTo(3.4);
  });

  it('keeps scrolls and gemstones apart', () => {
    const rows = [row({ kind: SCROLL, attempts: 4 }), row({ kind: GEM, attempts: 7, result: 4 })];
    expect(upgradeKindStats(rows, GEM, everyone, nobody, TODAY).totals).toEqual({ success: 0, saved: 7, lostLevels: 0, destroyed: 0 });
    expect(upgradeKindStats(rows, SCROLL, everyone, nobody, TODAY).totals.success).toBe(4);
  });

  it('counts only the characters it is told to server-wide, and the viewer always', () => {
    const rows = [row({ charId: 1, attempts: 2 }), row({ charId: 2, attempts: 5, result: 2, chanceTotal: 250 })];
    const stats = upgradeKindStats(rows, SCROLL, (id) => id === 1, (id) => id === 2, TODAY);
    expect(stats.totals).toEqual({ success: 2, saved: 0, lostLevels: 0, destroyed: 0 });
    expect(stats.you).toEqual({ success: 0, saved: 0, lostLevels: 0, destroyed: 5, expectedSuccesses: 2.5 });
  });

  it('lists the last 30 days with zeros, leaving out older days', () => {
    const stats = upgradeKindStats(
      [row({ day: '2026-11-09', attempts: 3 }), row({ day: '2026-11-09', result: 3, attempts: 2 }), row({ day: '2026-10-01', attempts: 9 })],
      SCROLL,
      everyone,
      nobody,
      TODAY,
    );
    expect(stats.days).toHaveLength(30);
    expect(stats.days[0].date).toBe('2026-10-12');
    expect(stats.days.at(-1)).toEqual({ date: TODAY, success: 0, failed: 0 });
    expect(stats.days.at(-2)).toEqual({ date: '2026-11-09', success: 3, failed: 2 });
    // Older days still count in the totals.
    expect(stats.totals.success).toBe(12);
  });

  it('ignores a result code it does not know', () => {
    const stats = upgradeKindStats([row({ result: 9, attempts: 4 })], SCROLL, everyone, everyone, TODAY);
    expect(stats.totals).toEqual({ success: 0, saved: 0, lostLevels: 0, destroyed: 0 });
    expect(stats.levels).toEqual([]);
    expect(stats.you.expectedSuccesses).toBe(0);
  });

  it('has nothing to show before anyone tries', () => {
    const stats = upgradeKindStats([], SCROLL, everyone, everyone, TODAY);
    expect(stats.levels).toEqual([]);
    expect(stats.expectedSuccesses).toBe(0);
    expect(firstUpgradeDay([], everyone)).toBeNull();
  });

  it('finds the first day among counted characters only', () => {
    const rows = [row({ charId: 1, day: '2026-11-10' }), row({ charId: 2, day: '2026-11-08' })];
    expect(firstUpgradeDay(rows, everyone)).toBe('2026-11-08');
    expect(firstUpgradeDay(rows, (id) => id === 1)).toBe('2026-11-10');
  });

  it('crosses a month end when counting back 30 days', () => {
    const days = lastDays('2026-03-01');
    expect(days[0]).toBe('2026-01-31');
    expect(days.at(-1)).toBe('2026-03-01');
  });
});
