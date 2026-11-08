import { MAX_FREEZE_LEVEL, type LevelFreeze } from '@4story-portal/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { levelFreezeQueryOptions, saveLevelFreeze } from '../../lib/characters'
import { applyServerError } from '../../lib/form-errors'
import { Button } from '../Button'
import { FormMessage } from '../FormMessage'
import { TextField } from '../TextField'

const muted = (text: string) => <p className="text-sm text-muted">{text}</p>

export function LevelFreezeSection({ characterId }: { characterId: string }) {
  const { data, isPending } = useQuery(levelFreezeQueryOptions(characterId))

  if (isPending) return muted('Loading...')
  if (!data) return muted('The level freeze could not be loaded right now.')
  if (data.level > MAX_FREEZE_LEVEL) return muted('This character is already at the highest level.')

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">
        {data.freezeLevel === null
          ? 'Not frozen. Pick a level to stop this character there. Any EXP past it turns into money, the same as at level 90.'
          : `Frozen at level ${data.freezeLevel}. Any EXP past it turns into money.`}
      </p>
      {data.online ? (
        muted('Log out of the game with this character to change this.')
      ) : (
        <FreezeForm characterId={characterId} freeze={data} />
      )}
    </div>
  )
}

function FreezeForm({ characterId, freeze }: { characterId: string; freeze: LevelFreeze }) {
  const queryClient = useQueryClient()
  const [message, setMessage] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<{ level: string }>({ defaultValues: { level: String(freeze.freezeLevel ?? freeze.level) } })
  const queryOptions = levelFreezeQueryOptions(characterId)

  const save = useMutation({
    mutationFn: (level: number | null) => saveLevelFreeze(characterId, level),
    onMutate: () => setMessage(null),
    onSuccess: (updated) => queryClient.setQueryData(queryOptions.queryKey, updated),
    onError: (error) => setMessage(applyServerError(error, setError)),
  })

  const outOfRange = `Choose a level from ${freeze.level} to ${MAX_FREEZE_LEVEL}`
  const validLevel = (value: string) => {
    const level = Number(value)
    return (value !== '' && Number.isInteger(level) && level >= freeze.level && level <= MAX_FREEZE_LEVEL) || outOfRange
  }

  return (
    <form onSubmit={handleSubmit(({ level }) => save.mutate(Number(level)))} noValidate className="flex max-w-xs flex-col gap-3">
      <TextField
        label="Freeze at level"
        type="number"
        registration={register('level', { validate: validLevel })}
        error={errors.level?.message}
      />
      <FormMessage message={message} />
      <div className="flex gap-2">
        <Button type="submit" disabled={save.isPending}>
          Save freeze
        </Button>
        {freeze.freezeLevel !== null && (
          <Button variant="secondary" disabled={save.isPending} onClick={() => save.mutate(null)}>
            Remove freeze
          </Button>
        )}
      </div>
    </form>
  )
}
