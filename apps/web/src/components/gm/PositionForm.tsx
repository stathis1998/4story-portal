import { type PositionDestination, positionSchema } from '@4story-portal/shared'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, type UseFormSetError } from 'react-hook-form'
import { Button } from '../Button'
import { Select } from '../Select'
import { TextField } from '../TextField'

type Props = {
  worlds: { id: number; name: string }[]
  channels: number[]
  selectedCount: number
  disabledReason: string | null
  onSubmit: (position: PositionDestination, setError: UseFormSetError<PositionDestination>) => void | Promise<void>
}

export function PositionForm({ worlds, channels, selectedCount, disabledReason, onSubmit }: Props) {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<PositionDestination>({
    resolver: zodResolver(positionSchema),
    defaultValues: { world: worlds[0]?.id ?? 1, channel: channels[0] ?? 1 },
  })

  return (
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
      <TextField
        label="Map ID"
        type="number"
        registration={register('mapId', { valueAsNumber: true })}
        error={errors.mapId?.message}
      />
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
  )
}
