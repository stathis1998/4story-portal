import { REBIRTH_LEVEL, type RebirthState } from '@4story-portal/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { applyServerError } from '../../lib/form-errors'
import { beReborn, rebirthQueryOptions } from '../../lib/rebirth'
import { profileQueryOptions } from '../../lib/stats'
import { Button } from '../Button'
import { FormMessage } from '../FormMessage'

const muted = (text: string) => <p className="text-sm text-muted">{text}</p>
const grouped = (n: number) => n.toLocaleString('en-US')

type Line = { met: boolean; text: string }

function checklist(state: RebirthState, priceGold: number): Line[] {
  const { level, online, wornItems, wallet } = state
  return [
    { met: level >= REBIRTH_LEVEL, text: level >= REBIRTH_LEVEL ? `Level ${REBIRTH_LEVEL}` : `Level ${REBIRTH_LEVEL} needed, this character is ${level}` },
    { met: !online, text: online ? 'Log out of the game with this character' : 'Logged out' },
    { met: wornItems === 0, text: wornItems === 0 ? 'Nothing worn' : `${wornItems} ${wornItems === 1 ? 'item' : 'items'} still on` },
    {
      met: wallet.gold >= priceGold,
      text:
        wallet.gold >= priceGold
          ? `${grouped(priceGold)} Gold`
          : `${grouped(priceGold)} Gold needed, this character has ${grouped(wallet.gold)}`,
    },
  ]
}

export function RebirthSection({ characterId }: { characterId: string }) {
  const queryClient = useQueryClient()
  const queryOptions = rebirthQueryOptions(characterId)
  const { data, isPending } = useQuery(queryOptions)
  const [asking, setAsking] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const reborn = useMutation({
    mutationFn: (priceGold: number) => beReborn(characterId, priceGold),
    onMutate: () => setMessage(null),
    onSuccess: (state) => {
      setAsking(false)
      queryClient.setQueryData(queryOptions.queryKey, state)
      void queryClient.invalidateQueries({ queryKey: profileQueryOptions(characterId).queryKey })
    },
    onError: (error) => {
      setAsking(false)
      setMessage(applyServerError(error, () => {}))
      void queryClient.invalidateQueries({ queryKey: queryOptions.queryKey })
    },
  })

  if (isPending) return muted('Loading...')
  if (!data) return muted('Rebirth could not be loaded right now.')
  if (!data.open) return muted('Rebirth is closed right now.')

  const { next } = data
  const lines = next ? checklist(data, next.priceGold) : []
  const ready = lines.length > 0 && lines.every((line) => line.met)

  return (
    <div className="flex flex-col gap-4">
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <span>Rebirths: {data.rebirths}</span>
        <span>Bonus: {data.bonus > 0 ? `+${data.bonus}% all stats` : 'none yet'}</span>
      </p>
      {next ? (
        <>
          <ul className="flex flex-col gap-1 text-sm">
            {lines.map((line) => (
              <li key={line.text} className={line.met ? '' : 'text-muted'}>
                <span aria-hidden="true" className="mr-2 font-mono">
                  {line.met ? '[x]' : '[ ]'}
                </span>
                <span>{line.text}</span>
              </li>
            ))}
          </ul>
          <FormMessage message={message} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">{`Next: rebirth ${next.number}, +${next.bonus}% all stats`}</p>
            <Button disabled={!ready} onClick={() => setAsking(true)}>
              Be reborn
            </Button>
          </div>
          {asking && (
            <ConfirmDialog
              priceGold={next.priceGold}
              pending={reborn.isPending}
              onConfirm={() => !reborn.isPending && reborn.mutate(next.priceGold)}
              onCancel={() => setAsking(false)}
            />
          )}
        </>
      ) : (
        <>
          {muted('This character has reached the rebirth limit.')}
          <FormMessage message={message} />
        </>
      )}
    </div>
  )
}

const FOCUSABLE = 'button:not([disabled])'

type DialogProps = { priceGold: number; pending: boolean; onConfirm: () => void; onCancel: () => void }

function ConfirmDialog({ priceGold, pending, onConfirm, onCancel }: DialogProps) {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)

  // Focus goes in while it is open and back to where it was after.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    cancel.current?.focus()
    return () => opener?.focus()
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        if (!pending) onCancel()
        return
      }
      if (event.key !== 'Tab') return
      const stops = [...(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
      const first = stops[0]
      const last = stops[stops.length - 1]
      if (!first || !last) return event.preventDefault()
      const active = document.activeElement
      const outside = !panel.current?.contains(active)
      if (event.shiftKey ? outside || active === first : outside || active === last) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onCancel, pending])

  return createPortal(
    <div
      role="presentation"
      onClick={(event) => event.target === event.currentTarget && !pending && onCancel()}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center sm:p-4"
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex w-full max-w-md flex-col gap-4 rounded-xs border border-line bg-surface p-4 shadow-2xl"
      >
        <h2 id={titleId} className="text-2xl">
          Be reborn as level 1?
        </h2>
        <ul className="flex flex-col gap-2 text-sm">
          <li>Reset: level, EXP, skills and skill points, quests, the level freeze.</li>
          <li>Kept: items, the rest of your Gold, pets, mounts, titles, guild and friends.</li>
          <li className="font-bold">{`Cost: ${grouped(priceGold)} Gold.`}</li>
        </ul>
        <div className="flex justify-end gap-2">
          <Button ref={cancel} variant="secondary" disabled={pending} onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={pending} onClick={onConfirm}>
            Be reborn
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
