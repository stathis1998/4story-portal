import type { Character, CharacterStats } from '@4story-portal/shared'
import { Link } from '@tanstack/react-router'
import { LevelProgress } from './stats/LevelProgress'

const number = (value: number) => value.toLocaleString('en-US')

// The game stores server-local times without a zone and the API sends them as UTC, so showing
// them in UTC displays exactly what the server recorded.
const date = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    : '—'

type Props = {
  character: Character
  /** Absent while the stats load, or if they failed. */
  stats?: CharacterStats
  /** Links the name to the character's page. Needs the router. */
  linked?: boolean
}

export function CharacterCard({ character, stats, linked = false }: Props) {
  const { id, name, level, className, race, country, money, mapId, lastLogoutAt } = character

  return (
    <article className="flex flex-col gap-4 rounded-xs border border-l-[3px] border-line border-l-accent bg-surface p-5 transition hover:bg-surface-raised">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl leading-tight">
            {linked ? (
              <Link to="/characters/$id" params={{ id: String(id) }} className="hover:underline">
                {name}
              </Link>
            ) : (
              name
            )}
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            <span>{className}</span> · <span>{race}</span>
          </p>
        </div>
        <span className="shrink-0 rounded-xs border border-accent px-2 py-0.5 font-display text-sm tracking-wider text-accent-text">
          Lv. {level}
        </span>
      </header>

      {stats && (
        <div className="flex flex-col gap-1.5">
          {stats.progress !== null && <LevelProgress progress={stats.progress} />}
          <p className="text-xs text-muted">{number(stats.hoursPlayed)} h played</p>
        </div>
      )}

      <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-5 gap-y-1.5 text-sm">
        <dt className="text-xs tracking-wider text-muted uppercase">Country</dt>
        <dd>{country}</dd>
        <dt className="text-xs tracking-wider text-muted uppercase">Location</dt>
        <dd>Map {mapId}</dd>
        <dt className="text-xs tracking-wider text-muted uppercase">Last seen</dt>
        <dd data-testid="last-logout">{date(lastLogoutAt)}</dd>
      </dl>

      <div className="flex gap-5 border-t border-line pt-3 text-sm">
        <Coin label="gold" value={number(money.gold)} tone="bg-amber-400" />
        <Coin label="silver" value={number(money.silver)} tone="bg-stone-300" />
        <Coin label="copper" value={number(money.copper)} tone="bg-orange-700" />
      </div>
    </article>
  )
}

function Coin({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <span className="flex items-center gap-2" title={label}>
      <span aria-hidden className={`size-2 rotate-45 ${tone}`} />
      <span>{value}</span>
      <span className="sr-only">{label}</span>
    </span>
  )
}
