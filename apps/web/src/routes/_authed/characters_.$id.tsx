import type { CharacterProfile } from '@4story-portal/shared'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { Button } from '../../components/Button'
import { CharacterGear } from '../../components/items/CharacterGear'
import { LevelFreezeSection } from '../../components/stats/LevelFreezeSection'
import { LevelProgress } from '../../components/stats/LevelProgress'
import { formatMinutes, isNotFound, ordinal, plural, profileQueryOptions } from '../../lib/stats'

// The trailing underscore keeps this out of the characters page's layout: it's a page of its own.
export const Route = createFileRoute('/_authed/characters_/$id')({
  component: CharacterPage,
})

const back = (
  <Link to="/characters" className="text-sm font-bold text-muted hover:underline">
    Back to your characters
  </Link>
)

function CharacterPage() {
  const { id } = Route.useParams()
  const { data, error, isPending, refetch, isFetching } = useQuery(profileQueryOptions(id))

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <div className="mb-6">{back}</div>
      {isPending ? (
        <div role="status" aria-label="Loading character" className="h-52 animate-pulse rounded-xs border border-line bg-surface" />
      ) : data ? (
        <Profile profile={data} />
      ) : isNotFound(error) ? (
        <p className="rounded-xs border border-dashed border-line p-10 text-center text-muted">
          That character was not found on your account.
        </p>
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

function Section({ title, aside, children }: { title: string; aside?: string; children: ReactNode }) {
  return (
    <section className="rounded-xs border border-line bg-surface p-5">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 className="text-2xl">{title}</h2>
        {aside && <p className="text-sm text-muted">{aside}</p>}
      </div>
      {children}
    </section>
  )
}

const empty = (text: string) => <p className="text-sm text-muted">{text}</p>

function Profile({ profile }: { profile: CharacterProfile }) {
  const records: [string, string][] = [
    ['Hours played', `${profile.hoursPlayed} h`],
    ['Days played', String(profile.daysPlayed)],
    ['Longest streak', plural(profile.longestStreak, 'day')],
    ['Longest session', formatMinutes(profile.longestSessionMinutes)],
    ['Character age', profile.ageDays === null ? 'Unknown' : plural(profile.ageDays, 'day')],
  ]

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-4xl">{profile.name}</h1>
        <p className="mt-1 text-muted">
          Level {profile.level} {profile.className}, {profile.race}, {profile.country}
        </p>
        {profile.progress !== null && (
          <div className="mt-3 max-w-md">
            <LevelProgress progress={profile.progress} />
          </div>
        )}
      </header>

      <Section title="Gear">
        <CharacterGear gear={profile.gear} caption={`Lv. ${profile.level} ${profile.className}`} />
      </Section>

      <Section title="Level freeze">
        <LevelFreezeSection characterId={String(profile.id)} />
      </Section>

      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Records">
          <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-sm">
            {records.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted">{label}</dt>
                <dd className="text-right">{value}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section title="Rankings">
          {!profile.ranked ? (
            empty('GM, not ranked.')
          ) : profile.rankings.length === 0 ? (
            empty('Not ranked in anything yet.')
          ) : (
            <dl className="grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-1.5 text-sm">
              {profile.rankings.map((ranking) => (
                <div key={ranking.category} className="contents">
                  <dd className="font-display text-accent-text">{ordinal(ranking.place)}</dd>
                  <dt className="text-muted">{ranking.label}</dt>
                  <dd className="text-right">{ranking.display}</dd>
                </div>
              ))}
            </dl>
          )}
        </Section>

        <Section title="Companions">
          {profile.companions.length === 0 ? (
            empty('No companions yet.')
          ) : (
            <ul className="flex flex-col gap-1.5 text-sm">
              {profile.companions.map((companion) => (
                <li key={companion.slot} className="flex justify-between gap-4">
                  <span>{companion.name}</span>
                  <span className="text-muted">Lv. {companion.level}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Titles" aside={`${profile.titles.length} of ${profile.titlesTotal} collected`}>
          {profile.titles.length === 0 ? (
            empty('No titles yet.')
          ) : (
            <ul className="flex flex-wrap gap-2 text-sm">
              {profile.titles.map((title) => (
                <li key={title} className="rounded-xs border border-line px-2 py-0.5">
                  {title}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  )
}
