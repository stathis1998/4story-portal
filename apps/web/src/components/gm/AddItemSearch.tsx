import type { GmVendor } from '@4story-portal/shared'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { ApiError } from '../../lib/api'
import { itemSearchQueryOptions, priceLabel, useAddVendorItem, vendorDisplayName } from '../../lib/gm'
import { Button } from '../Button'
import { FormMessage } from '../FormMessage'
import { GameIcon } from './GameIcon'

type Props = {
  vendor: GmVendor
  soldItemIds: ReadonlySet<number>
  onNote: (note: string) => void
}

const errorMessage = (err: unknown) =>
  err instanceof ApiError && err.status < 500 ? err.message : 'Something went wrong. Please try again.'

export function AddItemSearch({ vendor, soldItemIds, onNote }: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const add = useAddVendorItem()

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 250)
    return () => clearTimeout(timer)
  }, [search])

  const results = useQuery({ ...itemSearchQueryOptions(query), enabled: open && query !== '' })

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
      onNote(
        `${row.name ?? `Item #${itemId}`} added to ${vendorDisplayName(vendor)}. Restart TMapSvr to apply.` +
          (row.price === 0 ? ' It is free in this shop until you set a price.' : ''),
      )
    } catch (err) {
      setAddError(errorMessage(err))
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
          onChange={(event) => setSearch(event.target.value)}
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
            const reason = soldItemIds.has(found.itemId) ? 'Already sold' : found.inClient ? null : 'Not in client'
            return (
              <li key={found.itemId}>
                <Button
                  variant="secondary"
                  size="sm"
                  className="flex w-full items-center gap-3 text-left"
                  disabled={reason !== null || add.isPending}
                  onClick={() => void addItem(found.itemId)}
                >
                  <GameIcon spriteId={found.icon} size={32} />
                  <span className="min-w-0 flex-1">
                    {found.name} <span className="font-normal text-muted">#{found.itemId} · Lv {found.level}</span>
                  </span>
                  <span className="font-normal text-muted">
                    {reason ?? priceLabel(vendor.shop === 'pvp' ? found.pvpPrice : found.price, vendor.shop)}
                  </span>
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
