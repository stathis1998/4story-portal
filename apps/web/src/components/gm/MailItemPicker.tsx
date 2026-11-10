import type { GmItemSearchResult } from '@4story-portal/shared'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { itemDisplayName, itemSearchQueryOptions } from '../../lib/gm'
import { Button } from '../Button'
import { FormMessage } from '../FormMessage'
import { GameIcon } from './GameIcon'

type Props = { onPick: (item: GmItemSearchResult) => void; onClose: () => void }

/** Item search for the mail composer. Prices are not shown, so it searches the money shop's view. */
export function MailItemPicker({ onPick, onClose }: Props) {
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 250)
    return () => clearTimeout(timer)
  }, [search])

  const results = useQuery({ ...itemSearchQueryOptions(query, 'money'), enabled: query !== '' })

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="mail-item-search" className="text-xs font-bold tracking-wider text-muted uppercase">
        Find an item
      </label>
      <div className="flex gap-2">
        <input
          id="mail-item-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          autoComplete="off"
          autoFocus
          className="min-w-0 flex-1 rounded-xs border border-line bg-surface-raised px-3 py-2 outline-none transition focus:border-accent focus:ring-1 focus:ring-accent"
        />
        <Button variant="secondary" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
      <FormMessage message={results.isError ? 'Could not search items.' : null} />
      {results.data && results.data.length === 0 && <p className="text-sm text-muted">No matching items.</p>}
      {results.data && results.data.length > 0 && (
        <ul className="flex flex-col gap-1">
          {results.data.map((item) => (
            <li key={item.itemId}>
              <Button
                variant="secondary"
                size="sm"
                className="flex w-full min-w-0 items-center gap-3 text-left"
                disabled={!item.inClient}
                onClick={() => onPick(item)}
              >
                <GameIcon spriteId={item.icon} size={32} />
                <span className="min-w-0 flex-1">
                  {itemDisplayName(item)}{' '}
                  <span className="font-normal text-muted">
                    #{item.itemId} · stacks to {Math.max(item.stack, 1)}
                  </span>
                </span>
                {!item.inClient && <span className="font-normal text-muted">Not in client</span>}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
