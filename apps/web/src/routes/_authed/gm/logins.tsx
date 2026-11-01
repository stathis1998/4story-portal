import type { GmLogin } from '@4story-portal/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '../../../components/Button'
import { FormMessage } from '../../../components/FormMessage'
import { GmNav } from '../../../components/gm/GmNav'
import { LoginsTable } from '../../../components/gm/LoginsTable'
import { StatusBadge } from '../../../components/StatusBadge'
import { ApiError } from '../../../lib/api'
import { gmLoginsQueryOptions, gmStatusQueryOptions, useClearLogin } from '../../../lib/gm'
import { meQueryOptions } from '../../../lib/session'

export const Route = createFileRoute('/_authed/gm/logins')({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions)
    if (!me?.isGm) throw redirect({ to: '/characters' })
  },
  component: LoginsPage,
})

function LoginsPage() {
  const queryClient = useQueryClient()
  const { data: status } = useQuery(gmStatusQueryOptions)
  const { data: logins, isFetching, isError: loginsFailed } = useQuery(gmLoginsQueryOptions)
  const clearLogin = useClearLogin()
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const connected = status?.state === 'connected'

  async function clear(login: GmLogin) {
    const name = login.character ?? login.account
    setNote(null)
    setError(null)
    try {
      const { outcome } = await clearLogin.mutateAsync(login.key)
      setNote(
        outcome === 'cleared'
          ? `Stuck login cleared for ${name}. They can log in now.`
          : `${name} was really online and has been logged out.`,
      )
    } catch (err) {
      // 503 is the one server error with a message meant for the GM: the game server is not connected.
      setError(
        err instanceof ApiError && (err.status < 500 || err.status === 503)
          ? err.message
          : 'Something went wrong. Please try again.',
      )
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <GmNav />
      <div className="flex items-center gap-4">
        <h1 className="text-4xl">Logins</h1>
        {status && <StatusBadge state={status.state} />}
      </div>
      <p className="mt-2 text-sm text-muted">
        Everyone the game thinks is logged in. A player stuck on the "attempt was made to connect to the ID" message
        has a row here, and clearing it lets them log in.
      </p>

      <div className="mt-6 flex flex-col gap-3">
        <div className="flex justify-end">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => queryClient.refetchQueries({ queryKey: gmLoginsQueryOptions.queryKey })}
            disabled={isFetching}
          >
            Refresh
          </Button>
        </div>
        {status && !connected && (
          <p className="text-sm text-muted">
            Logins with a character can't be cleared until the game server is connected, because they might be real
            players.
          </p>
        )}
        <FormMessage message={error ?? (loginsFailed ? 'Could not load logins.' : null)} />
        {note && <p className="rounded-xs border border-line bg-surface px-3 py-2 text-sm">{note}</p>}
        {logins?.length === 0 && (
          <p className="rounded-xs border border-dashed border-line p-10 text-center text-muted">No one is logged in.</p>
        )}
        {logins && logins.length > 0 && (
          <LoginsTable
            logins={logins}
            canKick={connected}
            clearing={clearLogin.isPending ? clearLogin.variables : undefined}
            onClear={clear}
          />
        )}
      </div>
    </main>
  )
}
