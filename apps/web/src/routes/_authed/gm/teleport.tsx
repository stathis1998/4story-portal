import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import type { FieldValues, UseFormSetError } from 'react-hook-form'
import type { TeleportRequest } from '@4story-portal/shared'
import { FormMessage } from '../../../components/FormMessage'
import { CharacterTargetForm } from '../../../components/gm/CharacterTargetForm'
import { PlayersPanel } from '../../../components/gm/PlayersPanel'
import { PositionForm } from '../../../components/gm/PositionForm'
import { StatusBadge } from '../../../components/StatusBadge'
import { Tabs } from '../../../components/Tabs'
import { ApiError } from '../../../lib/api'
import { applyServerError } from '../../../lib/form-errors'
import {
  gmLocationsQueryOptions,
  gmStatusQueryOptions,
  onlinePlayersQueryOptions,
  useDeleteLocation,
  useSaveLocation,
  useTeleport,
} from '../../../lib/gm'
import { meQueryOptions } from '../../../lib/session'

export const Route = createFileRoute('/_authed/gm/teleport')({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions)
    if (!me?.isGm) throw redirect({ to: '/characters' })
  },
  component: TeleportPage,
})

const MAX_PLAYERS = 20
// The one server error worth showing: it tells the GM the preset file needs fixing.
const PRESET_FILE_INVALID = 'Preset file is invalid'
const POSITION_FIELDS = new Set(['world', 'channel', 'mapId', 'x', 'y', 'z'])
const CHARACTER_FIELDS = new Set(['target'])

function TeleportPage() {
  const queryClient = useQueryClient()
  const { data: status, isError: statusFailed } = useQuery(gmStatusQueryOptions)
  const { data: players, isFetching, isError: playersFailed } = useQuery(onlinePlayersQueryOptions)
  const { data: locations, error: locationsError, isError: locationsFailed } = useQuery(gmLocationsQueryOptions)
  const teleport = useTeleport()
  const saveLocation = useSaveLocation()
  const deleteLocation = useDeleteLocation()
  const [tab, setTab] = useState<'position' | 'character'>('position')
  const [chosen, setChosen] = useState<string[]>([])
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Anyone who went offline since they were ticked is dropped from the selection.
  const selected = useMemo(
    () => (players ? chosen.filter((name) => players.some((player) => player.name === name)) : chosen),
    [chosen, players],
  )

  const worldNames = useMemo(() => new Map(status?.worlds.map((world) => [world.id, world.name])), [status])

  // Characters are looked up per world: use the first selected player's, else the first world.
  const targetWorld =
    players?.find((player) => player.name === selected[0])?.world ?? status?.worlds[0]?.id ?? 1

  async function send<T extends FieldValues>(
    destination: TeleportRequest['destination'],
    ownFields: Set<string>,
    setFieldError: UseFormSetError<T>,
  ) {
    setNote(null)
    setError(null)
    try {
      const result = await teleport.mutateAsync({ names: selected, destination })
      setNote(`Sent to ${result.names.join(', ')}. The game doesn't confirm teleports, so check in game.`)
    } catch (err) {
      // Errors on fields this form lacks (names, destination) would otherwise go nowhere.
      const stray =
        err instanceof ApiError
          ? Object.entries(err.fieldErrors ?? {}).find(([field]) => !ownFields.has(field))
          : undefined
      const message = applyServerError(err, setFieldError)
      setError(message ?? stray?.[1][0] ?? null)
    }
  }

  // Turns a failed request into the message to show beside it; null means it worked.
  async function reportFailure(request: () => Promise<unknown>) {
    try {
      await request()
      return null
    } catch (err) {
      return err instanceof ApiError && (err.status < 500 || err.message === PRESET_FILE_INVALID)
        ? err.message
        : 'Something went wrong. Please try again.'
    }
  }

  const disabledReason =
    status && status.state !== 'connected'
      ? 'Game server is not connected'
      : selected.length === 0
        ? 'Select at least one player'
        : selected.length > MAX_PLAYERS
          ? 'Select at most 20 players'
          : null

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <div className="flex items-center gap-4">
        <h1 className="text-4xl">Teleport</h1>
        {status && <StatusBadge state={status.state} />}
      </div>

      <div className="mt-4">
        <FormMessage message={statusFailed ? 'Could not load the game server status.' : null} />
      </div>

      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[3fr_2fr]">
        <PlayersPanel
          players={players ?? []}
          loadError={playersFailed ? 'Could not load online players.' : null}
          worldNames={worldNames}
          selected={selected}
          onChange={setChosen}
          onRefresh={() => queryClient.refetchQueries({ queryKey: onlinePlayersQueryOptions.queryKey })}
          refreshing={isFetching}
        />
        {status && (
          <div className="flex flex-col gap-4">
            <Tabs
              tabs={[
                { id: 'position', label: 'Coordinates' },
                { id: 'character', label: 'Character' },
              ]}
              active={tab}
              onChange={(id) => setTab(id as 'position' | 'character')}
            />
            <div role="tabpanel" id="panel-position" aria-labelledby="tab-position" hidden={tab !== 'position'}>
              <PositionForm
                  worlds={status.worlds}
                  channels={status.channels}
                  selectedCount={selected.length}
                  disabledReason={disabledReason}
                  locations={locations ?? []}
                  locationsError={
                    locationsFailed
                      ? locationsError instanceof ApiError && locationsError.message
                        ? locationsError.message
                        : 'Could not load saved locations.'
                      : null
                  }
                  onSaveLocation={(input) => reportFailure(() => saveLocation.mutateAsync(input))}
                  onDeleteLocation={(id) => reportFailure(() => deleteLocation.mutateAsync(id))}
                  onSubmit={(position, setFieldError) =>
                    send({ kind: 'position', ...position }, POSITION_FIELDS, setFieldError)
                  }
                />
            </div>
            <div role="tabpanel" id="panel-character" aria-labelledby="tab-character" hidden={tab !== 'character'}>
                <CharacterTargetForm
                  world={targetWorld}
                  candidates={(players ?? []).filter((player) => !selected.includes(player.name))}
                  selectedCount={selected.length}
                  disabledReason={disabledReason}
                  onSubmit={(destination, setFieldError) => send(destination, CHARACTER_FIELDS, setFieldError)}
                />
            </div>
            <FormMessage message={error} />
            {note && <p className="rounded-xs border border-line bg-surface px-3 py-2 text-sm">{note}</p>}
          </div>
        )}
      </div>
    </main>
  )
}
