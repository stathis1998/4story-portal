import type { GmVendorItem, VendorShop } from '@4story-portal/shared'
import {
  COIN_SPRITES,
  MAX_PRICE,
  chargedPrice,
  fullStackOverflows,
  joinMoney,
  multiplierForPrice,
  sellBackPrice,
  splitMoney,
} from '@4story-portal/shared'
import { useId, useState } from 'react'
import { priceText, vendorCount } from '../../lib/gm'
import { Button } from '../Button'
import { FormMessage } from '../FormMessage'
import { Coin } from './Coin'
import { Price } from './Price'

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
  // The stock table and the add search can each have an editor open.
  const id = useId()
  const [values, setValues] = useState<Record<string, string>>((): Record<string, string> => {
    if (shop === 'pvp') return { points: String(item.price) }
    const { gold, silver, bronze } = splitMoney(item.price)
    return { gold: String(gold), silver: String(silver), bronze: String(bronze) }
  })
  const fields =
    shop === 'pvp'
      ? [{ key: 'points', label: 'PvP points', sprite: null }]
      : [
          { key: 'gold', label: 'Gold', sprite: COIN_SPRITES.gold },
          { key: 'silver', label: 'Silver', sprite: COIN_SPRITES.silver },
          { key: 'bronze', label: 'Bronze', sprite: COIN_SPRITES.bronze },
        ]

  // A blank field counts as 0, but all of them blank is no price at all.
  const allBlank = fields.every(({ key }) => !values[key]?.trim())
  const parts = fields.map(({ key }) => (values[key]?.trim() ? Number(values[key]) : 0))
  const valid = parts.every((part) => Number.isInteger(part) && part >= 0)
  const amount = !valid || allBlank
    ? null
    : shop === 'pvp'
      ? parts[0]
      : joinMoney({ gold: parts[0], silver: parts[1], bronze: parts[2] })
  const usable = amount !== null && amount <= MAX_PRICE
  const charged = usable ? chargedPrice(item.base, multiplierForPrice(item.base, amount)) : null
  // The API checks both, so a typed amount the float rounds down is refused here too.
  const overflows = usable && (fullStackOverflows(amount, item.stack) || fullStackOverflows(charged!, item.stack))
  const fits = usable && !overflows
  const canSave = fits && amount !== item.price && !saving

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (canSave) onSave(amount)
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        {fields.map(({ key, label, sprite }) => (
          <div key={key} className="flex flex-col gap-1">
            <label
              htmlFor={`${id}-${key}`}
              className="flex items-center gap-1.5 text-xs font-bold tracking-wider text-muted uppercase"
            >
              {sprite !== null && <Coin spriteId={sprite} />}
              {label}
            </label>
            <input
              id={`${id}-${key}`}
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
        {shop === 'money' && !item.canSellBack && <p>Can't be sold to vendors.</p>}
        {shop === 'money' && item.canSellBack && fits && (
          <p>
            {sellBackPrice(charged!) === 0 ? (
              'Sells back for nothing.'
            ) : (
              <>
                Sells back for <Price price={sellBackPrice(charged!)} shop={shop} />
              </>
            )}
          </p>
        )}
        {item.soldBy > 1 && <p>Sold by {item.soldBy} vendors: this changes all of them.</p>}
      </div>
      {fits && charged !== amount && (
        <p className="text-sm font-bold text-accent-text">
          Will charge <Price price={charged!} shop={shop} />
        </p>
      )}
      {amount === 0 && item.price !== 0 && (
        <p className="text-sm font-bold text-accent-text">Will be free at {vendorCount(item.soldBy)}.</p>
      )}
      {amount !== null && !usable && (
        <p className="text-sm text-danger">
          Too high: the most a price can be is {priceText(MAX_PRICE, shop)}.
        </p>
      )}
      {overflows && (
        <p className="text-sm text-danger">
          Too high: buying a full stack of {Math.max(item.stack, 1)} would overflow.
        </p>
      )}
      <FormMessage message={error} />
    </form>
  )
}
