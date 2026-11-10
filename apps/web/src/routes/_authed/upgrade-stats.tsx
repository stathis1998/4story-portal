import type { UpgradeKindStats, UpgradeLoss, UpgradeOutcomes, UpgradeStats } from '@4story-portal/shared'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { type ReactNode, useState } from 'react'
import { Button } from '../../components/Button'
import { Tabs } from '../../components/Tabs'
import { CharacterFilter } from '../../components/upgrade-stats/CharacterFilter'
import { Legend, RectSwatch } from '../../components/upgrade-stats/chart'
import { DailyChart } from '../../components/upgrade-stats/DailyChart'
import { OddsChart } from '../../components/upgrade-stats/OddsChart'
import { OutcomeChart } from '../../components/upgrade-stats/OutcomeChart'
import { formatDay, isNotFound } from '../../lib/stats'
import {
  attemptsOf,
  count,
  FAILURE_PARTS,
  failuresOf,
  fillLevels,
  levelLabel,
  luckText,
  OUTCOME_COLORS,
  OUTCOME_LABELS,
  percent,
  upgradeStatsQueryOptions,
  withArticle,
} from '../../lib/upgrade-stats'

export const Route = createFileRoute('/_authed/upgrade-stats')({
  validateSearch: (search: Record<string, unknown>): { character?: number } => {
    const character = Number(search.character)
    return Number.isInteger(character) && character > 0 ? { character } : { character: undefined }
  },
  component: UpgradeStatsPage,
})

type Kind = 'scroll' | 'gem'

const TABS = [
  { id: 'scroll', label: 'Upgrade scrolls' },
  { id: 'gem', label: 'Gemstones' },
]

const OUTCOME_ORDER = ['success', ...FAILURE_PARTS] as const

function UpgradeStatsPage() {
  const { character } = Route.useSearch()
  const navigate = Route.useNavigate()
  // While another character loads, the last numbers stay on screen, dimmed.
  const { data, isPending, isError, error, refetch, isFetching, isPlaceholderData } = useQuery({
    ...upgradeStatsQueryOptions(character),
    placeholderData: keepPreviousData,
  })
  const [kind, setKind] = useState<Kind>('scroll')
  const shown = isPlaceholderData ? undefined : data?.character

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-4xl">Upgrade Stats</h1>
      <p className="mt-1 mb-6 text-muted">
        Every upgrade scroll and gemstone roll{shown ? ` by ${shown.name}` : ' on the server'}
        {data?.since && !isPlaceholderData ? `, counted since ${formatDay(data.since)}` : ''}. A failure is saved when a tincture or
        gem protection kept the item with nothing lost. The odds are the real chance each roll had, after Serendipity and NPC
        bonuses. Updated every minute.
      </p>

      <CharacterFilter current={shown} picked={character !== undefined} onPick={(id) => navigate({ search: { character: id } })} />

      {data && !data.ranked && !data.character && <p className="mb-4 text-sm text-muted">GM, not counted in the server totals.</p>}

      {isPending ? (
        <div role="status" aria-label="Loading the Upgrade Stats" className="h-80 animate-pulse rounded-xs border border-line bg-surface" />
      ) : isError && isNotFound(error) ? (
        <div className="rounded-xs border border-line bg-surface p-5">
          <p className="text-muted">That character can't be shown. Pick another one, or show everyone.</p>
        </div>
      ) : isError ? (
        <div className="flex flex-col items-start gap-3 rounded-xs border border-danger/40 bg-danger-surface p-5">
          <p className="text-danger">Could not load the Upgrade Stats.</p>
          <Button onClick={() => refetch()} disabled={isFetching}>
            Retry
          </Button>
        </div>
      ) : (
        <>
          <Tabs tabs={TABS} active={kind} onChange={(id) => setKind(id as Kind)} />
          <div
            role="tabpanel"
            id={`panel-${kind}`}
            aria-labelledby={`tab-${kind}`}
            aria-busy={isPlaceholderData}
            className={`mt-6 flex flex-col gap-4 transition-opacity ${isPlaceholderData ? 'opacity-50' : ''}`}
          >
            <KindPanel data={data} kind={kind} />
          </div>
        </>
      )}
    </main>
  )
}

