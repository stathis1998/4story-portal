import type { GmVendor, GmVendorItem } from '@4story-portal/shared'
import { fullStackOverflows } from '@4story-portal/shared'
import { useState } from 'react'
import { ApiError } from '../../lib/api'
import { itemDisplayName, priceNote, useRemoveVendorItem, useSetItemPrice, vendorDisplayName } from '../../lib/gm'
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

const th = 'px-3 py-2 text-left whitespace-nowrap text-xs font-bold tracking-wider text-muted uppercase'
const td = 'px-3 py-2'

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
  const shown = needle
    ? items.filter(
        (item) => itemDisplayName(item).toLowerCase().includes(needle) || `#${item.itemId}`.includes(needle),
      )
    : items

  async function save(item: GmVendorItem, amount: number) {
    setSaveError(null)
    try {
      const result = await setPrice.mutateAsync({
        itemId: item.itemId,
        currency: vendor.shop,
        amount,
      })
      setEditing(null)
      onNote(priceNote(itemDisplayName(item), result, vendor.shop))
    } catch (err) {
      setSaveError(errorMessage(err))
    }
  }

  async function removeItem(item: GmVendorItem) {
    setConfirming(null)
    setRemoveError(null)
    try {
      await remove.mutateAsync({ vendorId: vendor.id, itemId: item.itemId })
      onNote(`${itemDisplayName(item)} removed from ${vendorName}. Restart TMapSvr to apply.`)
    } catch (err) {
      setRemoveError(errorMessage(err))
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      {items.length > 0 && (
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
      )}
      <FormMessage message={removeError} />
      {items.length === 0 ? (
        <p className="rounded-xs border border-dashed border-line p-10 text-center text-muted">
          This vendor sells nothing yet.
        </p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted">No matching items.</p>
      ) : (
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
                const name = itemDisplayName(item)
                const icon = <GameIcon spriteId={item.icon} size={32} />
                const label = (
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span>
                      <span className={item.name ? '' : 'text-muted'}>{name}</span>
                      {item.name && <span className="ml-1.5 text-muted">#{item.itemId}</span>}
                    </span>
                    {!item.inClient && (
                      <span className="text-xs font-bold text-danger">
                        Not in client: crashes players opening this shop
                      </span>
                    )}
                    {fullStackOverflows(item.price, item.stack) && (
                      <span className="text-xs font-bold text-danger">
                        Buying a full stack costs almost nothing: lower this price.
                      </span>
                    )}
                  </span>
                )
                if (editing === item.itemId) {
                  return (
                    <tr key={item.itemId} className="border-b border-line last:border-b-0">
                      <td colSpan={5} className={td}>
                        <div className="mb-2 flex items-center gap-3">
                          {icon}
                          {label}
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
                        {label}
                      </span>
                    </td>
                    <td className={td}>{item.level}</td>
                    <td className={`${td} whitespace-nowrap`}>
                      <span data-testid="price">
                        {item.name === null ? '—' : <Price price={item.price} shop={vendor.shop} />}
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
                        <span className="flex items-center justify-end gap-2 whitespace-nowrap">
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
      )}
    </div>
  )
}
