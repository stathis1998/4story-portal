import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { newsQueryOptions, timeAgo } from '../../lib/achievements'

const SHOWN = 8

// Nothing to show while loading or when the call fails: like the event banner, this is a bonus.
export function NewsPanel() {
  const { data } = useQuery(newsQueryOptions)
  const [all, setAll] = useState(false)
  if (!data) return null

  const items = all ? data.items : data.items.slice(0, SHOWN)

  return (
    <section aria-labelledby="news-heading" className="mb-6 rounded-xs border border-line bg-surface px-4 py-3">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="news-heading" className="text-xl">
          Latest news
        </h2>
        {data.items.length > SHOWN && (
          <button
            type="button"
            aria-expanded={all}
            aria-controls="news-list"
            onClick={() => setAll((current) => !current)}
            className="rounded-xs text-sm font-bold text-muted outline-none hover:text-fg hover:underline focus-visible:ring-2 focus-visible:ring-accent-text"
          >
            {all ? 'Show fewer' : 'Show all'}
          </button>
        )}
      </div>
      {data.items.length === 0 ? (
        <p className="mt-1 text-sm text-muted">Nothing yet. Achievement completions will show up here.</p>
      ) : (
        <ul id="news-list" className="mt-2 flex flex-col gap-1 text-sm">
          {items.map((item) => (
            <li
              key={item.id}
              className={`flex items-baseline justify-between gap-3 ${
                item.mine ? 'rounded-xs border-l-2 border-accent pl-2 font-bold text-accent-text' : ''
              }`}
            >
              <span className="min-w-0 break-words">{item.text}</span>
              <span className="shrink-0 text-xs font-normal text-muted">{timeAgo(data.serverNow, item.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
