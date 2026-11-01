import type { BadgeView } from '@4story-portal/shared'
import { formatDay } from '../../lib/stats'

function Tag({ children }: { children: string }) {
  return <span className="rounded-xs border border-accent px-1.5 text-xs text-accent-text">{children}</span>
}

export function BadgeGrid({ badges }: { badges: BadgeView[] }) {
  // Earned first, and the rarest of those first, because they're the ones worth showing off.
  const sorted = [...badges].sort((a, b) => Number(b.earned) - Number(a.earned) || (b.earned ? a.holders - b.holders : 0))
  const earned = badges.filter((badge) => badge.earned).length

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 id="achievements-heading" className="text-2xl">
          Achievements
        </h2>
        <p className="text-sm text-muted">
          {earned} of {badges.length} earned
        </p>
      </div>
      <ul aria-labelledby="achievements-heading" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map((badge) => (
          <li
            key={badge.id}
            className={`rounded-xs border p-3 ${badge.earned ? 'border-line bg-surface' : 'border-dashed border-line opacity-60'}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold">{badge.name}</span>
              {badge.isNew && <Tag>New</Tag>}
              {badge.firstToEarn && <Tag>First to earn</Tag>}
            </div>
            <p className="mt-1 text-sm text-muted">{badge.description}</p>
            <p className="mt-2 text-xs text-muted">
              Held by {badge.holders} of {badge.players} players
            </p>
            <p className="text-xs text-muted">
              {badge.firstSeen ? `Earned ${formatDay(badge.firstSeen)}` : badge.earned ? null : 'Not earned yet'}
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}
