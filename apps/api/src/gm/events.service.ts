import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  EVENT_TYPE_NAMES,
  type GmEvent,
  type GmEventInput,
  type GmEventList,
  isDropEvent,
  isPercentEvent,
} from '@4story-portal/shared';
import {
  ControlBadReplyError,
  ControlClient,
  ControlRefusedError,
  ControlTimeoutError,
  ControlUnavailableError,
} from '../control/control-client.js';
import { type ControlEvent, EVENT_KIND, EVENT_RESULT, type EventKind } from '../control/control-protocol.js';
import { GM_REPOSITORY, type GmRepository } from './gm.repository.js';

type Actor = { username: string; ip: string };

const ALL_MAPS = 255;
// Happy can target every world. The portal never does, because announcements then go through the relay server.
const ALL_WORLDS = 0;
const WORLD_SERVER = 3;
const NOT_CONNECTED = 'Game server is not connected';
const GONE = 'That event has already ended or been removed';

// TControlSvr owns events (see section 2 of the design): this only translates to and from its
// messages, and keeps it away from the requests it handles badly.
@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    private readonly control: ControlClient,
    @Inject(GM_REPOSITORY) private readonly repo: GmRepository,
  ) {}

  async list(): Promise<GmEventList> {
    try {
      const events = await this.control.listEvents();
      return { serverNow: currentWallClock(), events: events.map(toGmEvent) };
    } catch (error) {
      if (error instanceof ControlTimeoutError) throw new HttpException('The game server did not reply.', 503);
      const failure = controlFailure(error);
      if (!failure) throw error;
      throw new HttpException(failure.message, failure.status);
    }
  }

  async create(input: GmEventInput, actor: Actor): Promise<GmEvent> {
    await this.checkCanRun(input, `ADD ${describe(input)}`, actor);
    return this.save(EVENT_KIND.ADD, 'ADD', 0, input, actor);
  }

  async update(index: number, input: GmEventInput, actor: Actor): Promise<GmEvent> {
    const text = `UPDATE #${index} ${describe(input)}`;
    const current = await this.find(index, text, actor);
    if (!isPercentEvent(current.type)) {
      await this.reject('special', text, actor);
      throw new UnprocessableEntityException('Special events can only be stopped');
    }
    if (current.groupId === ALL_WORLDS) {
      await this.reject('all-worlds', text, actor);
      throw new UnprocessableEntityException('Events made for all worlds can only be stopped');
    }
    // The server stops a running event using the packet's type and world, so changing them would
    // leave the old bonus on until the map server restarts.
    if (current.type !== input.type) {
      await this.reject('type-change', text, actor);
      throw new UnprocessableEntityException('The type of an event cannot be changed');
    }
    if (current.groupId !== input.world) {
      await this.reject('world-change', text, actor);
      throw new UnprocessableEntityException('The world of an event cannot be changed');
    }
    await this.checkCanRun(input, text, actor);
    return this.save(EVENT_KIND.UPDATE, 'UPDATE', index, input, actor);
  }

  async remove(index: number, actor: Actor): Promise<void> {
    const current = await this.find(index, `STOP #${index}`, actor);
    const text = `STOP #${index} ${typeName(current.type)} "${current.title}" ${current.state ? 'running' : 'waiting'}`;
    // Sent back unchanged: the server stops special events using the fields in the packet.
    const { result } = await this.guarded(text, actor, () => this.control.changeEvent(EVENT_KIND.DELETE, current));
    if (result !== EVENT_RESULT.SUCCESS) {
      await this.reject('server-refused', text, actor);
      throw new HttpException('The game server could not save the event', 502);
    }
    await this.audit(text, actor);
  }

  private async find(index: number, text: string, actor: Actor): Promise<ControlEvent> {
    const events = await this.guarded(text, actor, () => this.control.listEvents());
    const current = events.find((event) => event.index === index);
    if (current) return current;
    await this.reject('not-found', text, actor);
    throw new NotFoundException(GONE);
  }

  private async checkCanRun(input: GmEventInput, text: string, actor: Actor): Promise<void> {
    const { state, worlds } = this.control.status();
    if (state !== 'connected') {
      await this.reject('disconnected', text, actor);
      throw new HttpException(NOT_CONNECTED, 503);
    }
    if (!worlds.some((world) => world.id === input.world)) {
      await this.reject('no-world', text, actor);
      throw new UnprocessableEntityException('That world is not available');
    }
    // Wall clock strings sort by time.
    if (input.schedule.end <= currentWallClock()) {
      await this.reject('end-passed', text, actor);
      throw new UnprocessableEntityException('The end time has already passed');
    }
  }

  private async save(
    kind: EventKind,
    verb: string,
    index: number,
    input: GmEventInput,
    actor: Actor,
  ): Promise<GmEvent> {
    const label = (i: number) => `${verb}${i ? ` #${i}` : ''} ${describe(input)}`;
    const sent = toControlEvent(input, index);
    const { result, event } = await this.guarded(label(index), actor, () => this.control.changeEvent(kind, sent));

    if (result === EVENT_RESULT.INVALID_TIME) {
      await this.reject('overlap', label(index), actor);
      throw new ConflictException(await this.overlapMessage(sent));
    }
    if (result !== EVENT_RESULT.SUCCESS) {
      await this.reject('server-refused', label(index), actor);
      throw new HttpException('The game server could not save the event', 502);
    }
    await this.audit(label(event.index), actor);
    return toGmEvent(event);
  }

  // The server only says "invalid time", so work out which event it means, using its own rule.
  private async overlapMessage(wanted: ControlEvent): Promise<string> {
    const events = await this.control.listEvents().catch(() => []);
    const other = events.find((event) => event.index !== wanted.index && overlaps(event, wanted));
    return other
      ? `Overlaps ${other.title}: only one ${typeName(wanted.type)} event can be on at a time.`
      : 'The game server refused those times.';
  }

  private async guarded<T>(text: string, actor: Actor, call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      const failure = controlFailure(error);
      if (!failure) throw error;
      await this.reject(failure.reason, text, actor);
      throw new HttpException(failure.message, failure.status);
    }
  }

  private reject(reason: string, text: string, actor: Actor): Promise<void> {
    return this.audit(`REJECTED ${reason}: ${text}`, actor);
  }

  private async audit(log: string, actor: Actor): Promise<void> {
    try {
      await this.repo.writeAudit({ ip: actor.ip, gmId: actor.username, command: 'EVENT', log });
    } catch (error) {
      this.logger.warn(`Could not write the event audit row: ${error instanceof Error ? error.message : error}`);
    }
  }
}

