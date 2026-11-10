import type { UpgradeStatsCharacter } from '@4story-portal/shared'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { charactersQueryOptions } from '../../lib/characters'
import { characterSearchQueryOptions } from '../../lib/stats'

const DEBOUNCE_MS = 250
const MIN_LETTERS = 2

type Props = {
  /** The character shown now, or null for everyone. Undefined while it loads. */
  current: UpgradeStatsCharacter | null | undefined
  /** A character is being asked for, even if it hasn't loaded or doesn't exist. */
  picked: boolean
  onPick(id: number | undefined): void
}

const chip = (selected: boolean) =>
  `rounded-xs border px-2.5 py-1 text-sm font-bold transition ${selected ? 'border-accent bg-accent/15 text-fg' : 'border-line text-muted hover:text-fg'}`

/** One row above everything it narrows: everyone, one of your characters, or anyone you search for. */
export function CharacterFilter({ current, picked, onPick }: Props) {
  const [text, setText] = useState('')
  const [query, setQuery] = useState('')
  const { data: mine } = useQuery(charactersQueryOptions)

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [text])

  const searching = query.length >= MIN_LETTERS
  const { data: found, isError } = useQuery({ ...characterSearchQueryOptions(query), enabled: searching })

  const pick = (id: number | undefined) => {
    setText('')
    onPick(id)
  }

  return (
    <section aria-label="Whose upgrades" className="mb-6 rounded-xs border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-bold tracking-wider text-muted uppercase">Showing</span>
        <button type="button" aria-pressed={!picked} className={chip(!picked)} onClick={() => pick(undefined)}>
          Everyone
        </button>
        {mine?.map((character) => (
          <button
            key={character.id}
            type="button"
            aria-pressed={current?.id === character.id}
            className={chip(current?.id === character.id)}
            onClick={() => pick(character.id)}
          >
            {character.name}
          </button>
        ))}
        {current && !current.mine && (
          <button type="button" aria-pressed className={chip(true)} onClick={() => pick(undefined)} title="Show everyone">
            {current.name} <span aria-hidden>×</span>
          </button>
        )}
      </div>

      <label htmlFor="upgrade-character-search" className="mt-4 block text-xs font-bold tracking-wider text-muted uppercase">
        Another player's character
      </label>
      <input
        id="upgrade-character-search"
        type="search"
        autoComplete="off"
        maxLength={16}
        placeholder="Type a name"
        value={text}
        onChange={(event) => setText(event.target.value)}
        className="mt-1.5 w-full rounded-xs border border-line bg-surface-raised px-3 py-2 outline-none transition focus:border-accent focus:ring-1 focus:ring-accent sm:max-w-sm"
      />
      {searching && isError && <p className="mt-3 text-sm text-danger">Could not search right now.</p>}
      {searching && found?.length === 0 && <p className="mt-3 text-sm text-muted">No characters found.</p>}
      {searching && found && found.length > 0 && (
        <ul aria-label="Search results" className="mt-3 flex flex-wrap gap-2">
          {found.map((character) => (
            <li key={character.id}>
              <button type="button" className={chip(false)} onClick={() => pick(character.id)}>
                {character.name}
                <span className="ml-1.5 text-xs font-normal">
                  {character.className}, {character.level}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
