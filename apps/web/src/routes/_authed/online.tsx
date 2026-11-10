import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Button } from '../../components/Button'
import { onlineQueryOptions } from '../../lib/online'

export const Route = createFileRoute('/_authed/online')({
  component: OnlinePage,
})

const th = 'px-3 py-2 text-left text-xs font-bold tracking-wider text-muted uppercase'
const td = 'px-3 py-2'

function OnlinePage() {
  const { data, isPending, isError, refetch, isFetching } = useQuery(onlineQueryOptions)

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-4xl">Online</h1>
      <p className="mt-1 mb-6 text-muted">Characters in the game right now. The list updates every 30 seconds.</p>

      {isPending ? (
        <div role="status" aria-label="Loading who is online" className="h-52 animate-pulse rounded-xs border border-line bg-surface" />
      ) : isError ? (
        <div className="flex flex-col items-start gap-3 rounded-xs border border-danger/40 bg-danger-surface p-5">
          <p className="text-danger">Could not load who is online.</p>
          <Button onClick={() => refetch()} disabled={isFetching}>
            Retry
          </Button>
        </div>
      ) : (
        <>
          <p className="mb-3 text-lg font-bold">
            {data.length === 0 ? 'Nobody is in the game right now.' : `${data.length} ${data.length === 1 ? 'character' : 'characters'} online`}
          </p>
          {data.length > 0 && (
            <div className="overflow-x-auto rounded-xs border border-line bg-surface">
              <table className="w-full text-sm">
                <thead className="border-b border-line">
                  <tr>
                    <th className={th}>Character</th>
                    <th className={th}>Class</th>
                    <th className={th}>Level</th>
                    <th className={th}>Channel</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((character) => (
                    <tr key={character.id} className="border-b border-line last:border-b-0">
                      <td className={td}>
                        <Link to="/inspect/$id" params={{ id: String(character.id) }} className="font-bold hover:underline">
                          {character.name}
                        </Link>
                      </td>
                      <td className={td}>{character.className}</td>
                      <td className={td}>{character.level}</td>
                      <td className={td}>{character.channel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </main>
  )
}
