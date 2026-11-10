import type { ReactNode } from 'react'

export type TooltipRow = { label: string; value: string; color?: string }

/** Values lead, labels follow; a short line keys each row to its series. */
export function ChartTooltip({ title, rows, left }: { title: string; rows: TooltipRow[]; left: number }) {
  return (
    <div
      role="presentation"
      className="pointer-events-none absolute top-0 z-10 w-48 -translate-x-1/2 rounded-xs border border-line bg-surface-raised px-3 py-2 text-sm shadow-lg"
      style={{ left }}
    >
      <p className="mb-1 font-bold">{title}</p>
      {rows.map((row) => (
        <p key={row.label} className="flex items-center gap-2">
          {row.color && <span aria-hidden className="h-0.5 w-3 shrink-0" style={{ background: row.color }} />}
          <span className="font-bold">{row.value}</span>
          <span className="text-muted">{row.label}</span>
        </p>
      ))}
    </div>
  )
}

export function Legend({ items }: { items: { label: string; swatch: ReactNode }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          {item.swatch}
          {item.label}
        </li>
      ))}
    </ul>
  )
}

export function RectSwatch({ color }: { color: string }) {
  return <span aria-hidden className="size-3 rounded-[3px]" style={{ background: color }} />
}
