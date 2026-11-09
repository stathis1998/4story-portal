import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Button } from '../../components/Button'
import { RankingCard } from '../../components/stats/RankingCard'
import { leaderboardQueryOptions } from '../../lib/stats'

export const Route = createFileRoute('/_authed/leaderboard')({
  component: LeaderboardPage,
})

function LeaderboardPage() {
  const { data, isPending, isError, refetch, isFetching } = useQuery(leaderboardQueryOptions)

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-4xl">Leaderboard</h1>
      <p className="mt-1 mb-6 text-muted">
        Totals per character. Every party member near a kill gets credit for it. Damage is the HP actually removed, and pets and
        summons count for their owner. Gold spent is what was paid to NPCs and in fees, not trades, player stores, mail or auctions.
        Counted since 6 November 2026 and saved every 5 minutes and at logout. Soul lotteries are counted since November 2026, and
        soul lottery gold includes consolation prizes.
      </p>

      {data && !data.ranked && <p className="mb-4 text-sm text-muted">GM, not ranked.</p>}

      {isPending ? (
        <div role="status" aria-label="Loading the Leaderboard" className="h-52 animate-pulse rounded-xs border border-line bg-surface" />
      ) : isError ? (
        <div className="flex flex-col items-start gap-3 rounded-xs border border-danger/40 bg-danger-surface p-5">
          <p className="text-danger">Could not load the Leaderboard.</p>
          <Button onClick={() => refetch()} disabled={isFetching}>
            Retry
          </Button>
        </div>
      ) : (
        <div className="grid items-start gap-4 md:grid-cols-2">
          {data.categories.map((category) => (
            <RankingCard key={category.id} category={category} />
          ))}
        </div>
      )}
    </main>
  )
}
