import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { achievementsQueryOptions, almostThere } from '../../lib/achievements'
import { AchievementCard } from './AchievementCard'

// Its own query, so the page keeps working without it. Nothing to show for a failure or a fresh account.
export function AlmostThere() {
  const { data } = useQuery(achievementsQueryOptions)
  const closest = data ? almostThere(data.achievements) : []
  if (!data || closest.length === 0) return null

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 id="almost-there-heading" className="text-2xl">
          Almost there
        </h2>
        <Link to="/achievements" className="text-sm font-bold text-accent-text hover:underline">
          All achievements
        </Link>
      </div>
      <ul aria-labelledby="almost-there-heading" className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {closest.map((achievement) => (
          <AchievementCard key={achievement.id} achievement={achievement} players={data.players} />
        ))}
      </ul>
    </section>
  )
}
