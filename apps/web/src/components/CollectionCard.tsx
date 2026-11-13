import type { ReactNode } from 'react'
import { GameIcon } from './gm/GameIcon'

// The pieces shared by the pages that list game items with a preview beside them: mounts, pets, chakras and auras.

const CARD = 'flex w-full items-center gap-3 rounded-xs border bg-surface p-3 text-left'

export function SectionTitle({ title, count }: { title: string; count: number }) {
  return (
    <h2 className="mb-3 text-2xl">
      {title} <span className="text-base text-muted">{count}</span>
    </h2>
  )
}

/** An item's icon and name, with smaller lines under the name. */
function Summary({ icon, name, children }: { icon: number | null; name: string; children?: ReactNode }) {
  return (
    <>
      <GameIcon spriteId={icon} size={38} />
      <span className="min-w-0">
        <span className="block font-bold">{name}</span>
        {children}
      </span>
    </>
  )
}

type CardProps = { icon: number | null; name: string; children?: ReactNode }

/** A card that picks the item for the preview. */
export function PickCard({ selected, onPick, ...summary }: CardProps & { selected: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onPick}
      className={`${CARD} cursor-pointer hover:border-accent ${selected ? 'border-accent' : 'border-line'}`}
    >
      <Summary {...summary} />
    </button>
  )
}

/** A card with nothing to preview. */
export function StaticCard(summary: CardProps) {
  return (
    <div className={`${CARD} border-line`}>
      <Summary {...summary} />
    </div>
  )
}

/** The preview panel, sticky beside the list on wide screens. */
export function PreviewPanel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <aside aria-label={label} className="rounded-xs border border-line bg-surface p-3 lg:sticky lg:top-4 lg:order-2 lg:w-96 lg:shrink-0">
      {children}
    </aside>
  )
}

/** A list section with its preview: the preview sits on the right on wide screens and above the list on narrow ones. */
export function PreviewLayout({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-4 lg:flex-row lg:items-start">{children}</div>
}

export function CardList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul aria-label={label} className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2 lg:order-1">
      {children}
    </ul>
  )
}
