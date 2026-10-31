import type { Character } from '@4story-portal/shared'

const number = (value: number) => value.toLocaleString('en-US')

// The game stores server-local times without a zone and the API sends them as UTC, so showing
// them in UTC displays exactly what the server recorded.
const date = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    : '—'

export function CharacterCard({ character }: { character: Character }) {
  const { name, level, className, race, country, money, mapId, lastLogoutAt } = character

  return (
    <article className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5 transition hover:border-accent/60">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl">{name}</h2>
          <p className="mt-1 text-sm text-muted">
            <span>{className}</span> · <span>{race}</span>
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-accent px-2.5 py-1 text-xs font-semibold text-accent-fg">
          Lv. {level}
        </span>
      </header>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted">Country</dt>
        <dd>{country}</dd>
        <dt className="text-muted">Location</dt>
        <dd>Map {mapId}</dd>
        <dt className="text-muted">Last seen</dt>
        <dd data-testid="last-logout">{date(lastLogoutAt)}</dd>
      </dl>

      <div className="flex gap-4 border-t border-line pt-3 text-sm">
        <Coin label="gold" value={number(money.gold)} tone="bg-amber-400" />
        <Coin label="silver" value={number(money.silver)} tone="bg-slate-300" />
        <Coin label="copper" value={number(money.copper)} tone="bg-orange-700" />
      </div>
    </article>
  )
}

function Coin({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <span className="flex items-center gap-1.5" title={label}>
      <span aria-hidden className={`size-2.5 rounded-full ${tone}`} />
      <span>{value}</span>
      <span className="sr-only">{label}</span>
    </span>
  )
}
