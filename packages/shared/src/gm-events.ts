import { z } from 'zod';

// The game's EVENT_TYPE (NetCode.h). The server only knows these as numbers.
export const EVENT_TYPE_NAMES: Record<number, string> = {
  1: 'EXP',
  2: 'Cash shop sale',
  3: 'Item drop',
  4: 'Magic item drop',
  5: 'Refine',
  6: 'Refine transfer',
  7: 'Item upgrade',
  8: 'Magic upgrade',
  9: 'Rare magic upgrade',
  10: 'Gamble option',
  11: 'Money drop',
  12: 'Monster spawn',
  13: 'Monster regen',
  14: 'Item lottery',
  15: 'Gift time',
};

/** The types whose value is a +N% bonus. The others need their own forms. */
export const PERCENT_EVENT_TYPES = [1, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;
/** The only types the map server filters by map. */
export const DROP_EVENT_TYPES = [3, 4, 11] as const;

export const isPercentEvent = (type: number) => (PERCENT_EVENT_TYPES as readonly number[]).includes(type);
export const isDropEvent = (type: number) => (DROP_EVENT_TYPES as readonly number[]).includes(type);

const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

// Times are the server's wall clock with no timezone, so UTC here only does calendar arithmetic.
function wallClockMs(value: string): number | null {
  const match = WALL_CLOCK.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const ms = Date.UTC(year, month - 1, day, hour, minute);
  const date = new Date(ms);
  const real =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute;
  return real ? ms : null;
}

const minuteOfDay = (value: string) => Number(value.slice(11, 13)) * 60 + Number(value.slice(14, 16));

const wallClockSchema = z.string().refine((value) => wallClockMs(value) !== null, 'Enter a valid date and time');

export const gmEventScheduleSchema = z.object({
  mode: z.enum(['period', 'daily']),
  start: wallClockSchema,
  end: wallClockSchema,
});
export type GmEventSchedule = z.infer<typeof gmEventScheduleSchema>;

/** How long the event runs at a stretch: its whole length, or the daily window. */
export function eventMinutes(schedule: GmEventSchedule): number {
  if (schedule.mode === 'daily') return minuteOfDay(schedule.end) - minuteOfDay(schedule.start);
  return ((wallClockMs(schedule.end) ?? 0) - (wallClockMs(schedule.start) ?? 0)) / 60000;
}

// The protocol's strings are Latin-1 bytes, so anything else would arrive garbled.
const LATIN1_PRINTABLE = /^[\x20-\x7e\xa0-\xff]*$/;
const NOT_SENDABLE = 'Use only Latin letters, digits and common symbols';

const messageSchema = z
  .string()
  .trim()
  .min(1, 'Enter a message')
  .max(200, 'Use 200 characters or fewer')
  .regex(LATIN1_PRINTABLE, NOT_SENDABLE);

export const gmEventInputSchema = z
  .object({
    type: z.literal(PERCENT_EVENT_TYPES, 'Choose an event type'),
    world: z.number().int().min(1).max(255),
    // TControlSvr copies the title into a 51-character buffer with lstrcpy.
    title: z
      .string()
      .trim()
      .min(1, 'Enter a title')
      .max(50, 'Use 50 characters or fewer')
      .regex(LATIN1_PRINTABLE, NOT_SENDABLE),
    bonus: z.number('Enter a bonus').int('Use a whole number').min(1, 'Use 1 or more').max(1000, 'Use 1000 or less'),
    // Null is all maps. On the wire that's 255, so 255 can't also name a map.
    mapId: z
      .number()
      .int()
      .min(0)
      .max(32767)
      .refine((id) => id !== 255, 'That number means all maps')
      .nullable(),
    schedule: gmEventScheduleSchema,
    startMessage: messageSchema,
    endMessage: messageSchema,
    startNoticeMinutes: z.number('Enter minutes').int('Use a whole number').min(0, 'Use 0 or more').max(1440, 'Use 1440 or less'),
    endNoticeMinutes: z.number('Enter minutes').int('Use a whole number').min(1, 'Use 1 or more').max(1440, 'Use 1440 or less'),
  })
  .superRefine((input, ctx) => {
    if (input.mapId !== null && !isDropEvent(input.type)) {
      ctx.addIssue({ code: 'custom', path: ['mapId'], message: 'Only drop events can be limited to a map' });
    }

    const { schedule } = input;
    const start = wallClockMs(schedule.start);
    const end = wallClockMs(schedule.end);
    if (start === null || end === null) return;
    if (end <= start) {
      ctx.addIssue({ code: 'custom', path: ['schedule', 'end'], message: 'The end must be after the start' });
      return;
    }
    if (schedule.mode === 'daily' && minuteOfDay(schedule.end) <= minuteOfDay(schedule.start)) {
      // The server compares minutes of the day, so a window crossing midnight never starts.
      ctx.addIssue({ code: 'custom', path: ['schedule', 'end'], message: 'The daily window cannot cross midnight' });
      return;
    }
    if (input.endNoticeMinutes >= eventMinutes(schedule)) {
      ctx.addIssue({ code: 'custom', path: ['endNoticeMinutes'], message: 'Must be shorter than the event' });
    }
  });
export type GmEventInput = z.infer<typeof gmEventInputSchema>;

/** Route param for an event index; the game stores it as a signed 32-bit value. */
export const gmEventIndexSchema = z.coerce.number().int().min(1).max(2147483647);

export type GmEvent = {
  index: number;
  type: number;
  typeName: string;
  /** A percentage type. The others can only be stopped. */
  editable: boolean;
  running: boolean;
  /** 0 is all worlds. */
  world: number;
  title: string;
  /** Null for the types whose value isn't a bonus. */
  bonus: number | null;
  /** Null is all maps, and also the types that have no map. */
  mapId: number | null;
  schedule: GmEventSchedule;
  startMessage: string;
  endMessage: string;
  startNoticeMinutes: number;
  endNoticeMinutes: number;
};

export type GmEventList = {
  /** The server's clock, as `YYYY-MM-DDTHH:mm`. */
  serverNow: string;
  events: GmEvent[];
};
