import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { FormMessage } from '../../../components/FormMessage'
import { PlayersPanel } from '../../../components/gm/PlayersPanel'
import { PositionForm } from '../../../components/gm/PositionForm'
import { StatusBadge } from '../../../components/StatusBadge'
import { applyServerError } from '../../../lib/form-errors'
import { gmStatusQueryOptions, onlinePlayersQueryOptions, useTeleport } from '../../../lib/gm'
import { meQueryOptions } from '../../../lib/session'

export const Route = createFileRoute('/_authed/gm/teleport')({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions)
    if (!me?.isGm) throw redirect({ to: '/characters' })
  },
  component: TeleportPage,
})

function TeleportPage() {
  const queryClient = useQueryClient()
  const { data: status } = useQuery(gmStatusQueryOptions)
  const { data: players, isFetching } = useQuery(onlinePlayersQueryOptions)
  const teleport = useTeleport()
  const [chosen, setChosen] = useState<string[]>([])
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Anyone who went offline since they were ticked is dropped from the selection.
  const selected = useMemo(
    () => (players ? chosen.filter((name) => players.some((player) => player.name === name)) : chosen),
    [chosen, players],
  )

  const worldNames = useMemo(() => new Map(status?.worlds.map((world) => [world.id, world.name])), [status])

  const disabledReason =
    status && status.state !== 'connected'
      ? 'Game server is not connected'
      : selected.length === 0
        ? 'Select at least one player'
        : null

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <div className="flex items-center gap-4">
        <h1 className="text-4xl">Teleport</h1>
        {status && <StatusBadge state={status.state} />}
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[3fr_2fr]">
        <PlayersPanel
          players={players ?? []}
          worldNames={worldNames}
          selected={selected}
          onChange={setChosen}
          onRefresh={() => queryClient.refetchQueries({ queryKey: onlinePlayersQueryOptions.queryKey })}
          refreshing={isFetching}
        />
        {status && (
          <div className="flex flex-col gap-4">
            <PositionForm
              worlds={status.worlds}
              channels={status.channels}
              selectedCount={selected.length}
              disabledReason={disabledReason}
              onSubmit={async (position, setFieldError) => {
                setNote(null)
                setError(null)
                try {
                  const result = await teleport.mutateAsync({
                    names: selected,
                    destination: { kind: 'position', ...position },
                  })
                  setNote(`Sent to ${result.names.join(', ')}. The game doesn't confirm teleports, so check in game.`)
                } catch (err) {
                  setError(applyServerError(err, setFieldError))
                }
              }}
            />
            <FormMessage message={error} />
            {note && <p className="rounded-xs border border-line bg-surface px-3 py-2 text-sm">{note}</p>}
          </div>
        )}
      </div>
    </main>
  )
}
