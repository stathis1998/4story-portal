import type { GmItemSearchResult, GmVendor } from '@4story-portal/shared'
import { fullStackOverflows } from '@4story-portal/shared'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { ApiError } from '../../lib/api'
import {
  itemDisplayName,
  itemSearchQueryOptions,
  priceNote,
  useAddVendorItem,
  useSetItemPrice,
  vendorDisplayName,
} from '../../lib/gm'
import { Button } from '../Button'
import { FormMessage } from '../FormMessage'
import { GameIcon } from './GameIcon'
import { Price } from './Price'
import { PriceEditor } from './PriceEditor'

type Props = {
  vendor: GmVendor
  soldItemIds: ReadonlySet<number>
  onNote: (note: string) => void
}

const TOO_HIGH = 'Price too high for a full stack'

const errorMessage = (err: unknown) =>
  err instanceof ApiError && err.status < 500 ? err.message : 'Something went wrong. Please try again.'

export function AddItemSearch({ vendor, soldItemIds, onNote }: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [pricing, setPricing] = useState<number | null>(null)
  const [priceError, setPriceError] = useState<string | null>(null)
  const add = useAddVendorItem()
  const setPrice = useSetItemPrice()

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 250)
    return () => clearTimeout(timer)
  }, [search])

  const results = useQuery({ ...itemSearchQueryOptions(query, vendor.shop), enabled: open && query !== '' })

  if (!open) {
    return (
      <div className="mt-4">
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          + Add item
        </Button>
      </div>
    )
  }

  async function addItem(itemId: number) {
    setAddError(null)
    try {
      const row = await add.mutateAsync({ vendorId: vendor.id, itemId })
      const added = `${itemDisplayName(row)} added to ${vendorDisplayName(vendor)}.`
      onNote(
        row.base === 0
          ? `${added} It is always free in this shop, because its level has no price. Restart TMapSvr to apply.`
          : `${added} Restart TMapSvr to apply.` +
              (row.price === 0 ? ' It is free in this shop until you set a price.' : ''),
      )
    } catch (err) {
      setAddError(errorMessage(err))
    }
  }

  async function savePrice(found: GmItemSearchResult, amount: number) {
    setPriceError(null)
    try {
      const result = await setPrice.mutateAsync({ itemId: found.itemId, currency: vendor.shop, amount })
      setPricing(null)
      onNote(priceNote(itemDisplayName(found), result, vendor.shop))
    } catch (err) {
      setPriceError(errorMessage(err))
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-1.5">
      <label htmlFor="add-item-search" className="text-xs font-bold tracking-wider text-muted uppercase">
        Find an item
      </label>
      <div className="flex gap-2">
        <input
          id="add-item-search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            setPricing(null)
          }}
          autoComplete="off"
          autoFocus
          className="min-w-0 flex-1 rounded-xs border border-line bg-surface-raised px-3 py-2 outline-none transition focus:border-accent focus:ring-1 focus:ring-accent"
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setOpen(false)
            setSearch('')
            setQuery('')
            setAddError(null)
            setPricing(null)
          }}
        >
          Close
        </Button>
      </div>
      <FormMessage message={addError ?? (results.isError ? 'Could not search items.' : null)} />
      {results.data && results.data.length === 0 && <p className="text-sm text-muted">No matching items.</p>}
      {results.data && results.data.length > 0 && (
        <ul className="flex flex-col gap-1">
          {results.data.map((found) => {
            const reason = soldItemIds.has(found.itemId)
              ? 'Already sold'
              : !found.inClient
                ? 'Not in client'
                : fullStackOverflows(found.price, found.stack)
                  ? TOO_HIGH
                  : null
            const name = itemDisplayName(found)
            return (
              <li key={found.itemId} className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    disabled={reason !== null || add.isPending}
                    onClick={() => void addItem(found.itemId)}
                  >
                    <GameIcon spriteId={found.icon} size={32} />
                    <span className="min-w-0 flex-1">
                      {name}{' '}
                      <span className="font-normal text-muted">
                        {found.name && `#${found.itemId} · `}Lv {found.level}
                      </span>
                    </span>
                    <span className="font-normal text-muted">
                      {reason ?? (found.base === 0 ? 'Always free' : <Price price={found.price} shop={vendor.shop} />)}
                    </span>
                  </Button>
                  {reason === TOO_HIGH && (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="whitespace-nowrap"
                      aria-label={`Set price of ${name}`}
                      onClick={() => {
                        setPriceError(null)
                        setPricing(pricing === found.itemId ? null : found.itemId)
                      }}
                    >
                      Set price
                    </Button>
                  )}
                </div>
                {pricing === found.itemId && (
                  <PriceEditor
                    item={found}
                    shop={vendor.shop}
                    saving={setPrice.isPending}
                    error={priceError}
                    onSave={(amount) => void savePrice(found, amount)}
                    onCancel={() => setPricing(null)}
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
