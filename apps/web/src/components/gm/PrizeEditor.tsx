import { type GmWheelPrize, WHEEL_MAX_WEIGHT, type WheelPrizeInput, wheelPrizeSchema } from '@4story-portal/shared'
import { useId, useState } from 'react'
import { Checkbox } from '../Checkbox'
import { RewardEditor } from './RewardEditor'

type Props = {
  /** The prize being changed, or null for a new one. */
  prize: GmWheelPrize | null
  /** Where a new prize goes on the wheel: after the last one. */
  nextOrder: number
  saving: boolean
  /** The server's refusal of the last save. */
  error: string | null
  onSave: (prize: WheelPrizeInput) => void
  onCancel: () => void
}

const field =
  'rounded-xs border border-line bg-surface-raised px-3 py-2 outline-none transition focus:border-accent focus:ring-1 focus:ring-accent'
const labelText = 'text-xs font-bold tracking-wider text-muted uppercase'
const LABELS: Record<string, string> = { name: 'Name', weight: 'Weight', order: 'Position' }

/** One prize of the wheel: its name, weight, place and flags, and below them the reward it pays. */
export function PrizeEditor({ prize, nextOrder, saving, error, onSave, onCancel }: Props) {
  const id = useId()
  const [name, setName] = useState(prize?.name ?? '')
  const [weight, setWeight] = useState(String(prize?.weight ?? 10))
  const [order, setOrder] = useState(String(prize?.order ?? nextOrder))
  const [enabled, setEnabled] = useState(prize?.enabled ?? true)
  const [announce, setAnnounce] = useState(prize?.announce ?? false)
  const [problem, setProblem] = useState<string | null>(null)

  return (
    <RewardEditor
      name={prize?.name ?? 'new prize'}
      label={prize ? `Prize ${prize.name}` : 'New prize'}
      reward={prize?.reward ?? null}
      saving={saving}
      error={problem ?? error}
      emptyNote="No coins and no items makes this a no luck segment: it uses up the spin and sends nothing."
      onCancel={onCancel}
      onSave={(reward) => {
        // A blank number must not save as 0.
        const whole = (value: string) => (value.trim() ? Number(value) : Number.NaN)
        const parsed = wheelPrizeSchema.safeParse({ ...reward, name, weight: whole(weight), order: whole(order), enabled, announce })
        if (!parsed.success) {
          const issue = parsed.error.issues[0]
          const label = LABELS[String(issue.path[0])] ?? 'Prize'
          return setProblem(`${label}: ${issue.code === 'invalid_type' ? 'Enter a whole number' : issue.message}`)
        }
        setProblem(null)
        onSave(parsed.data)
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
          <label htmlFor={`${id}-name`} className={labelText}>
            Name
          </label>
          <input
            id={`${id}-name`}
            type="text"
            maxLength={40}
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={field}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-weight`} className={labelText}>
            Weight
          </label>
          <input
            id={`${id}-weight`}
            type="number"
            min={1}
            max={WHEEL_MAX_WEIGHT}
            value={weight}
            onChange={(event) => setWeight(event.target.value)}
            className={`${field} w-24`}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-order`} className={labelText}>
            Position
          </label>
          <input
            id={`${id}-order`}
            type="number"
            min={0}
            value={order}
            onChange={(event) => setOrder(event.target.value)}
            className={`${field} w-24`}
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <Checkbox label="On the wheel" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
        <Checkbox label="Announce a win in the game" checked={announce} onChange={(event) => setAnnounce(event.target.checked)} />
      </div>
    </RewardEditor>
  )
}
