import { ACHIEVEMENT_CATEGORIES, type AchievementsOverview } from '@4story-portal/shared'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '../../components/Button'
import { AchievementCard } from '../../components/stats/AchievementCard'
import { Tabs } from '../../components/Tabs'
import { achievementOwners, achievementsQueryOptions, sortAchievements } from '../../lib/achievements'

// Whose achievements are shown: one of your characters, or the account. Neither means the default.
type Search = { character?: number; view?: 'account' }

export const Route = createFileRoute('/_authed/achievements')({
  validateSearch: (search: Record<string, unknown>): Search => {
    if (search.view === 'account') return { character: undefined, view: 'account' }
    const character = Number(search.character)
    return { character: Number.isInteger(character) && character > 0 ? character : undefined, view: undefined }
  },
  component: AchievementsPage,
})

const ownerButton = (pressed: boolean) =>
  `flex cursor-pointer flex-wrap items-baseline gap-x-2 rounded-xs border px-3 py-1.5 text-left text-sm transition outline-none focus-visible:ring-2 focus-visible:ring-accent-text ${
    pressed ? 'border-accent bg-accent/15 text-fg' : 'border-line text-muted hover:text-fg'
  }`

function AchievementsPage() {
  const { data, isPending, isError, refetch, isFetching } = useQuery(achievementsQueryOptions)

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 md:py-10">
      <h1 className="text-4xl">Achievements</h1>
      <p className="mt-1 mb-6 text-muted">
        Goals with up to five levels each. Every character earns its own, and a level's reward arrives by in-game
        mail. Account achievements are shared by all your characters and pay nothing. Completing a level is announced in
        the game.
      </p>

      {isPending ? (
        <div role="status" aria-label="Loading achievements" className="h-52 animate-pulse rounded-xs border border-line bg-surface" />
      ) : isError ? (
        <div className="flex flex-col items-start gap-3 rounded-xs border border-danger/40 bg-danger-surface p-5">
          <p className="text-danger">Could not load your achievements.</p>
          <Button onClick={() => refetch()} disabled={isFetching}>
            Retry
          </Button>
        </div>
      ) : (
        <Overview overview={data} />
      )}
    </main>
  )
}

function Overview({ overview }: { overview: AchievementsOverview }) {
  const { character, view } = Route.useSearch()
  const navigate = Route.useNavigate()
  const [chosen, setChosen] = useState<string>()

  const owners = achievementOwners(overview)
  // The first is the highest level character, or the account when there are no characters. Anything
  // else in the address, such as a character that isn't yours, falls back to it.
  const selected = owners.find((owner) => owner.characterId === (view === 'account' ? null : character)) ?? owners[0]

  const categories = ACHIEVEMENT_CATEGORIES.map(({ id, label }) => {
    const achievements = selected.group.achievements.filter((achievement) => achievement.category === id)
    const done = achievements.reduce((sum, achievement) => sum + achievement.levelsDone, 0)
    const total = achievements.reduce((sum, achievement) => sum + achievement.levels.length, 0)
    return { id, label: `${label} ${done}/${total}`, achievements }
  }).filter((category) => category.achievements.length > 0)
  // A category the next selection doesn't have falls back to its first one.
  const active = categories.find((category) => category.id === chosen) ?? categories[0]

  return (
    <>
      <div role="group" aria-label="Whose achievements" className="mb-4 flex flex-wrap gap-2">
        {owners.map((owner) => (
          <button
            key={owner.key}
            type="button"
            aria-pressed={owner === selected}
            onClick={() =>
              void navigate({ search: owner.characterId === null ? { view: 'account' } : { character: owner.characterId } })
            }
            className={ownerButton(owner === selected)}
          >
            <span className="font-bold">{owner.name}</span>
            {owner.detail && (
              <>
                {' '}
                <span className="text-xs">{owner.detail}</span>
              </>
            )}{' '}
            <span className="text-xs tabular-nums">
              {owner.group.levelsDone}/{owner.group.levelsTotal}
            </span>
          </button>
        ))}
      </div>
      <p className="mb-3 text-lg font-bold">
        {selected.group.levelsDone} of {selected.group.levelsTotal} levels completed
      </p>
      {selected.characterId === null ? (
        <p className="mb-4 rounded-xs border border-line bg-surface px-3 py-2 text-sm text-muted">
          Account achievements are for the record. They pay no reward.
        </p>
      ) : (
        !overview.live && (
          <p className="mb-4 rounded-xs border border-line bg-surface px-3 py-2 text-sm text-muted">
            Rewards are not switched on yet. Your levels are counted and will be paid when they are.
          </p>
        )
      )}
      {active ? (
        <>
          <Tabs tabs={categories.map(({ id, label }) => ({ id, label }))} active={active.id} onChange={setChosen} />
          <div role="tabpanel" id={`panel-${active.id}`} aria-labelledby={`tab-${active.id}`} className="mt-3">
            <ul aria-label="Achievements" className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {sortAchievements(active.achievements).map((achievement) => (
                // Characters share achievement IDs, and a card must not carry over from one to the next.
                <AchievementCard key={`${selected.key}:${achievement.id}`} achievement={achievement} />
              ))}
            </ul>
          </div>
        </>
      ) : (
        <p className="rounded-xs border border-dashed border-line p-10 text-center text-muted">
          No achievements have been set up yet.
        </p>
      )}
    </>
  )
}
