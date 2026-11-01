import type { HallCategory } from '@4story-portal/shared'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '../../components/Button'
import { FormMessage } from '../../components/FormMessage'
import { hallOfFameQueryOptions, ordinal, settingsErrorMessage, useSetHideGms } from '../../lib/stats'

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
            <Category key={category.id} category={category} />
          ))}
        </div>
      )}
    </main>
  )
}

function Category({ category }: { category: HallCategory }) {
  const headingId = `hall-${category.id}`
  return (
    <section aria-labelledby={headingId} className="rounded-xs border border-line bg-surface p-5">
      <h2 id={headingId} className="mb-3 text-2xl">
        {category.label}
      </h2>
      {category.entries.length === 0 ? (
        <p className="text-sm text-muted">Nobody yet.</p>
      ) : (
        <ol className="flex flex-col gap-2.5">
          {category.entries.map((entry) => (
            <li
              key={`${entry.place}-${entry.name}`}
              className={`flex items-center gap-3 ${entry.mine ? 'rounded-xs border-l-2 border-accent pl-2' : ''}`}
            >
              <span className="w-8 shrink-0 font-display text-accent-text">{ordinal(entry.place)}</span>
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-bold">
                  <span className="truncate">{entry.name}</span>
                  {entry.mine && <span className="rounded-xs border border-accent px-1.5 text-xs text-accent-text">You</span>}
                </p>
                <p className="text-xs text-muted">
                  {entry.className}, level {entry.level}
                </p>
              </div>
              <div className="ml-auto text-right">
                <p>{entry.display}</p>
                {entry.detail && <p className="text-xs text-muted">{entry.detail}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
      {category.you && (
        <p className="mt-3 border-t border-line pt-2 text-sm text-muted">
          You: {ordinal(category.you.place)}, {category.you.name}, {category.you.display}
        </p>
      )}
    </section>
  )
}
