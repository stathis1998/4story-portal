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
  /** Below the `sm` breakpoint the tabs share one row in smaller type, scrolling sideways if they still do not fit. */
  oneRow?: boolean
}

const ROWS = '-mb-px px-4 text-sm tracking-wide focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-bg'
// A scrolling row clips what hangs outside it, so on a phone the focus ring is drawn inside the tab and the underline
// sits on the row's rule rather than over it.
const PHONE_ROW =
  'whitespace-nowrap px-2 text-xs focus-visible:inset-ring-2 focus-visible:inset-ring-accent-text sm:-mb-px sm:px-4 sm:text-sm sm:tracking-wide sm:focus-visible:inset-ring-0 sm:focus-visible:ring-2 sm:focus-visible:ring-offset-2 sm:focus-visible:ring-offset-bg'

export function Tabs({ tabs, active, onChange, label, disabled = false, oneRow = false }: Props) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})

  function onKeyDown(event: KeyboardEvent, index: number) {
    // A tab that kept the focus when the tabs were turned off still hears keys.
    if (disabled) return
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    event.preventDefault()
    const next = tabs[(index + step + tabs.length) % tabs.length]
    onChange(next.id)
    refs.current[next.id]?.focus()
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      className={`border-b border-line ${oneRow ? 'grid auto-cols-[minmax(max-content,1fr)] grid-flow-col overflow-x-auto sm:flex sm:gap-1 sm:overflow-visible' : 'flex flex-wrap gap-1'}`}
    >
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
            className={`py-2 font-display font-bold transition outline-none focus-visible:ring-accent-text disabled:cursor-not-allowed disabled:opacity-60 ${oneRow ? PHONE_ROW : ROWS} ${selected ? 'border-b-2 border-accent text-fg' : 'text-muted hover:text-fg'}`}
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
