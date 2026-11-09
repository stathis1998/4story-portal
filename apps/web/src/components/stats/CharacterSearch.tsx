import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { characterSearchQueryOptions } from '../../lib/stats'

const DEBOUNCE_MS = 250
const MIN_LETTERS = 2

export function CharacterSearch() {
  const [text, setText] = useState('')
  const [query, setQuery] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [text])

  const searching = query.length >= MIN_LETTERS
  const { data, isError } = useQuery({ ...characterSearchQueryOptions(query), enabled: searching })

  return (
    <section className="mb-6 rounded-xs border border-line bg-surface p-5">
      <label htmlFor="character-search" className="text-xs font-bold tracking-wider text-muted uppercase">
        Find a character
      </label>
      <input
        id="character-search"
        type="search"
        autoComplete="off"
        maxLength={16}
        placeholder="Type a name"
        value={text}
        onChange={(event) => setText(event.target.value)}
        className="mt-1.5 w-full rounded-xs border border-line bg-surface-raised px-3 py-2 outline-none transition focus:border-accent focus:ring-1 focus:ring-accent"
      />
      {searching && isError && <p className="mt-3 text-sm text-danger">Could not search right now.</p>}
      {searching && data?.length === 0 && <p className="mt-3 text-sm text-muted">No characters found.</p>}
      {searching && data && data.length > 0 && (
        <ul aria-label="Search results" className="mt-3 flex flex-col gap-1.5">
          {data.map((character) => (
            <li key={character.id}>
              <Link to="/inspect/$id" params={{ id: String(character.id) }} className="font-bold hover:underline">
                {character.name}
              </Link>
              <span className="ml-2 text-xs text-muted">
                {character.className}, level {character.level}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
