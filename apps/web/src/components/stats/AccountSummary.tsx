import type { PlayerOverview } from '@4story-portal/shared'
import { ActivityCalendar } from './ActivityCalendar'

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <p className="font-display text-3xl text-accent-text">{value.toLocaleString('en-US')}</p>
      <p className="text-xs tracking-wider text-muted uppercase">{label}</p>
    </div>
  )
}

export function AccountSummary({ overview }: { overview: PlayerOverview }) {
  return (
    <section aria-labelledby="journey-heading" className="mb-8 rounded-xs border border-line bg-surface p-5">
      <h2 id="journey-heading" className="text-2xl">
        Your journey
      </h2>
      <div className="mt-4 flex flex-wrap gap-x-10 gap-y-4">
        <Stat value={overview.hoursPlayed} label="Hours played" />
        <Stat value={overview.daysPlayed} label="Days played" />
        <Stat value={overview.currentStreak} label="Day streak" />
        <Stat value={overview.longestStreak} label="Best streak" />
      </div>
      <div className="mt-5">
        <ActivityCalendar today={overview.today} activity={overview.activity} />
      </div>
      <p className="mt-3 text-xs text-muted">
        Updated when a character's session is saved. At most 12 hours of one session count, so idle time doesn't.
      </p>
    </section>
  )
}
