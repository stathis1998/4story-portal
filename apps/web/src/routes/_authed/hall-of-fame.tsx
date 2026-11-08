import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '../../components/Button'
import { FormMessage } from '../../components/FormMessage'
import { RankingCard } from '../../components/stats/RankingCard'
import { hallOfFameQueryOptions, settingsErrorMessage, useSetHideGms } from '../../lib/stats'

export const Route = createFileRoute('/_authed/hall-of-fame')({
  component: HallOfFamePage,
})

function HallOfFamePage() {
  const { data, isPending, isError, refetch, isFetching } = useQuery(hallOfFameQueryOptions)
  const setHideGms = useSetHideGms()
  const [error, setError] = useState<string | null>(null)

  async function toggle(hideGms: boolean) {
    setError(null)
    try {
      await setHideGms.mutateAsync({ hideGms })
    } catch (err) {
      setError(settingsErrorMessage(err))
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-4xl">Hall of Fame</h1>
      <p className="mt-1 mb-6 text-muted">The best on the server, updated when a character's session is saved.</p>

      {data?.gm && (
        <label className="mb-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            role="switch"
            checked={data.gm.hideGms}
            disabled={setHideGms.isPending}
            onChange={(event) => toggle(event.target.checked)}
            className="size-4 accent-accent"
          />
          Hide GM accounts
        </label>
      )}
      <div className="mb-4">
        <FormMessage message={error} />
      </div>
      {data && !data.ranked && <p className="mb-4 text-sm text-muted">GM, not ranked.</p>}

      {isPending ? (
        <div role="status" aria-label="Loading the Hall of Fame" className="h-52 animate-pulse rounded-xs border border-line bg-surface" />
      ) : isError ? (
        <div className="flex flex-col items-start gap-3 rounded-xs border border-danger/40 bg-danger-surface p-5">
          <p className="text-danger">Could not load the Hall of Fame.</p>
          <Button onClick={() => refetch()} disabled={isFetching}>
            Retry
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.categories.map((category) => (
            <RankingCard key={category.id} category={category} />
          ))}
        </div>
      )}
    </main>
  )
}
