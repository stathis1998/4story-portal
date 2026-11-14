import { useRef } from 'react'
import type { KeyboardEvent } from 'react'

type Props = {
  /** `note` is a word shown beside the label, such as 'Closed'. */
  tabs: { id: string; label: string; note?: string }[]
  active: string
  onChange(id: string): void
  /** What the tabs choose between, for screen readers. */
  label?: string
  disabled?: boolean
}

export function Tabs({ tabs, active, onChange, label, disabled = false }: Props) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})

  function onKeyDown(event: KeyboardEvent, index: number) {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    event.preventDefault()
    const next = tabs[(index + step + tabs.length) % tabs.length]
    onChange(next.id)
    refs.current[next.id]?.focus()
  }

  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-1 border-b border-line">
      {tabs.map((tab, index) => {
        const selected = tab.id === active
        return (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[tab.id] = el
            }}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`panel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={`-mb-px px-4 py-2 font-display text-sm font-bold tracking-wide transition outline-none focus-visible:ring-2 focus-visible:ring-accent-text focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-60 ${selected ? 'border-b-2 border-accent text-fg' : 'text-muted hover:text-fg'}`}
          >
            {tab.label}
            {tab.note && (
              <>
                {' '}
                <span className="ml-1 text-xs font-normal tracking-wider text-muted uppercase">{tab.note}</span>
              </>
            )}
          </button>
        )
      })}
    </div>
  )
}
