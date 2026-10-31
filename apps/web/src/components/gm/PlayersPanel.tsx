import type { OnlinePlayer } from '@4story-portal/shared'
import { useState } from 'react'
import { Button } from '../Button'
import { Checkbox } from '../Checkbox'
import { FormMessage } from '../FormMessage'

type Props = {
  players: OnlinePlayer[]
  /** Set when the list could not be loaded, so an empty list is not mistaken for no players. */
  loadError?: string | null
  worldNames: Map<number, string>
  selected: string[]
  onChange: (names: string[]) => void
  onRefresh: () => void
  refreshing?: boolean
}

const th = 'px-3 py-2 text-left text-xs font-bold tracking-wider text-muted uppercase'
const td = 'px-3 py-2'

export function PlayersPanel({ players, loadError, worldNames, selected, onChange, onRefresh, refreshing }: Props) {
  const [search, setSearch] = useState('')
  const needle = search.trim().toLowerCase()
  const visible = players.filter((player) => player.name.toLowerCase().includes(needle))
  const allVisibleSelected = visible.length > 0 && visible.every((player) => selected.includes(player.name))

  const toggle = (name: string) =>
    onChange(selected.includes(name) ? selected.filter((n) => n !== name) : [...selected, name])

  const toggleAll = () => {
    const names = visible.map((player) => player.name)
    onChange(allVisibleSelected ? selected.filter((n) => !names.includes(n)) : [...new Set([...selected, ...names])])
  }

  return (
    <section aria-label="Online players" className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center gap-3">
        <input
          type="search"
          aria-label="Search players"
          placeholder="Search players"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="min-w-0 flex-1 rounded-xs border border-line bg-surface-raised px-3 py-2 outline-none transition focus:border-accent focus:ring-1 focus:ring-accent"
        />
        <span className="text-sm text-muted">{selected.length} selected</span>
        <Button variant="secondary" size="sm" onClick={onRefresh} disabled={refreshing}>
          Refresh
        </Button>
      </div>

      {loadError ? (
        <FormMessage message={loadError} />
      ) : players.length === 0 ? (
        <p className="rounded-xs border border-dashed border-line p-10 text-center text-muted">
          No one is online right now.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xs border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-line">
              <tr>
                <th className="w-10 px-3 py-2">
                  <Checkbox label="Select all" hideLabel checked={allVisibleSelected} onChange={toggleAll} />
                </th>
                <th className={th}>Name</th>
                <th className={th}>Lv</th>
                <th className={th}>Class</th>
                <th className={th}>World</th>
                <th className={th}>Ch</th>
                <th className={th}>Map</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((player) => (
                <tr key={player.charId} className="border-b border-line last:border-b-0">
                  <td className={td}>
                    <Checkbox
                      label={`Select ${player.name}`}
                      hideLabel
                      checked={selected.includes(player.name)}
                      onChange={() => toggle(player.name)}
                    />
                  </td>
                  <td className={td}>{player.name}</td>
                  <td className={td}>{player.level}</td>
                  <td className={td}>{player.className}</td>
                  <td className={td}>{worldNames.get(player.world) ?? player.world}</td>
                  <td className={td}>{player.channel}</td>
                  <td className={td}>{player.mapId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
