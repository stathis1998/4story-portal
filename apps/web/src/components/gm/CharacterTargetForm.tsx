import type { OnlinePlayer } from '@4story-portal/shared'
import { useForm, useWatch, type UseFormSetError } from 'react-hook-form'
import { Button } from '../Button'
import { Select } from '../Select'

type Target = { target: string }

type Props = {
  world: number
  candidates: OnlinePlayer[]
  selectedCount: number
  disabledReason: string | null
  onSubmit: (
    destination: { kind: 'character'; world: number; target: string },
    setError: UseFormSetError<Target>,
  ) => void | Promise<void>
}

export function CharacterTargetForm({ world, candidates, selectedCount, disabledReason, onSubmit }: Props) {
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { isSubmitting },
  } = useForm<Target>({ defaultValues: { target: '' } })

  // A target who got selected (or went offline) is no longer in the list.
  const target = useWatch({ control, name: 'target' })
  const chosen = candidates.some((player) => player.name === target) ? target : ''
  const reason = disabledReason ?? (chosen ? null : 'Choose a target character')

  return (
    <form
      onSubmit={handleSubmit(({ target }) => onSubmit({ kind: 'character', world, target }, setError))}
      noValidate
      className="flex flex-col gap-4"
    >
      <Select
        label="Target character"
        registration={register('target')}
        options={[
          { value: '', label: 'Choose a character' },
          ...candidates.map((player) => ({ value: player.name, label: player.name })),
        ]}
      />
      <Button type="submit" disabled={Boolean(reason) || isSubmitting}>
        Teleport {selectedCount} {selectedCount === 1 ? 'player' : 'players'}
      </Button>
      {reason && <p className="text-sm text-muted">{reason}</p>}
    </form>
  )
}
