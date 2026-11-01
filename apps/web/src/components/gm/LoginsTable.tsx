import type { GmLogin } from '@4story-portal/shared'
import { useState } from 'react'
import { Button } from '../Button'

type Props = {
  logins: GmLogin[]
  /** Clearing a login with a character kicks it first, which needs the game server. */
  canKick: boolean
  /** The login being cleared, if any: clearing can take several seconds. */
  clearing?: number
  onClear: (login: GmLogin) => void
}

const th = 'px-3 py-2 text-left text-xs font-bold tracking-wider text-muted uppercase'
const td = 'px-3 py-2'

// The database stores the server's local time and the API passes it on as if it were UTC.
const loginTime = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  })

export function LoginsTable({ logins, canKick, clearing, onClear }: Props) {
  const [confirming, setConfirming] = useState<number | null>(null)

  return (
    <div className="overflow-x-auto rounded-xs border border-line bg-surface">
      <table className="w-full text-sm">
        <thead className="border-b border-line">
          <tr>
            <th className={th}>Account</th>
            <th className={th}>Character</th>
            <th className={th}>Ch</th>
            <th className={th}>Logged in</th>
            <th className={th}>Status</th>
            <th className={th} aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {logins.map((login) => (
            <tr key={login.key} className="border-b border-line last:border-b-0">
              <td className={td}>{login.account}</td>
              <td className={login.character ? td : `${td} text-muted`}>{login.character ?? 'Not in game'}</td>
              <td className={td}>{login.character ? login.channel : ''}</td>
              <td className={`${td} whitespace-nowrap`}>{loginTime(login.loggedInAt)}</td>
              <td className={`${td} whitespace-nowrap text-danger`}>{login.blocked && 'Login blocked'}</td>
              <td className={`${td} text-right`}>
                {clearing === login.key ? (
                  <span className="text-muted">Clearing…</span>
                ) : confirming === login.key ? (
                  <span className="flex flex-wrap items-center justify-end gap-2">
                    {login.character ? `Kick and clear ${login.character}?` : `Clear login for ${login.account}?`}
                    <Button
                      size="sm"
                      onClick={() => {
                        setConfirming(null)
                        onClear(login)
                      }}
                    >
                      {login.character ? 'Kick and clear' : 'Clear'}
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setConfirming(null)}>
                      Cancel
                    </Button>
                  </span>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="whitespace-nowrap"
                    aria-label={`Clear login for ${login.account}`}
                    disabled={Boolean(login.character) && !canKick}
                    onClick={() => setConfirming(login.key)}
                  >
                    Clear login
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
