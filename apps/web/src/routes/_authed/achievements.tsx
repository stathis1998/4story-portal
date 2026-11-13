import { ACHIEVEMENT_CATEGORIES } from '@4story-portal/shared'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '../../components/Button'
import { AchievementCard } from '../../components/stats/AchievementCard'
import { Tabs } from '../../components/Tabs'
import { achievementsQueryOptions, sortAchievements } from '../../lib/achievements'

export const Route = createFileRoute('/_authed/achievements')({
  component: AchievementsPage,
})

function AchievementsPage() {
  const { data, isPending, isError, refetch, isFetching } = useQuery(achievementsQueryOptions)
  const [chosen, setChosen] = useState<string>()

  const categories = ACHIEVEMENT_CATEGORIES.map(({ id, label }) => {
    const achievements = (data?.achievements ?? []).filter((achievement) => achievement.category === id)
    const done = achievements.reduce((sum, achievement) => sum + achievement.levelsDone, 0)
    const total = achievements.reduce((sum, achievement) => sum + achievement.levels.length, 0)
    return { id, label: `${label} ${done}/${total}`, achievements }
  }).filter((category) => category.achievements.length > 0)
  const active = categories.find((category) => category.id === chosen) ?? categories[0]

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-4xl">Achievements</h1>
      <p className="mt-1 mb-6 text-muted">
        Goals with up to five levels each. Completing a level is announced in the game, and its reward arrives by
        in-game mail.
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
        <>
          <p className="mb-3 text-lg font-bold">
            {data.levelsDone} of {data.levelsTotal} levels completed
          </p>
          {!data.live && (
            <p className="mb-4 rounded-xs border border-line bg-surface px-3 py-2 text-sm text-muted">
              Rewards are not switched on yet. Your levels are counted and will be paid when they are.
            </p>
          )}
          {active ? (
            <>
              <Tabs tabs={categories.map(({ id, label }) => ({ id, label }))} active={active.id} onChange={setChosen} />
              <div role="tabpanel" id={`panel-${active.id}`} aria-labelledby={`tab-${active.id}`} className="mt-3">
                <ul aria-label="Achievements" className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {sortAchievements(active.achievements).map((achievement) => (
                    <AchievementCard key={achievement.id} achievement={achievement} players={data.players} />
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
      )}
    </main>
  )
}