function controlFailure(error: unknown): { reason: string; status: number; message: string } | null {
  if (error instanceof ControlUnavailableError) {
    return { reason: 'disconnected', status: 503, message: NOT_CONNECTED };
  }
  if (error instanceof ControlTimeoutError) {
    return {
      reason: 'no-reply',
      status: 503,
      message: 'The game server did not reply. The change may or may not have applied, so check the list.',
    };
  }
  if (error instanceof ControlRefusedError) {
    return {
      reason: 'refused',
      status: 503,
      message: "The portal's control account does not have enough authority for events",
    };
  }
  if (error instanceof ControlBadReplyError) {
    return { reason: 'bad-reply', status: 502, message: 'The game server sent a reply the portal could not read' };
  }
  return null;
}

const typeName = (type: number) => EVENT_TYPE_NAMES[type] ?? `Type ${type}`;

function describe({ type, bonus, mapId, schedule, title }: GmEventInput): string {
  const { mode, start, end } = schedule;
  return `${typeName(type)} +${bonus}% maps=${mapId ?? 'all'} ${mode} ${start} to ${end} "${title}"`;
}

function toControlEvent(input: GmEventInput, index: number): ControlEvent {
  return {
    index,
    type: input.type,
    // On an update this makes the server restart the event. If it said running, the server would
    // turn the bonus off and never on again.
    state: 0,
    groupId: input.world,
    serverType: WORLD_SERVER,
    serverId: 0,
    start: toUnixSeconds(input.schedule.start),
    end: toUnixSeconds(input.schedule.end),
    value: input.bonus,
    mapId: input.mapId ?? ALL_MAPS,
    startAlarm: input.startNoticeMinutes,
    endAlarm: input.endNoticeMinutes,
    startMessage: input.startMessage,
    endMessage: input.endMessage,
    title: input.title,
    partTime: input.schedule.mode === 'period' ? 1 : 0,
    lotteryMessage: '',
    cashItems: [],
    monsterStartAction: 0,
    monsterEndAction: 0,
    spawnIds: [],
    regens: [],
    lottery: [],
  };
}

function toGmEvent(event: ControlEvent): GmEvent {
  return {
    index: event.index,
    type: event.type,
    typeName: typeName(event.type),
    editable: isPercentEvent(event.type) && event.groupId !== ALL_WORLDS,
    running: event.state !== 0,
    world: event.groupId,
    title: event.title,
    bonus: isPercentEvent(event.type) ? event.value : null,
    mapId: isDropEvent(event.type) && event.mapId !== ALL_MAPS ? event.mapId : null,
    schedule: {
      mode: event.partTime ? 'period' : 'daily',
      start: toWallClock(event.start),
      end: toWallClock(event.end),
    },
    startMessage: event.startMessage,
    endMessage: event.endMessage,
    startNoticeMinutes: event.startAlarm,
    endNoticeMinutes: event.endAlarm,
  };
}

// The rule in OnCT_EVENTCHANGE_REQ: bounds count, and two daily events may share dates if their
// time windows don't touch.
function overlaps(a: ControlEvent, b: ControlEvent): boolean {
  if (a.type !== b.type || a.start > b.end || b.start > a.end) return false;
  if (a.partTime || b.partTime) return true;
  return minuteOfDay(a.start) <= minuteOfDay(b.end) && minuteOfDay(b.start) <= minuteOfDay(a.end);
}

// The API runs on the same machine as TControlSvr, so its timezone is the server's.
function toUnixSeconds(wallClock: string): bigint {
  const [year, month, day, hour, minute] = wallClock.split(/[-T:]/).map(Number);
  return BigInt(new Date(year, month - 1, day, hour, minute).getTime() / 1000);
}

function minuteOfDay(seconds: bigint): number {
  const date = new Date(Number(seconds) * 1000);
  return date.getHours() * 60 + date.getMinutes();
}

const pad = (n: number) => String(n).padStart(2, '0');

function wallClockOf(date: Date): string {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${day}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const toWallClock = (seconds: bigint) => wallClockOf(new Date(Number(seconds) * 1000));
const currentWallClock = () => wallClockOf(new Date());
