import type { GmEvent } from '@4story-portal/shared'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { FormMessage } from '../../../components/FormMessage'
import { EventsTable } from '../../../components/gm/EventsTable'
import { GmNav } from '../../../components/gm/GmNav'
import { StatusBadge } from '../../../components/StatusBadge'
import {
  eventErrorMessage,
  gmEventsQueryOptions,
  gmPlacesQueryOptions,
  gmStatusQueryOptions,
  useDeleteEvent,
} from '../../../lib/gm'
import { meQueryOptions } from '../../../lib/session'

export const Route = createFileRoute('/_authed/gm/events')({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions)
    if (!me?.isGm) throw redirect({ to: '/characters' })
  },
  component: EventsPage,
})

function EventsPage() {
  const { data: status } = useQuery(gmStatusQueryOptions)
  const { data: list, isError: listFailed, error: listError } = useQuery(gmEventsQueryOptions)
  const { data: places } = useQuery(gmPlacesQueryOptions)
  const deleteEvent = useDeleteEvent()
  const [error, setError] = useState<string | null>(null)

  const connected = status?.state === 'connected'

  async function remove(event: GmEvent) {
    setError(null)
    try {
      await deleteEvent.mutateAsync(event.index)
    } catch (err) {
      setError(eventErrorMessage(err))
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <GmNav />
      <div className="flex items-center gap-4">
        <h1 className="text-4xl">Events</h1>
        {status && <StatusBadge state={status.state} />}
      </div>
      <p className="mt-2 text-sm text-muted">
        Bonus events the game server runs on a schedule: EXP, drops, upgrades and more. Times are the server's.
      </p>

      <div className="mt-6 flex flex-col gap-3">
        {status && !connected && (
          <p className="text-sm text-muted">The game server isn't connected, so events can't be listed or changed.</p>
        )}
        {connected && listFailed && <FormMessage message={eventErrorMessage(listError)} />}
        <FormMessage message={error} />
        {connected && list?.events.length === 0 && (
          <p className="rounded-xs border border-dashed border-line p-10 text-center text-muted">
            No events are scheduled.
          </p>
        )}
        {list && list.events.length > 0 && (
          <EventsTable
            events={list.events}
            maps={places?.maps ?? []}
            canChange={connected}
            deleting={deleteEvent.isPending ? deleteEvent.variables : undefined}
            onEdit={() => undefined}
            onDelete={remove}
          />
        )}
      </div>
    </main>
  )
}
