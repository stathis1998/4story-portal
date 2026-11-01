import type { GmVendor, GmVendorItem } from '@4story-portal/shared'
import { useState } from 'react'
import { ApiError } from '../../lib/api'
import { priceText, useRemoveVendorItem, useSetItemPrice, vendorDisplayName } from '../../lib/gm'
import { Button } from '../Button'
import { FormMessage } from '../FormMessage'
import { GameIcon } from './GameIcon'
import { Price } from './Price'
import { PriceEditor } from './PriceEditor'

type Props = {
  vendor: GmVendor
  items: GmVendorItem[]
  onNote: (note: string) => void
}

const th = 'px-3 py-2 text-left text-xs font-bold tracking-wider text-muted uppercase'
const td = 'px-3 py-2'

const itemName = (item: GmVendorItem) => item.name ?? `Unknown item #${item.itemId}`
const errorMessage = (err: unknown) =>
  err instanceof ApiError && err.status < 500 ? err.message : 'Something went wrong. Please try again.'

export function VendorItemsTable({ vendor, items, onNote }: Props) {
  const [filter, setFilter] = useState('')
  const [editing, setEditing] = useState<number | null>(null)
  const [confirming, setConfirming] = useState<number | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const setPrice = useSetItemPrice()
  const remove = useRemoveVendorItem()
  const vendorName = vendorDisplayName(vendor)

  const needle = filter.trim().toLowerCase()
  const shown = needle ? items.filter((item) => itemName(item).toLowerCase().includes(needle)) : items

  async function save(item: GmVendorItem, amount: number) {
    setSaveError(null)
    try {
      const result = await setPrice.mutateAsync({
        itemId: item.itemId,
        currency: vendor.shop,
        amount,
      })
      setEditing(null)
      const vendors = `${result.soldBy} ${result.soldBy === 1 ? 'vendor' : 'vendors'}`
      onNote(
        result.price === 0
          ? `${itemName(item)} is now free at ${vendors}. Restart TMapSvr to apply.`
          : `${itemName(item)} now costs ${priceText(result.price, vendor.shop)} at ${vendors}. Restart TMapSvr to apply.`,
      )
    } catch (err) {
      setSaveError(errorMessage(err))
    }
  }

  async function removeItem(item: GmVendorItem) {
    setConfirming(null)
    setRemoveError(null)
    try {
      await remove.mutateAsync({ vendorId: vendor.id, itemId: item.itemId })
      onNote(`${itemName(item)} removed from ${vendorName}. Restart TMapSvr to apply.`)
    } catch (err) {
      setRemoveError(errorMessage(err))
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="stock-filter" className="text-xs font-bold tracking-wider text-muted uppercase">
          Filter stock
        </label>
        <input
          id="stock-filter"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          autoComplete="off"
          className="rounded-xs border border-line bg-surface-raised px-3 py-2 outline-none transition focus:border-accent focus:ring-1 focus:ring-accent"
        />
      </div>
      <FormMessage message={removeError} />
      <div className="overflow-x-auto rounded-xs border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-line">
            <tr>
              <th className={th}>Item</th>
              <th className={th}>Lv</th>
              <th className={th}>Price</th>
              <th className={th}>Sold by</th>
              <th className={th} aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {shown.map((item) => {
              const name = itemName(item)
              const icon = <GameIcon spriteId={item.icon} size={32} />
              if (editing === item.itemId) {
                return (
                  <tr key={item.itemId} className="border-b border-line last:border-b-0">
                    <td colSpan={5} className={td}>
                      <div className="mb-2 flex items-center gap-3">
                        {icon}
                        <span>{name}</span>
                      </div>
                      <PriceEditor
                        item={item}
                        shop={vendor.shop}
                        saving={setPrice.isPending}
                        error={saveError}
                        onSave={(amount) => void save(item, amount)}
                        onCancel={() => setEditing(null)}
                      />
                    </td>
                  </tr>
                )
              }
              return (
                <tr key={item.itemId} className="border-b border-line last:border-b-0">
                  <td className={td}>
                    <span className="flex items-center gap-3">
                      {icon}
                      <span className={item.name ? '' : 'text-muted'}>{name}</span>
                    </span>
                  </td>
                  <td className={td}>{item.level}</td>
                  <td className={`${td} whitespace-nowrap`}>
                    <span data-testid="price">
                      <Price price={item.price} shop={vendor.shop} />
                    </span>
                  </td>
                  <td className={td}>{item.soldBy}</td>
                  <td className={`${td} text-right`}>
                    {confirming === item.itemId ? (
                      <span className="flex flex-wrap items-center justify-end gap-2">
                        Remove {name} from {vendorName}?
                        <Button size="sm" onClick={() => void removeItem(item)}>
                          Remove
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => setConfirming(null)}>
                          Cancel
                        </Button>
                      </span>
                    ) : (
                      <span className="flex flex-wrap items-center justify-end gap-2">
                        {item.name !== null && item.base === 0 && (
                          <span className="text-muted">Price can't be set: level 0 item</span>
                        )}
                        {item.name !== null && item.base !== 0 && (
                          <Button
                            variant="secondary"
                            size="sm"
                            aria-label={`Edit price of ${name}`}
                            onClick={() => {
                              setSaveError(null)
                              setConfirming(null)
                              setEditing(item.itemId)
                            }}
                          >
                            Edit
                          </Button>
                        )}
                        <Button
                          variant="secondary"
                          size="sm"
                          aria-label={`Remove ${name}`}
                          onClick={() => {
                            setEditing(null)
                            setConfirming(item.itemId)
                          }}
                        >
                          Remove
                        </Button>
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
