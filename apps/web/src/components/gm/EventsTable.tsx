import type { GmEvent, GmMap } from '@4story-portal/shared'
import { isDropEvent } from '@4story-portal/shared'
import { useState } from 'react'
import { formatEventSchedule, mapName } from '../../lib/gm'
import { Button } from '../Button'

type Props = {
  events: GmEvent[]
  maps: GmMap[]
  /** False while the game server is disconnected. */
  canChange: boolean
  /** The event being stopped, if any. */
  deleting?: number
  onEdit: (event: GmEvent) => void
  onDelete: (event: GmEvent) => void
}

const th = 'px-3 py-2 text-left text-xs font-bold tracking-wider text-muted uppercase'
const td = 'px-3 py-2'

function mapLabel(event: GmEvent, maps: GmMap[]) {
  if (!isDropEvent(event.type)) return ''
  if (event.mapId === null) return 'All maps'
  return mapName(event.mapId, maps.find((map) => map.id === event.mapId)?.name)
}

// The server has no pause: stopping an event removes it, so running ones say what happens now.
function confirmation(event: GmEvent) {
  if (!event.running) return `Delete ${event.title}? It will not run.`
  return `Stop ${event.title}? ${event.bonus === null ? 'It ends now.' : 'The bonus ends now.'}`
}

export function EventsTable({ events, maps, canChange, deleting, onEdit, onDelete }: Props) {
  const [confirming, setConfirming] = useState<number | null>(null)

  return (
    <div className="overflow-x-auto rounded-xs border border-line bg-surface">
      <table className="w-full text-sm">
        <thead className="border-b border-line">
          <tr>
            <th className={th}>Title</th>
            <th className={th}>Type</th>
            <th className={th}>Bonus</th>
            <th className={th}>Map</th>
            <th className={th}>Schedule</th>
            <th className={th}>Status</th>
            {canChange && <th className={th} aria-label="Actions" />}
          </tr>
        </thead>
        <tbody>
          {events.map((event) => {
            const action = event.running ? 'Stop' : 'Delete'
            return (
              <tr key={event.index} className="border-b border-line last:border-b-0">
                <td className={td}>{event.title}</td>
                <td className={`${td} whitespace-nowrap`}>{event.typeName}</td>
                <td className={td}>{event.bonus !== null && `+${event.bonus}%`}</td>
                <td className={`${td} whitespace-nowrap`}>{mapLabel(event, maps)}</td>
                <td className={`${td} whitespace-nowrap`}>{formatEventSchedule(event.schedule)}</td>
                <td className={event.running ? `${td} text-accent-text` : `${td} text-muted`}>
                  {event.running ? 'Running' : 'Waiting'}
                </td>
                {canChange && (
                  <td className={`${td} text-right`}>
                    {deleting === event.index ? (
                      <span className="text-muted">Stopping…</span>
                    ) : confirming === event.index ? (
                      <span className="flex flex-wrap items-center justify-end gap-2">
                        {confirmation(event)}
                        <Button
                          size="sm"
                          onClick={() => {
                            setConfirming(null)
                            onDelete(event)
                          }}
                        >
                          {action}
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => setConfirming(null)}>
                          Cancel
                        </Button>
                      </span>
                    ) : (
                      <span className="flex items-center justify-end gap-2">
                        {event.editable && (
                          <Button
                            variant="secondary"
                            size="sm"
                            aria-label={`Edit ${event.title}`}
                            onClick={() => onEdit(event)}
                          >
                            Edit
                          </Button>
                        )}
                        <Button
                          variant="secondary"
                          size="sm"
                          aria-label={`${action} ${event.title}`}
                          onClick={() => setConfirming(event.index)}
                        >
                          {action}
                        </Button>
                      </span>
                    )}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
