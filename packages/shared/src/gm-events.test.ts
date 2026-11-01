import { describe, expect, it } from 'vitest';
import {
  EVENT_TYPE_NAMES,
  eventMinutes,
  gmEventIndexSchema,
  gmEventInputSchema,
  type GmEventInput,
  isDropEvent,
  isPercentEvent,
  PERCENT_EVENT_TYPES,
} from './gm-events.js';

const valid: GmEventInput = {
  type: 1,
  world: 1,
  title: 'Weekend EXP',
  bonus: 100,
  mapId: null,
  schedule: { mode: 'period', start: '2026-11-06T18:00', end: '2026-11-08T23:00' },
  startMessage: 'EXP +100% event has started!',
  endMessage: 'EXP +100% event ends in 1 minute.',
  startNoticeMinutes: 0,
  endNoticeMinutes: 1,
};

const parse = (overrides: Record<string, unknown>) => gmEventInputSchema.safeParse({ ...valid, ...overrides });

const errorPaths = (overrides: Record<string, unknown>) => {
  const result = parse(overrides);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
};

const schedule = (mode: 'period' | 'daily', start: string, end: string) => ({ schedule: { mode, start, end } });

describe('event types', () => {
  it('names all 15 and marks the 10 percentage types', () => {
    expect(Object.keys(EVENT_TYPE_NAMES)).toHaveLength(15);
    expect(PERCENT_EVENT_TYPES).toEqual([1, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(isPercentEvent(11)).toBe(true);
    expect(isPercentEvent(12)).toBe(false);
  });

  it('marks the three drop types', () => {
    expect([1, 3, 4, 5, 11, 12].filter(isDropEvent)).toEqual([3, 4, 11]);
  });
});

describe('gmEventInputSchema', () => {
  it('accepts a valid event', () => {
    expect(parse({}).success).toBe(true);
  });

  it('trims text', () => {
    const result = parse({ title: '  Weekend  ' });
    expect(result.success && result.data.title).toBe('Weekend');
  });

  it('limits the title to the 50 characters the server can hold', () => {
    expect(parse({ title: 'a'.repeat(50) }).success).toBe(true);
    expect(errorPaths({ title: 'a'.repeat(51) })).toEqual(['title']);
    expect(errorPaths({ title: '   ' })).toEqual(['title']);
  });

  it('refuses text the protocol cannot carry', () => {
    expect(errorPaths({ title: 'Διπλό EXP' })).toEqual(['title']);
    expect(errorPaths({ startMessage: 'Double EXP 🎉' })).toEqual(['startMessage']);
    expect(errorPaths({ endMessage: 'Line one\nLine two' })).toEqual(['endMessage']);
  });

  it('accepts accented Latin-1 text', () => {
    expect(parse({ title: 'Événement' }).success).toBe(true);
  });

  it('requires messages of 1 to 200 characters', () => {
    expect(errorPaths({ startMessage: '  ' })).toEqual(['startMessage']);
    expect(errorPaths({ endMessage: '' })).toEqual(['endMessage']);
    expect(parse({ endMessage: 'a'.repeat(200) }).success).toBe(true);
    expect(errorPaths({ startMessage: 'a'.repeat(201) })).toEqual(['startMessage']);
  });

  it.each([0, 1001, 1.5, -5])('refuses bonus %s', (bonus) => {
    expect(errorPaths({ bonus })).toEqual(['bonus']);
  });

  it('accepts bonus 1 and 1000', () => {
    expect(parse({ bonus: 1 }).success).toBe(true);
    expect(parse({ bonus: 1000 }).success).toBe(true);
  });

  it.each([2, 12, 13, 14, 15, 0, 16])('refuses type %s', (type) => {
    expect(errorPaths({ type })).toEqual(['type']);
  });

  it('asks for a world, because 0 means all worlds', () => {
    const result = parse({ world: 0 });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe('Choose a world');
  });

  it('only lets drop types name a map', () => {
    expect(errorPaths({ type: 1, mapId: 5 })).toEqual(['mapId']);
    expect(parse({ type: 3, mapId: null }).success).toBe(true);
    expect(parse({ type: 3, mapId: 0 }).success).toBe(true);
    expect(parse({ type: 11, mapId: 600 }).success).toBe(true);
  });

  it('refuses map 255, which means all maps, and maps too big for the database', () => {
    expect(errorPaths({ type: 3, mapId: 255 })).toEqual(['mapId']);
    expect(errorPaths({ type: 3, mapId: 32768 })).toEqual(['mapId']);
    expect(errorPaths({ type: 3, mapId: -1 })).toEqual(['mapId']);
  });

  it.each(['2026-02-31T10:00', '2026-11-06 10:00', '2026-11-06T24:00', '2026-11-06T10:60', '2026-11-06'])(
    'refuses the date %s',
    (start) => {
      expect(errorPaths(schedule('period', start, '2026-12-01T10:00'))).toEqual(['schedule.start']);
    },
  );

  it('requires the end after the start', () => {
    expect(errorPaths(schedule('period', '2026-11-06T18:00', '2026-11-06T18:00'))).toEqual(['schedule.end']);
    expect(errorPaths(schedule('period', '2026-11-06T18:00', '2026-11-05T18:00'))).toEqual(['schedule.end']);
  });

  it('refuses a daily window crossing midnight, because the server would never start it', () => {
    expect(errorPaths(schedule('daily', '2026-11-01T22:00', '2026-11-07T02:00'))).toEqual(['schedule.end']);
    expect(errorPaths(schedule('daily', '2026-11-01T20:00', '2026-11-07T20:00'))).toEqual(['schedule.end']);
  });

  it('accepts a daily window on one day and across several', () => {
    expect(parse(schedule('daily', '2026-11-01T20:00', '2026-11-07T22:00')).success).toBe(true);
    expect(parse(schedule('daily', '2026-11-01T20:00', '2026-11-01T22:00')).success).toBe(true);
  });

  it('limits the notice minutes', () => {
    expect(errorPaths({ endNoticeMinutes: 0 })).toEqual(['endNoticeMinutes']);
    expect(errorPaths({ endNoticeMinutes: 1441 })).toEqual(['endNoticeMinutes']);
    expect(errorPaths({ startNoticeMinutes: -1 })).toEqual(['startNoticeMinutes']);
    expect(errorPaths({ startNoticeMinutes: 1441 })).toEqual(['startNoticeMinutes']);
    expect(parse({ startNoticeMinutes: 1440, endNoticeMinutes: 1440 }).success).toBe(true);
  });

  it('refuses an end notice as long as a one period event', () => {
    const short = schedule('period', '2026-11-06T18:00', '2026-11-06T18:30');
    expect(parse({ ...short, endNoticeMinutes: 29 }).success).toBe(true);
    expect(errorPaths({ ...short, endNoticeMinutes: 30 })).toEqual(['endNoticeMinutes']);
  });

  it('measures a daily end notice against the window, not the date range', () => {
    const daily = schedule('daily', '2026-11-01T20:00', '2026-11-07T20:30');
    expect(parse({ ...daily, endNoticeMinutes: 29 }).success).toBe(true);
    expect(errorPaths({ ...daily, endNoticeMinutes: 30 })).toEqual(['endNoticeMinutes']);
  });
});

describe('eventMinutes', () => {
  it('measures a period across days', () => {
    expect(eventMinutes({ mode: 'period', start: '2026-11-06T18:00', end: '2026-11-07T18:30' })).toBe(1470);
  });

  it('measures only the window for a daily event', () => {
    expect(eventMinutes({ mode: 'daily', start: '2026-11-01T20:00', end: '2026-11-07T22:00' })).toBe(120);
  });
});

describe('gmEventIndexSchema', () => {
  it.each(['abc', '0', '-1', '2147483648', '1.5'])('refuses %s', (value) => {
    expect(gmEventIndexSchema.safeParse(value).success).toBe(false);
  });

  it('coerces a route parameter', () => {
    expect(gmEventIndexSchema.parse('2147483647')).toBe(2147483647);
  });
});