function KindPanel({ data, kind }: { data: UpgradeStats; kind: Kind }) {
  const stats = data[kind]
  const attempts = attemptsOf(stats.totals)
  const noun = kind === 'scroll' ? 'upgrade' : 'gemstone'
  const aNoun = withArticle(noun)

  if (attempts === 0) {
    return (
      <>
        <section className="rounded-xs border border-line bg-surface p-5">
          <p className="text-muted">
            {data.character
              ? `${data.character.name} hasn't tried ${aNoun} yet.`
              : `Nobody has tried ${aNoun} yet. The first roll will show up here within a minute.`}
          </p>
        </section>
        {kind === 'scroll' && <Misfortune losses={data.losses} />}
      </>
    )
  }

  const levels = fillLevels(stats.levels)

  return (
    <>
      <Summary stats={stats} noun={noun} />

      <ChartCard
        title="What happened at each level"
        subtitle={`Wins rise above the line, failures hang below it. ${kind === 'scroll' ? 'By the + level the item was at before the roll.' : 'By the gem level the item had before the roll.'}`}
        legend={OUTCOME_ORDER.map((part) => ({ label: OUTCOME_LABELS[part], swatch: <RectSwatch color={OUTCOME_COLORS[part]} /> }))}
      >
        <OutcomeChart levels={levels} kind={kind} />
      </ChartCard>

      <ChartCard
        title="Luck against the odds"
        subtitle="The tick is the chance the rolls had, the dot is how often they really won."
        legend={[
          { label: 'Won', swatch: <span aria-hidden className="size-2.5 rounded-full bg-fg" /> },
          { label: 'The odds', swatch: <span aria-hidden className="h-0.5 w-3.5 rounded-full bg-secondary" /> },
          { label: 'Beat the odds', swatch: <span aria-hidden className="h-3 w-0.5 rounded-full" style={{ background: 'var(--viz-success)' }} /> },
          { label: 'Below the odds', swatch: <span aria-hidden className="h-3 w-0.5 rounded-full" style={{ background: 'var(--viz-destroyed)' }} /> },
        ]}
      >
        <OddsChart levels={levels} kind={kind} />
      </ChartCard>

      <ChartCard
        title="The last 30 days"
        legend={[
          { label: 'Won', swatch: <RectSwatch color="var(--viz-success)" /> },
          { label: 'Failed', swatch: <RectSwatch color="var(--viz-destroyed)" /> },
        ]}
      >
        <DailyChart days={stats.days} />
      </ChartCard>

      <div className="grid items-start gap-4 md:grid-cols-2">
        {/* With one character picked, the whole page is already that character's record. */}
        {!data.character && <YourRecord you={stats.you} noun={noun} />}
        {kind === 'scroll' && <Misfortune losses={data.losses} />}
      </div>

      <LevelTable stats={stats} kind={kind} />
    </>
  )
}

function Summary({ stats, noun }: { stats: UpgradeKindStats; noun: string }) {
  const { totals } = stats
  const attempts = attemptsOf(totals)
  const tiles = [
    { label: 'Attempts', value: attempts },
    { label: 'Won', value: totals.success },
    { label: 'Failed', value: failuresOf(totals) },
    { label: noun === 'upgrade' ? 'Items destroyed' : 'Gem levels lost', value: noun === 'upgrade' ? totals.destroyed : totals.lostLevels },
  ]

  return (
    <section aria-label="Totals" className="rounded-xs border border-line bg-surface p-5">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="text-6xl font-bold [font-variant-numeric:lining-nums_proportional-nums]">{percent(totals.success, attempts)}</p>
          <p className="mt-1 text-muted">
            {count(totals.success)} of {count(attempts)} {noun} {attempts === 1 ? 'roll' : 'rolls'} won,{' '}
            {luckText(totals.success, stats.expectedSuccesses)}.
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
          {tiles.map((tile) => (
            <div key={tile.label}>
              <dt className="text-sm text-muted">{tile.label}</dt>
              <dd className="text-2xl font-bold [font-variant-numeric:lining-nums_proportional-nums]">{count(tile.value)}</dd>
            </div>
          ))}
        </dl>
      </div>
      <OutcomeSplit outcomes={totals} className="mt-5" />
    </section>
  )
}

/** One thin bar split into the four outcomes, with their names and shares below. */
function OutcomeSplit({ outcomes, className = '' }: { outcomes: UpgradeOutcomes; className?: string }) {
  const attempts = attemptsOf(outcomes)
  const parts = OUTCOME_ORDER.filter((part) => outcomes[part] > 0)
  const name = OUTCOME_ORDER.map((part) => `${OUTCOME_LABELS[part]} ${count(outcomes[part])} (${percent(outcomes[part], attempts)})`).join(', ')
  return (
    <div className={className}>
      <div role="img" aria-label={name} className="flex h-2 gap-0.5">
        {parts.map((part) => (
          <span
            key={part}
            className="h-full rounded-full"
            style={{ flexGrow: outcomes[part], flexBasis: 0, background: OUTCOME_COLORS[part] }}
            title={`${OUTCOME_LABELS[part]}: ${count(outcomes[part])}`}
          />
        ))}
      </div>
      <div className="mt-2">
        <Legend
          items={OUTCOME_ORDER.map((part) => ({
            label: `${OUTCOME_LABELS[part]} ${percent(outcomes[part], attempts)}`,
            swatch: <RectSwatch color={OUTCOME_COLORS[part]} />,
          }))}
        />
      </div>
    </div>
  )
}

