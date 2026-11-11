import { GRADE_EFFECTS, type GearEffect } from '@4story-portal/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { ApiError } from '../../lib/api'
import { gearEffectQueryOptions, saveGearEffect } from '../../lib/characters'
import { Button } from '../Button'
import { FormMessage } from '../FormMessage'

const muted = (text: string) => <p className="text-sm text-muted">{text}</p>
const effectName = (id: number) => (id === 0 ? 'No effect' : (GRADE_EFFECTS.find((effect) => effect.id === id)?.name ?? `Effect ${id}`))

export function GearEffectSection({ characterId }: { characterId: string }) {
  const { data, isPending } = useQuery(gearEffectQueryOptions(characterId))

  if (isPending) return muted('Loading...')
  if (!data) return muted('Your gear effects could not be loaded right now.')
  if (data.items.length === 0) {
    return muted('Nothing this character wears is +17 or higher. Only weapons and armour at +17 or more carry an effect.')
  }

  return (
    <div className="flex flex-col gap-4">
      <ul aria-label="Items that take the effect" className="flex flex-col gap-1 text-sm">
        {data.items.map((item) => (
          <li key={item.slot} className="flex flex-wrap justify-between gap-x-4">
            <span className="font-bold">
              {item.name} <span className="text-accent-text">+{item.upgrade}</span>
            </span>
            <span className="text-muted">{effectName(item.effect)}</span>
          </li>
        ))}
      </ul>
      {data.online ? (
        muted('Log out of the game with this character to change this.')
      ) : (
        <EffectForm characterId={characterId} gear={data} />
      )}
    </div>
  )
}

function EffectForm({ characterId, gear }: { characterId: string; gear: GearEffect }) {
  const queryClient = useQueryClient()
  const shared = gear.items.every((item) => item.effect === gear.items[0].effect) ? gear.items[0].effect : 0
  const [selected, setSelected] = useState(shared || 1)
  const [message, setMessage] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const queryOptions = gearEffectQueryOptions(characterId)

  const save = useMutation({
    mutationFn: (effect: number) => saveGearEffect(characterId, effect),
    onMutate: () => {
      setMessage(null)
      setDone(null)
    },
    onSuccess: (updated, effect) => {
      queryClient.setQueryData(queryOptions.queryKey, updated)
      setDone(`Done. ${effectName(effect)} shows in game from the next login. The gear above can take a minute to catch up.`)
    },
    onError: (error) => {
      setMessage(error instanceof ApiError ? error.message : 'Something went wrong. Please try again.')
      // Most likely the character logged in meanwhile, so show what's true now.
      void queryClient.invalidateQueries({ queryKey: queryOptions.queryKey })
    },
  })

  const preview = gear.items[0]
  const count = gear.items.length

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">Pick an effect for all of them at once. Free for now.</p>
      <div role="group" aria-label="Effects" className="grid max-h-72 grid-cols-2 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-3">
        {GRADE_EFFECTS.map((effect) => {
          const pressed = effect.id === selected
          return (
            <button
              key={effect.id}
              type="button"
              aria-pressed={pressed}
              onClick={() => setSelected(effect.id)}
              className={`flex flex-col items-start rounded-xs border px-2 py-1 text-left text-sm transition ${pressed ? 'border-accent bg-accent/15 text-fg' : 'border-line text-muted hover:text-fg'}`}
            >
              <span className="font-bold">{effect.name}</span>
              {effect.note && <span className="text-[11px] leading-tight">{effect.note}</span>}
            </button>
          )
        })}
      </div>
      <FormMessage message={message} />
      {done && (
        <p role="status" className="text-sm">
          {done}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={save.isPending} onClick={() => save.mutate(selected)}>
          Apply {effectName(selected)} to {count === 1 ? '1 item' : `${count} items`}
        </Button>
        <Link
          to="/effects"
          search={{ item: preview.itemId, level: preview.upgrade, effect: selected }}
          className="text-sm font-bold text-muted hover:underline"
        >
          Preview on {preview.name}
        </Link>
      </div>
    </div>
  )
}
