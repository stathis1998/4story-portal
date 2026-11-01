import { BADGE_CATEGORIES, type BadgeView } from '@4story-portal/shared'
import { useState } from 'react'
import { formatDay } from '../../lib/stats'
import { Tabs } from '../Tabs'

function Tag({ children }: { children: string }) {
  return <span className="rounded-xs border border-accent px-1.5 text-xs text-accent-text">{children}</span>
}

// Earned first, and the rarest of those first, because they're the ones worth showing off. Coming soon
// ones go last, because nobody can do anything about them yet.
const sortOrder = (badge: BadgeView) => (badge.earned ? 0 : badge.comingSoon ? 2 : 1)

const earnedCount = (badges: BadgeView[]) => badges.filter((badge) => badge.earned).length
const earnable = (badges: BadgeView[]) => badges.filter((badge) => !badge.comingSoon)

function tabLabel(label: string, badges: BadgeView[]) {
  const total = earnable(badges).length
  return total ? `${label} ${earnedCount(badges)}/${total}` : label
}

function BadgeCard({ badge }: { badge: BadgeView }) {
  return (
    <li className={`rounded-xs border p-3 ${badge.earned ? 'border-line bg-surface' : 'border-dashed border-line opacity-60'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold">{badge.name}</span>
        {badge.comingSoon && <Tag>Coming soon</Tag>}
        {badge.isNew && <Tag>New</Tag>}
        {badge.firstToEarn && <Tag>First to earn</Tag>}
      </div>
      <p className="mt-1 text-sm text-muted">{badge.description}</p>
      {!badge.comingSoon && (
        <>
          <p className="mt-2 text-xs text-muted">
            Held by {badge.holders} of {badge.players} players
          </p>
          <p className="text-xs text-muted">
            {badge.firstSeen ? `Earned ${formatDay(badge.firstSeen)}` : badge.earned ? null : 'Not earned yet'}
          </p>
        </>
      )}
    </li>
  )
}

export function BadgeGrid({ badges }: { badges: BadgeView[] }) {
  const categories = BADGE_CATEGORIES.map(({ id, label }) => ({
    id,
    label,
    badges: badges.filter((badge) => badge.category === id),
  })).filter((category) => category.badges.length > 0)
  const [chosen, setChosen] = useState<string>()
  const active = categories.find((category) => category.id === chosen) ?? categories[0]
  const sorted = [...(active?.badges ?? [])].sort(
    (a, b) => sortOrder(a) - sortOrder(b) || (a.earned && b.earned ? a.holders - b.holders : 0),
  )

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 id="achievements-heading" className="text-2xl">
          Achievements
        </h2>
        <p className="text-sm text-muted">
          {earnedCount(badges)} of {earnable(badges).length} earned
        </p>
      </div>
      {active && (
        <>
          <Tabs
            tabs={categories.map(({ id, label, badges: inCategory }) => ({ id, label: tabLabel(label, inCategory) }))}
            active={active.id}
            onChange={setChosen}
          />
          <div role="tabpanel" id={`panel-${active.id}`} aria-labelledby={`tab-${active.id}`} className="mt-3">
            <ul aria-labelledby="achievements-heading" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {sorted.map((badge) => (
                <BadgeCard key={badge.id} badge={badge} />
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  )
}
