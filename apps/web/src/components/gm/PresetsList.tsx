import type { GmLocation } from '@4story-portal/shared'
import { useState } from 'react'
import { Button } from '../Button'
import { FormMessage } from '../FormMessage'

type Props = {
  locations: GmLocation[]
  /** Set when the list could not be loaded, so an empty list is not mistaken for no presets. */
  loadError?: string | null
  onPick: (location: GmLocation) => void
  /** Resolves to an error message to show, or null once deleted. */
  onDelete: (id: string) => Promise<string | null>
}

export function PresetsList({ locations, loadError, onPick, onDelete }: Props) {
  const [confirming, setConfirming] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (loadError) return <FormMessage message={loadError} />
  if (locations.length === 0) return <p className="text-sm text-muted">No saved locations yet.</p>

  return (
    <div className="flex flex-col gap-2">
    <FormMessage message={error} />
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
                  const message = await onDelete(location.id)
                  setError(message)
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
              onClick={() => {
                setError(null)
                setConfirming(location.id)
              }}
            >
              Delete
            </Button>
          )}
        </li>
      ))}
    </ul>
    </div>
  )
}
