import type { HallCategory } from '@4story-portal/shared'
import { ordinal } from '../../lib/stats'

export function RankingCard({ category }: { category: Omit<HallCategory, 'id'> & { id: string } }) {
  const headingId = `ranking-${category.id}`
  return (
    <section aria-labelledby={headingId} className="rounded-xs border border-line bg-surface p-5">
      <h2 id={headingId} className="mb-3 text-2xl">
        {category.label}
      </h2>
      {category.entries.length === 0 ? (
        <p className="text-sm text-muted">Nobody yet.</p>
      ) : (
        <ol className="flex flex-col gap-2.5">
          {category.entries.map((entry) => (
            <li
              key={`${entry.place}-${entry.name}`}
              className={`flex items-center gap-3 ${entry.mine ? 'rounded-xs border-l-2 border-accent pl-2' : ''}`}
            >
              <span className="w-8 shrink-0 font-display text-accent-text">{ordinal(entry.place)}</span>
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-bold">
                  <span className="truncate">{entry.name}</span>
                  {entry.mine && <span className="rounded-xs border border-accent px-1.5 text-xs text-accent-text">You</span>}
                </p>
                <p className="text-xs text-muted">
                  {entry.className}, level {entry.level}
                </p>
              </div>
              <div className="ml-auto text-right">
                <p>{entry.display}</p>
                {entry.detail && <p className="text-xs text-muted">{entry.detail}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
      {category.you && (
        <p className="mt-3 border-t border-line pt-2 text-sm text-muted">
          You: {ordinal(category.you.place)}, {category.you.name}, {category.you.display}
        </p>
      )}
    </section>
  )
}
