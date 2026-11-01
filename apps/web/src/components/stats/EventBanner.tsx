import { useQuery } from '@tanstack/react-query'
import { activeEventsQueryOptions, formatTimeLeft } from '../../lib/stats'

// Nothing to show when no event runs or the game server is down: this is a bonus, not page content.
export function EventBanner() {
  const { data } = useQuery(activeEventsQueryOptions)
  if (!data || data.events.length === 0) return null

  return (
    <aside aria-label="Active events" className="mb-6 rounded-xs border border-accent bg-surface-raised px-4 py-3">
      <ul className="flex flex-col gap-1">
        {data.events.map((event) => (
          <li key={`${event.type}-${event.mapName ?? 'all'}`} className="font-bold">
            {event.typeName} +{event.bonus}%{event.mapName && ` in ${event.mapName}`}, ends{' '}
            {formatTimeLeft(data.serverNow, event.endsAt)}
          </li>
        ))}
      </ul>
    </aside>
  )
}
