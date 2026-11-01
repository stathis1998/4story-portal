import type { GmVendor } from '@4story-portal/shared'
import { useState } from 'react'
import { vendorDisplayName } from '../../lib/gm'
import { Checkbox } from '../Checkbox'
import { GameIcon } from './GameIcon'

type Props = { vendors: GmVendor[]; selected?: number; onSelect: (id: number) => void }

export function VendorList({ vendors, selected, onSelect }: Props) {
  const [search, setSearch] = useState('')
  const [pvpOnly, setPvpOnly] = useState(false)
  const needle = search.trim().toLowerCase()
  const shown = vendors.filter(
    (vendor) =>
      (!pvpOnly || vendor.shop === 'pvp') &&
      (!needle ||
        vendor.name.toLowerCase().includes(needle) ||
        vendor.title.toLowerCase().includes(needle) ||
        String(vendor.id).includes(needle)),
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="vendor-search" className="text-xs font-bold tracking-wider text-muted uppercase">
          Search vendors
        </label>
        <input
          id="vendor-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          autoComplete="off"
          className="rounded-xs border border-line bg-surface-raised px-3 py-2 outline-none transition focus:border-accent focus:ring-1 focus:ring-accent"
        />
      </div>
      <Checkbox label="PvP shops only" checked={pvpOnly} onChange={(event) => setPvpOnly(event.target.checked)} />
      {shown.length === 0 && <p className="text-sm text-muted">No matching vendor.</p>}
      <ul className="flex flex-col gap-1">
        {shown.map((vendor) => (
          <li key={vendor.id}>
            <button
              type="button"
              onClick={() => onSelect(vendor.id)}
              aria-current={vendor.id === selected ? 'true' : undefined}
              className={`flex w-full items-center gap-3 rounded-xs border px-2 py-1.5 text-left transition hover:border-accent ${
                vendor.id === selected ? 'border-accent bg-surface-raised' : 'border-line bg-surface'
              }`}
            >
              <GameIcon spriteId={vendor.faceIcon} size={36} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-bold">{vendorDisplayName(vendor)}</span>
                {vendor.name && vendor.title && <span className="truncate text-xs text-muted">{vendor.title}</span>}
              </span>
              <span className="text-sm text-muted">{vendor.itemCount}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
