import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { CharacterCard } from '../../components/CharacterCard'
import { charactersQueryOptions } from '../../lib/characters'

export const Route = createFileRoute('/_authed/characters')({
  component: CharactersPage,
})

function CharactersPage() {
  const { data, isPending, isError, refetch, isFetching } = useQuery(charactersQueryOptions)

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-3xl">Your characters</h1>
      <p className="mt-1 mb-8 text-muted">Everyone on your account, as the server last saved them.</p>

      {isPending ? (
        <Skeleton />
      ) : isError ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-danger/40 bg-danger-surface p-5">
          <p className="text-danger">Could not load your characters.</p>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60"
          >
            Retry
          </button>
        </div>
      ) : data.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line p-10 text-center text-muted">
          No characters yet. Create one in the game.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...data]
            .sort((a, b) => a.slot - b.slot)
            .map((character) => (
              <CharacterCard key={character.id} character={character} />
            ))}
        </div>
      )}
    </main>
  )
}

function Skeleton() {
  return (
    <div role="status" aria-label="Loading characters" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-52 animate-pulse rounded-xl border border-line bg-surface" />
      ))}
    </div>
  )
}
