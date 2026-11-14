import { type GmRoulette, rouletteColour, rouletteSettingsSchema, type RouletteTotals, silverText } from '@4story-portal/shared'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { type FormEvent, useId, useState } from 'react'
import { Button } from '../../../components/Button'
import { FormMessage } from '../../../components/FormMessage'
import { GmNav } from '../../../components/gm/GmNav'
import { gmRouletteQueryOptions, rouletteErrorMessage, useSaveRouletteSettings } from '../../../lib/roulette'
import { meQueryOptions } from '../../../lib/session'
import { formatSpinTime } from '../../../lib/wheel'

export const Route = createFileRoute('/_authed/gm/roulette')({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions)
    if (!me?.isGm) throw redirect({ to: '/characters' })
  },
  component: GmRoulettePage,
})

const labelText = 'text-xs font-bold tracking-wider text-muted uppercase'
const BADGE = { red: 'bg-accent text-accent-fg', black: 'bg-[#1b1616] text-fg', green: 'bg-[#1f7a4a] text-white' }

const FIELDS = [
  { key: 'minBet', label: 'Smallest bet' },
  { key: 'maxNumber', label: 'Largest bet on a number' },
  { key: 'maxOutside', label: 'Largest bet on another spot' },
] as const
type LimitKey = (typeof FIELDS)[number]['key']
type Typed = Record<LimitKey, string>

const WHOLE = /^\d+$/

/** The house's side of the table: what it took less what it paid, with a minus sign when it is down. */
const houseResult = (totals: RouletteTotals) => {
  const result = totals.staked - totals.paid
  return result < 0 ? `-${silverText(-result)}` : silverText(result)
}

