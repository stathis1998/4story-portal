import { Injectable } from '@nestjs/common';
import { type ActiveEvent, type ActiveEvents, isPercentEvent } from '@4story-portal/shared';
import { ControlClient } from '../control/control-client.js';
import { currentWallClock, toGmEvent } from '../gm/events.service.js';
import { MAP_NAMES } from '../gm/game-places.generated.js';

const CACHE_MS = 30_000;

// The event banner every player sees. The control connection handles one request at a time, so all
// players share one list, and a failure only means no banner.
@Injectable()
export class ActiveEventsService {
  private cache: { loadedAt: number; events: Promise<ActiveEvent[]> } | null = null;

  constructor(private readonly control: ControlClient) {}

  async list(): Promise<ActiveEvents> {
    const now = Date.now();
    if (!this.cache || now - this.cache.loadedAt >= CACHE_MS) {
      this.cache = { loadedAt: now, events: this.load() };
    }
    return { serverNow: currentWallClock(), events: await this.cache.events };
  }

  private async load(): Promise<ActiveEvent[]> {
    const events = await this.control.listEvents().catch(() => []);
    const today = currentWallClock().slice(0, 10);
    return events.flatMap((raw) => {
      const event = toGmEvent(raw);
      if (!event.running || !isPercentEvent(event.type) || event.bonus === null) return [];
      const { mode, end } = event.schedule;
      return [
        {
          type: event.type,
          typeName: event.typeName,
          bonus: event.bonus,
          mapName: event.mapId === null ? null : (MAP_NAMES[event.mapId] ?? `Map ${event.mapId}`),
          // A daily event runs until today's window ends, not the last date.
          endsAt: mode === 'daily' ? `${today}T${end.slice(11)}` : end,
        },
      ];
    });
  }
}
