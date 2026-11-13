import {
  type AchievementReward,
  type AchievementRewardInput,
  achievementRewardSchema,
  COIN_SPRITES,
  MAIL_MAX_GOLD,
  MAIL_MAX_ITEMS,
} from '@4story-portal/shared'
import { useId, useState } from 'react'
import { itemDisplayName } from '../../lib/gm'
import { Button } from '../Button'
import { FormMessage } from '../FormMessage'
import { Coin } from './Coin'
import { GameIcon } from './GameIcon'
import { MailItemPicker } from './MailItemPicker'

type Props = {
  /** The level being edited, such as `Slayer III`. */
  name: string
  reward: AchievementReward | null
  saving: boolean
  /** The server's refusal of the last save. */
  error: string | null
  onSave: (reward: AchievementRewardInput) => void
  onCancel: () => void
}

/** `stack` is only known for an item picked just now; the API checks the others. */
type ItemRow = { itemId: number; name: string; icon: number | null; count: number; stack: number | null }

const COINS = [
  { key: 'gold', label: 'Rune', sprite: COIN_SPRITES.rune, max: MAIL_MAX_GOLD },
  { key: 'silver', label: 'Luna', sprite: COIN_SPRITES.luna, max: 999 },
  { key: 'copper', label: 'Cron', sprite: COIN_SPRITES.cron, max: 999 },
] as const

const field =
  'rounded-xs border border-line bg-surface-raised px-3 py-2 outline-none transition focus:border-accent focus:ring-1 focus:ring-accent'
const labelText = 'text-xs font-bold tracking-wider text-muted uppercase'

export function RewardEditor({ name, reward, saving, error, onSave, onCancel }: Props) {
  const id = useId()
  const [money, setMoney] = useState({
    gold: String(reward?.gold ?? 0),
    silver: String(reward?.silver ?? 0),
    copper: String(reward?.copper ?? 0),
  })
  const [items, setItems] = useState<ItemRow[]>(() => (reward?.items ?? []).map((item) => ({ ...item, stack: null })))
  const [picking, setPicking] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  // A number field the browser can't read (`1,000`, `5-`) reports an empty value, which must not save as 0.
  const [unreadable, setUnreadable] = useState<Partial<Record<(typeof COINS)[number]['key'], boolean>>>({})

  function submit(event: { preventDefault(): void }) {
    event.preventDefault()
    const bad = COINS.find((coin) => unreadable[coin.key])
    if (bad) return setProblem(`${bad.label}: Enter a whole number`)
    // A blank coin counts as 0, so only the ones that pay need typing.
    const amount = (value: string) => (value.trim() ? Number(value) : 0)
    const parsed = achievementRewardSchema.safeParse({
      gold: amount(money.gold),
      silver: amount(money.silver),
      copper: amount(money.copper),
      items: items.map(({ itemId, count }) => ({ itemId, count })),
    })
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const [first, index] = issue.path
      const label =
        first === 'items'
          ? (items[Number(index)]?.name ?? 'Items')
          : (COINS.find((coin) => coin.key === first)?.label ?? 'Reward')
      return setProblem(`${label}: ${issue.message}`)
    }
    setProblem(null)
    onSave(parsed.data)
  }

  return (
    // The messages below say what is wrong, in place of the browser's own bubbles.
    <form noValidate aria-label={`Reward for ${name}`} onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        {COINS.map(({ key, label, sprite, max }, index) => (
          <div key={key} className="flex flex-col gap-1">
            <label htmlFor={`${id}-${key}`} className={`flex items-center gap-1.5 ${labelText}`}>
              <Coin spriteId={sprite} />
              {label}
            </label>
            <input
              id={`${id}-${key}`}
              type="number"
              min={0}
              max={max}
              // Rune is where most rewards start, and typing replaces what was there.
              autoFocus={index === 0}
              onFocus={(event) => event.target.select()}
              value={money[key]}
              onChange={(event) => {
                const { value, validity } = event.target
                setMoney((current) => ({ ...current, [key]: value }))
                setUnreadable((current) => ({ ...current, [key]: validity.badInput }))
              }}
              className={`${field} w-24`}
            />
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <p className={labelText}>Items</p>
        {items.map((item, index) => (
          <div key={`${item.itemId}-${index}`} className="flex flex-wrap items-center gap-3">
            <GameIcon spriteId={item.icon} size={32} />
            <span className="min-w-0 flex-1 text-sm">
              {item.name} <span className="text-muted">#{item.itemId}</span>
            </span>
            <input
              type="number"
              aria-label={`Count for ${item.name}`}
              min={1}
              max={item.stack ?? 255}
              value={Number.isNaN(item.count) ? '' : item.count}
              onChange={(event) =>
                setItems((current) =>
                  current.map((row, i) => (i === index ? { ...row, count: event.target.valueAsNumber } : row)),
                )
              }
              className={`${field} w-24`}
            />
            <Button
              variant="secondary"
              size="sm"
              aria-label={`Remove item ${item.name}`}
              onClick={() => setItems((current) => current.filter((_, i) => i !== index))}
            >
              Remove
            </Button>
          </div>
        ))}
        {picking ? (
          // Enter in the search box must not save the reward.
          <div
            onKeyDown={(event) => {
              if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault()
            }}
          >
            <MailItemPicker
              onPick={(item) => {
                setItems((current) => [
                  ...current,
                  { itemId: item.itemId, name: itemDisplayName(item), icon: item.icon, count: 1, stack: Math.max(item.stack, 1) },
                ])
                setPicking(false)
              }}
              onClose={() => setPicking(false)}
            />
          </div>
        ) : (
          items.length < MAIL_MAX_ITEMS && (
            <div>
              <Button variant="secondary" size="sm" onClick={() => setPicking(true)}>
                Add item
              </Button>
            </div>
          )
        )}
      </div>

      <p className="text-xs text-muted">No coins and no items means this level pays nothing.</p>
      <FormMessage message={problem ?? error} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="secondary" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
