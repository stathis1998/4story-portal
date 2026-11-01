import {
  type GmLocation,
  type GmLocationInput,
  gmLocationInputSchema,
  type GmMap,
  type GmPlaces,
  type PositionDestination,
  positionSchema,
} from '@4story-portal/shared'
import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm, type UseFormSetError } from 'react-hook-form'
import { mapName, mapOptionLabel } from '../../lib/gm'
import { Button } from '../Button'
import { FormMessage } from '../FormMessage'
import { Select } from '../Select'
import { TextField } from '../TextField'
import { DestinationSearch } from './DestinationSearch'
import { PresetsList } from './PresetsList'

type Props = {
  worlds: { id: number; name: string }[]
  channels: number[]
  /** Undefined when map names failed to load: the map is then a plain number field. */
  places?: GmPlaces
  selectedCount: number
  disabledReason: string | null
  locations: GmLocation[]
  locationsError?: string | null
  /** Resolves to an error message to show inline, or null once saved. */
  onSaveLocation: (input: GmLocationInput) => Promise<string | null>
  onDeleteLocation: (id: string) => Promise<string | null>
  onSubmit: (position: PositionDestination, setError: UseFormSetError<PositionDestination>) => void | Promise<void>
}

// A preset can outlive its map, so its map stays pickable rather than silently becoming another.
function mapOptions(maps: GmMap[], locations: GmLocation[]) {
  const hosted = new Set(maps.map((map) => map.id))
  const gone = [...new Set(locations.map((location) => location.mapId))].filter((id) => !hosted.has(id))
  return [
    ...maps.map((map) => ({ value: map.id, label: mapOptionLabel(map) })),
    ...gone.map((id) => ({ value: id, label: `Map ${id} (not hosted)` })),
  ]
}

export function PositionForm({
  worlds,
  channels,
  places,
  selectedCount,
  disabledReason,
  locations,
  locationsError,
  onSaveLocation,
  onDeleteLocation,
  onSubmit,
}: Props) {
  const [naming, setNaming] = useState(false)
  const [presetName, setPresetName] = useState('')
  const [presetError, setPresetError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    setError,
    reset,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<PositionDestination>({
    resolver: zodResolver(positionSchema),
    defaultValues: { world: worlds[0]?.id ?? 1, channel: channels[0] ?? 1, mapId: places?.maps[0]?.id },
  })

  async function savePreset() {
    const parsed = gmLocationInputSchema.safeParse({ ...getValues(), name: presetName.trim() })
    if (!parsed.success) {
      setPresetError(parsed.error.issues[0].message)
      return
    }
    const message = await onSaveLocation(parsed.data)
    setPresetError(message)
    if (!message) {
      setNaming(false)
      setPresetName('')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {places && (
        <DestinationSearch
          destinations={places.destinations}
          mapNames={new Map(places.maps.map((map) => [map.id, mapName(map.id, map.name)]))}
          onPick={({ mapId, x, y, z }) => reset({ ...getValues(), mapId, x, y, z })}
        />
      )}
      <PresetsList
        locations={locations}
        loadError={locationsError}
        onPick={(location) =>
          reset({
            world: location.world,
            channel: location.channel,
            mapId: location.mapId,
            x: location.x,
            y: location.y,
            z: location.z,
          })
        }
        onDelete={onDeleteLocation}
      />
      <form onSubmit={handleSubmit((values) => onSubmit(values, setError))} noValidate className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4">
          <Select
            label="World"
            registration={register('world', { setValueAs: Number })}
            error={errors.world?.message}
            options={worlds.map((world) => ({ value: world.id, label: world.name }))}
          />
          <Select
            label="Channel"
            registration={register('channel', { setValueAs: Number })}
            error={errors.channel?.message}
            options={channels.map((channel) => ({ value: channel, label: String(channel) }))}
          />
        </div>
        {places ? (
          <Select
            label="Map"
            registration={register('mapId', { setValueAs: Number })}
            error={errors.mapId?.message}
            options={mapOptions(places.maps, locations)}
          />
        ) : (
          <TextField
            label="Map ID"
            type="number"
            registration={register('mapId', { valueAsNumber: true })}
            error={errors.mapId?.message}
          />
        )}
        <div className="grid grid-cols-3 gap-4">
          <TextField
            label="X"
            type="number"
            step="any"
            registration={register('x', { valueAsNumber: true })}
            error={errors.x?.message}
          />
          <TextField
            label="Height (Y)"
            type="number"
            step="any"
            registration={register('y', { valueAsNumber: true })}
            error={errors.y?.message}
          />
          <TextField
            label="Z"
            type="number"
            step="any"
            registration={register('z', { valueAsNumber: true })}
            error={errors.z?.message}
          />
        </div>
        <Button type="submit" disabled={Boolean(disabledReason) || isSubmitting}>
          Teleport {selectedCount} {selectedCount === 1 ? 'player' : 'players'}
        </Button>
        {disabledReason && <p className="text-sm text-muted">{disabledReason}</p>}
      </form>
      {naming ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="preset-name" className="text-xs font-bold tracking-wider text-muted uppercase">
            Preset name
          </label>
          <input
            id="preset-name"
            value={presetName}
            onChange={(event) => setPresetName(event.target.value)}
            className="rounded-xs border border-line bg-surface-raised px-3 py-2 outline-none transition focus:border-accent focus:ring-1 focus:ring-accent"
          />
          <FormMessage message={presetError} />
          <div className="flex gap-2">
            <Button size="sm" onClick={savePreset}>
              Save
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setNaming(false)
                setPresetError(null)
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" size="sm" className="self-start" onClick={() => setNaming(true)}>
          Save as preset
        </Button>
      )}
    </div>
  )
}
