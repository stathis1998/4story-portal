import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Button } from '../../components/Button'
import { CharacterGear } from '../../components/items/CharacterGear'
import { inspectQueryOptions, isNotFound } from '../../lib/stats'

export const Route = createFileRoute('/_authed/inspect/$id')({
  component: InspectPage,
})

function InspectPage() {
  const { id } = Route.useParams()
  const { data, error, isPending, refetch, isFetching } = useQuery(inspectQueryOptions(id))

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <div className="mb-6">
        <Link to="/leaderboard" className="text-sm font-bold text-muted hover:underline">
          Back to the Leaderboard
        </Link>
      </div>
      {isPending ? (
        <div role="status" aria-label="Loading character" className="h-52 animate-pulse rounded-xs border border-line bg-surface" />
      ) : data ? (
        <div className="flex flex-col gap-4">
          <header>
            <h1 className="text-4xl">{data.name}</h1>
            <p className="mt-1 text-muted">
              Level {data.level} {data.className}, {data.race}, {data.country}
            </p>
          </header>
          <section className="rounded-xs border border-line bg-surface p-5">
            <h2 className="mb-4 text-2xl">Gear</h2>
            <CharacterGear gear={data.gear} caption={`Lv. ${data.level} ${data.className}`} />
          </section>
        </div>
      ) : isNotFound(error) ? (
        <p className="rounded-xs border border-dashed border-line p-10 text-center text-muted">Character not found.</p>
      ) : (
        <div className="flex flex-col items-start gap-3 rounded-xs border border-danger/40 bg-danger-surface p-5">
          <p className="text-danger">Could not load this character.</p>
          <Button onClick={() => refetch()} disabled={isFetching}>
            Retry
          </Button>
        </div>
      )}
    </main>
  )
}
