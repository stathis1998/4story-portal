import type { GmVendorItem, VendorShop } from '@4story-portal/shared'
import {
  MAX_PRICE,
  chargedPrice,
  joinMoney,
  multiplierForPrice,
  sellBackPrice,
  splitMoney,
} from '@4story-portal/shared'
import { useState } from 'react'
import { priceText } from '../../lib/gm'
import { Button } from '../Button'
import { FormMessage } from '../FormMessage'

type Props = {
  item: GmVendorItem
  shop: VendorShop
  saving: boolean
  error: string | null
  onSave: (amount: number) => void
  onCancel: () => void
}

const fieldClass =
  'w-28 rounded-xs border border-line bg-surface-raised px-3 py-2 outline-none transition focus:border-accent focus:ring-1 focus:ring-accent'

export function PriceEditor({ item, shop, saving, error, onSave, onCancel }: Props) {
  const [values, setValues] = useState<Record<string, string>>((): Record<string, string> => {
    if (shop === 'pvp') return { points: String(item.price) }
    const { rune, luna, cron } = splitMoney(item.price)
    return { rune: String(rune), luna: String(luna), cron: String(cron) }
  })
  const fields =
    shop === 'pvp'
      ? [{ key: 'points', label: 'PvP points' }]
      : [
          { key: 'rune', label: 'Rune' },
          { key: 'luna', label: 'Luna' },
          { key: 'cron', label: 'Cron' },
        ]

  // A blank field counts as 0.
  const parts = fields.map(({ key }) => (values[key]?.trim() ? Number(values[key]) : 0))
  const valid = parts.every((part) => Number.isInteger(part) && part >= 0)
  const amount = !valid
    ? null
    : shop === 'pvp'
      ? parts[0]
      : joinMoney({ rune: parts[0], luna: parts[1], cron: parts[2] })
  const usable = amount !== null && amount <= MAX_PRICE
  const canSave = usable && amount !== item.price && !saving
  const charged = usable ? chargedPrice(item.base, multiplierForPrice(item.base, amount)) : null

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (canSave) onSave(amount)
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        {fields.map(({ key, label }) => (
          <div key={key} className="flex flex-col gap-1">
            <label htmlFor={`price-${key}`} className="text-xs font-bold tracking-wider text-muted uppercase">
              {label}
            </label>
            <input
              id={`price-${key}`}
              type="number"
              min="0"
              value={values[key]}
              onChange={(event) => setValues({ ...values, [key]: event.target.value })}
              className={fieldClass}
            />
          </div>
        ))}
        <Button type="submit" size="sm" disabled={!canSave}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="secondary" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
      <div className="flex flex-wrap gap-x-2 text-sm text-muted">
        {shop === 'money' && usable && <p>Sells back for {priceText(sellBackPrice(charged!), shop)}.</p>}
        {item.soldBy > 1 && <p>Sold by {item.soldBy} vendors: this changes all of them.</p>}
      </div>
      {usable && charged !== amount && (
        <p className="text-sm font-bold text-accent-text">Will charge {priceText(charged!, shop)}</p>
      )}
      <FormMessage message={error} />
    </form>
  )
}
