import type { GmDestination } from '@4story-portal/shared'
import { useState } from 'react'
import { Button } from '../Button'

type Props = {
  destinations: GmDestination[]
  mapNames: ReadonlyMap<number, string>
  onPick: (destination: GmDestination) => void
}

const MAX_RESULTS = 8

export function DestinationSearch({ destinations, mapNames, onPick }: Props) {
  const [search, setSearch] = useState('')
  const needle = search.trim().toLowerCase()
  const matches = needle ? destinations.filter((place) => place.name.toLowerCase().includes(needle)) : []

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="destination-search" className="text-xs font-bold tracking-wider text-muted uppercase">
        Find a destination
      </label>
      <input
        id="destination-search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        autoComplete="off"
        className="rounded-xs border border-line bg-surface-raised px-3 py-2 outline-none transition focus:border-accent focus:ring-1 focus:ring-accent"
      />
      {needle && matches.length === 0 && <p className="text-sm text-muted">No matching destination.</p>}
      {matches.length > 0 && (
        <ul className="flex flex-col gap-1">
          {matches.slice(0, MAX_RESULTS).map((place) => (
            <li key={`${place.mapId}|${place.name}`}>
              <Button
                variant="secondary"
                size="sm"
                className="flex w-full justify-between gap-3 text-left"
                onClick={() => {
                  onPick(place)
                  setSearch('')
                }}
              >
                <span>{place.name}</span>
                <span className="font-normal text-muted">{mapNames.get(place.mapId)}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
      {matches.length > MAX_RESULTS && (
        <p className="text-sm text-muted">
          Showing {MAX_RESULTS} of {matches.length}. Keep typing to narrow it down.
        </p>
      )}
    </div>
  )
}
