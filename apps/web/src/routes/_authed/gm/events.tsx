import type { GmEvent, GmEventInput } from '@4story-portal/shared'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '../../../components/Button'
import { FormMessage } from '../../../components/FormMessage'
import { EventForm } from '../../../components/gm/EventForm'
import { EventsTable } from '../../../components/gm/EventsTable'
import { GmNav } from '../../../components/gm/GmNav'
import { StatusBadge } from '../../../components/StatusBadge'
import {
  eventErrorMessage,
  gmEventsQueryOptions,
  gmPlacesQueryOptions,
  gmStatusQueryOptions,
  useCreateEvent,
  useDeleteEvent,
  useUpdateEvent,
} from '../../../lib/gm'
import { meQueryOptions } from '../../../lib/session'

export const Route = createFileRoute('/_authed/gm/events')({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions)
    if (!me?.isGm) throw redirect({ to: '/characters' })
  },
  component: EventsPage,
})

type FormState = { kind: 'closed' } | { kind: 'new' } | { kind: 'edit'; event: GmEvent }

function EventsPage() {
  const { data: status } = useQuery(gmStatusQueryOptions)
  const { data: list, isError: listFailed, error: listError } = useQuery(gmEventsQueryOptions)
  const { data: places } = useQuery(gmPlacesQueryOptions)
  const createEvent = useCreateEvent()
  const updateEvent = useUpdateEvent()
  const deleteEvent = useDeleteEvent()
  const [form, setForm] = useState<FormState>({ kind: 'closed' })
  const [error, setError] = useState<string | null>(null)

  const connected = status?.state === 'connected'
  const maps = places?.maps ?? []

  async function remove(event: GmEvent) {
    setError(null)
    try {
      await deleteEvent.mutateAsync(event.index)
    } catch (err) {
      setError(eventErrorMessage(err))
    }
  }

  async function save(input: GmEventInput): Promise<string | null> {
    try {
      if (form.kind === 'edit') await updateEvent.mutateAsync({ index: form.event.index, input })
      else await createEvent.mutateAsync(input)
      setForm({ kind: 'closed' })
      return null
    } catch (err) {
      return eventErrorMessage(err)
    }
  }

  // The newest copy, so the running warning stays true. The event can also end while the form is open.
  const editing =
    form.kind === 'edit' ? (list?.events.find((event) => event.index === form.event.index) ?? form.event) : undefined

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
        {connected && list && form.kind === 'closed' && (
          <div className="flex justify-end">
            <Button onClick={() => setForm({ kind: 'new' })}>New event</Button>
          </div>
        )}
        {list && form.kind !== 'closed' && (
          <EventForm
            // Each event starts from its own values.
            key={form.kind === 'edit' ? form.event.index : 'new'}
            event={editing}
            worlds={status?.worlds ?? []}
            maps={maps}
            serverNow={list.serverNow}
            onSubmit={save}
            onCancel={() => setForm({ kind: 'closed' })}
          />
        )}
        {connected && list?.events.length === 0 && (
          <p className="rounded-xs border border-dashed border-line p-10 text-center text-muted">
            No events are scheduled.
          </p>
        )}
        {list && list.events.length > 0 && (
          <EventsTable
            events={list.events}
            maps={maps}
            canChange={connected}
            deleting={deleteEvent.isPending ? deleteEvent.variables : undefined}
            onEdit={(event) => setForm({ kind: 'edit', event })}
            onDelete={remove}
          />
        )}
      </div>
    </main>
  )
}
