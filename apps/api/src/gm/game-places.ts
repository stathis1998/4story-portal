import type { GmPlaces } from '@4story-portal/shared';
import { DESTINATIONS, MAP_NAMES } from './game-places.generated.js';

/** Maps the server hosts right now, named where the client has a name, and destinations on them. */
export function gamePlaces(hostedMaps: number[]): GmPlaces {
  const hosted = new Set(hostedMaps);
  return {
    maps: hostedMaps.map((id) => ({ id, name: MAP_NAMES[id] ?? null })),
    destinations: DESTINATIONS.filter((destination) => hosted.has(destination.mapId)),
  };
}
