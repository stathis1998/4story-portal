import type { GmLocation } from '@4story-portal/shared'
import { useState } from 'react'
import { Button } from '../Button'

type Props = {
  locations: GmLocation[]
  onPick: (location: GmLocation) => void
  onDelete: (id: string) => void | Promise<void>
}

export function PresetsList({ locations, onPick, onDelete }: Props) {
  const [confirming, setConfirming] = useState<string | null>(null)

  if (locations.length === 0) return <p className="text-sm text-muted">No saved locations yet.</p>

  return (
    <ul className="flex flex-col gap-1">
      {locations.map((location) => (
        <li key={location.id} className="flex items-center justify-between gap-2">
          <Button variant="secondary" size="sm" onClick={() => onPick(location)}>
            {location.name}
          </Button>
          {confirming === location.id ? (
            <span className="flex items-center gap-2 text-sm">
              Delete?
              <Button
                size="sm"
                onClick={async () => {
                  await onDelete(location.id)
                  setConfirming(null)
                }}
              >
                Delete
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setConfirming(null)}>
                Cancel
              </Button>
            </span>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              aria-label={`Delete ${location.name}`}
              onClick={() => setConfirming(location.id)}
            >
              Delete
            </Button>
          )}
        </li>
      ))}
    </ul>
  )
}