function ChartCard({
  title,
  subtitle,
  legend,
  children,
}: {
  title: string
  subtitle?: string
  legend: { label: string; swatch: ReactNode }[]
  children: ReactNode
}) {
  const id = `chart-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  return (
    <section aria-labelledby={id} className="rounded-xs border border-line bg-surface p-5">
      <h2 id={id} className="text-2xl">
        {title}
      </h2>
      {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      <div className="mt-3 mb-4">
        <Legend items={legend} />
      </div>
      {children}
    </section>
  )
}

function YourRecord({ you, noun }: { you: UpgradeKindStats['you']; noun: string }) {
  const attempts = attemptsOf(you)
  const aNoun = withArticle(noun)
  return (
    <section aria-labelledby="your-record" className="rounded-xs border border-line bg-surface p-5">
      <h2 id="your-record" className="mb-3 text-2xl">
        Your record
      </h2>
      {attempts === 0 ? (
        <p className="text-sm text-muted">None of your characters has tried {aNoun} yet.</p>
      ) : (
        <>
          <p>
            <span className="text-3xl font-bold [font-variant-numeric:lining-nums_proportional-nums]">{percent(you.success, attempts)}</span>{' '}
            <span className="text-muted">
              {count(you.success)} of {count(attempts)} won, {luckText(you.success, you.expectedSuccesses)}.
            </span>
          </p>
          <OutcomeSplit outcomes={you} className="mt-4" />
        </>
      )}
    </section>
  )
}

function Misfortune({ losses }: { losses: UpgradeLoss[] }) {
  return (
    <section aria-labelledby="misfortune" className="rounded-xs border border-line bg-surface p-5">
      <h2 id="misfortune" className="text-2xl">
        Wall of Misfortune
      </h2>
      <p className="mt-0.5 mb-3 text-sm text-muted">The highest items lost to a failed upgrade.</p>
      {losses.length === 0 ? (
        <p className="text-sm text-muted">No item has been destroyed yet.</p>
      ) : (
        <ol className="flex flex-col gap-2.5">
          {losses.map((loss, i) => (
            <li key={`${loss.characterId}-${i}`} className={`flex items-center gap-3 ${loss.mine ? 'rounded-xs border-l-2 border-accent pl-2' : ''}`}>
              <span className="w-10 shrink-0 font-display text-lg" style={{ color: 'var(--viz-lost)' }}>
                +{loss.upgrade}
              </span>
              <div className="min-w-0">
                <p className="truncate font-bold">{loss.item}</p>
                <p className="flex items-center gap-2 text-xs text-muted">
                  <Link
                    to={loss.mine ? '/characters/$id' : '/inspect/$id'}
                    params={{ id: String(loss.characterId) }}
                    className="truncate hover:underline"
                  >
                    {loss.name}
                  </Link>
                  <span>
                    {loss.className}, level {loss.level}
                  </span>
                  {loss.mine && <span className="rounded-xs border border-accent px-1.5 text-accent-text">You</span>}
                </p>
              </div>
              <span className="ml-auto shrink-0 text-sm text-muted">{formatDay(loss.date)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function LevelTable({ stats, kind }: { stats: UpgradeKindStats; kind: Kind }) {
  return (
    <details className="rounded-xs border border-line bg-surface p-5">
      <summary className="cursor-pointer font-bold">Every level as a table</summary>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-right text-sm tabular-nums">
          <thead className="text-muted">
            <tr>
              <th className="py-1 text-left font-normal">Level</th>
              <th className="font-normal">Attempts</th>
              {OUTCOME_ORDER.map((part) => (
                <th key={part} className="font-normal">
                  {OUTCOME_LABELS[part]}
                </th>
              ))}
              <th className="font-normal">Won</th>
              <th className="font-normal">Odds</th>
            </tr>
          </thead>
          <tbody>
            {stats.levels.map((level) => (
              <tr key={level.level} className="border-t border-line">
                <td className="py-1 text-left">{levelLabel(kind, level.level)}</td>
                <td>{count(attemptsOf(level))}</td>
                {OUTCOME_ORDER.map((part) => (
                  <td key={part}>{count(level[part])}</td>
                ))}
                <td>{percent(level.success, attemptsOf(level))}</td>
                <td>{Math.round(level.expectedRate * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