function GmRoulettePage() {
  const { data, isError } = useQuery(gmRouletteQueryOptions)
  const save = useSaveRouletteSettings()
  /** What is typed in the limits form, or null while it shows the saved limits. */
  const [draft, setDraft] = useState<Typed | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<LimitKey, string>>>({})
  const [error, setError] = useState<string | null>(null)
  const idPrefix = useId()

  const saved = (): Typed | null =>
    data ? { minBet: String(data.limits.minBet), maxNumber: String(data.limits.maxNumber), maxOutside: String(data.limits.maxOutside) } : null

  async function toggleLive() {
    if (!data) return
    setError(null)
    try {
      await save.mutateAsync({ live: !data.live, ...data.limits })
    } catch (err) {
      setError(rouletteErrorMessage(err))
    }
  }

  async function saveLimits(event: FormEvent) {
    event.preventDefault()
    const typed = draft ?? saved()
    if (!data || !typed) return
    setError(null)
    const errors: Partial<Record<LimitKey, string>> = {}
    const numbers = {} as Record<LimitKey, number>
    for (const { key } of FIELDS) {
      if (WHOLE.test(typed[key].trim())) numbers[key] = Number(typed[key])
      else errors[key] = 'Enter a whole number'
    }
    if (Object.keys(errors).length === 0) {
      const parsed = rouletteSettingsSchema.safeParse({ live: data.live, ...numbers })
      if (parsed.success) {
        setFieldErrors({})
        try {
          await save.mutateAsync(parsed.data)
          setDraft(null)
        } catch (err) {
          setError(rouletteErrorMessage(err))
        }
        return
      }
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as LimitKey
        errors[key] ??= issue.message
      }
    }
    setFieldErrors(errors)
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 md:py-10">
      <GmNav />
      <h1 className="text-4xl">Roulette</h1>
      <p className="mt-2 text-sm text-muted">
        The table players bet at. The switch and the limits take effect from the next spin. All money here is in Gold and Silver.
      </p>

      <div className="mt-6 flex flex-col gap-6">
        <FormMessage message={isError && !data ? 'Could not load the roulette table.' : null} />
        {data && (
          <>
            <section aria-label="Status" className="flex flex-col gap-4 rounded-xs border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span id="roulette-live-label" className={labelText}>
                  Table open
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={data.live}
                  aria-labelledby="roulette-live-label"
                  disabled={save.isPending}
                  onClick={() => void toggleLive()}
                  className={`flex items-center gap-2 rounded-xs border px-3 py-1.5 text-sm font-bold tracking-wide transition outline-none focus-visible:ring-2 focus-visible:ring-accent-text focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-60 ${
                    data.live ? 'border-accent text-accent-text' : 'border-secondary/50 text-secondary'
                  }`}
                >
                  <span aria-hidden="true" className={`relative h-4 w-7 rounded-full transition ${data.live ? 'bg-accent' : 'bg-line'}`}>
                    <span className={`absolute top-0.5 size-3 rounded-full bg-fg transition-all ${data.live ? 'left-3.5' : 'left-0.5'}`} />
                  </span>
                  {data.live ? 'On' : 'Off'}
                </button>
                <p className="text-sm text-muted">{data.live ? 'Players can bet.' : 'Players see the table and cannot bet.'}</p>
              </div>
              <FormMessage message={error} />
            </section>

            <form
              aria-labelledby="roulette-limits-heading"
              noValidate
              onSubmit={(event) => void saveLimits(event)}
              className="flex flex-col gap-4 rounded-xs border border-line bg-surface p-4"
            >
              <h2 id="roulette-limits-heading" className="text-2xl">
                Limits
              </h2>
              <div className="grid gap-4 sm:grid-cols-3">
                {FIELDS.map(({ key, label }) => {
                  const value = (draft ?? saved())?.[key] ?? ''
                  const id = `${idPrefix}-${key}`
                  return (
                    <div key={key} className="flex flex-col gap-1">
                      <label htmlFor={id} className={labelText}>
                        {label}
                      </label>
                      <input
                        id={id}
                        type="number"
                        inputMode="numeric"
                        min={1}
                        value={value}
                        aria-invalid={fieldErrors[key] ? true : undefined}
                        onChange={(event) => setDraft({ ...(draft ?? saved()!), [key]: event.target.value })}
                        className="rounded-xs border border-line bg-bg px-3 py-2 tabular-nums"
                      />
                      <span className="text-sm text-muted">{WHOLE.test(value.trim()) ? silverText(Number(value)) : ''}</span>
                      {fieldErrors[key] && (
                        <p role="alert" className="text-sm text-danger">
                          {fieldErrors[key]}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
              <div>
                <Button type="submit" disabled={save.isPending}>
                  Save limits
                </Button>
              </div>
            </form>

            <section aria-label="Totals" className="grid gap-4 sm:grid-cols-2">
              <Totals title="Today" totals={data.today} />
              <Totals title="All time" totals={data.allTime} />
            </section>

            <LatestSpins spins={data.latest} />
          </>
        )}
      </div>
    </main>
  )
}

function Totals({ title, totals }: { title: string; totals: RouletteTotals }) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3 rounded-xs border border-line bg-surface p-4">
      <h2 id={headingId} className="text-2xl">
        {title}
      </h2>
      <dl className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
        <div className="flex flex-col gap-0.5">
          <dt className={labelText}>Spins</dt>
          <dd>{totals.spins.toLocaleString('en-US')}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className={labelText}>Staked</dt>
          <dd>{silverText(totals.staked)}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className={labelText}>Paid out</dt>
          <dd>{silverText(totals.paid)}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className={labelText}>House result</dt>
          <dd className="font-bold">{houseResult(totals)}</dd>
        </div>
      </dl>
    </section>
  )
}

function LatestSpins({ spins }: { spins: GmRoulette['latest'] }) {
  return (
    <section aria-labelledby="roulette-latest-heading" className="flex flex-col gap-3">
      <h2 id="roulette-latest-heading" className="text-2xl">
        Latest spins
      </h2>
      {spins.length === 0 ? (
        <p className="rounded-xs border border-dashed border-line p-10 text-center text-muted">Nobody has spun yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xs border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className={labelText}>
              <tr>
                <th scope="col" className="px-3 py-2">
                  When
                </th>
                <th scope="col" className="px-3 py-2">
                  Character
                </th>
                <th scope="col" className="px-3 py-2">
                  Number
                </th>
                <th scope="col" className="px-3 py-2">
                  Staked
                </th>
                <th scope="col" className="px-3 py-2">
                  Paid
                </th>
              </tr>
            </thead>
            <tbody>
              {spins.map((spin) => {
                const colour = rouletteColour(spin.pocket)
                return (
                  <tr key={spin.id} className="border-t border-line">
                    <td className="px-3 py-2 whitespace-nowrap text-muted">{formatSpinTime(spin.at)}</td>
                    <td className="px-3 py-2 font-bold">{spin.character}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/25 font-bold tabular-nums ${BADGE[colour]}`}
                      >
                        {spin.pocket}
                        <span className="sr-only"> {colour}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2">{silverText(spin.stake)}</td>
                    <td className="px-3 py-2">{silverText(spin.payout)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
