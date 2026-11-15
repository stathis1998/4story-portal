import type { RebirthLogEntry, RebirthSettings } from '@4story-portal/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { Button } from '../../../components/Button'
import { FormMessage } from '../../../components/FormMessage'
import { GmNav } from '../../../components/gm/GmNav'
import { TextField } from '../../../components/TextField'
import { applyServerError } from '../../../lib/form-errors'
import { gmRebirthQueryOptions, saveRebirthSettings } from '../../../lib/rebirth'
import { meQueryOptions } from '../../../lib/session'
import { formatSpinTime } from '../../../lib/wheel'

export const Route = createFileRoute('/_authed/gm/rebirth')({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions)
    if (!me?.isGm) throw redirect({ to: '/characters' })
  },
  component: GmRebirthPage,
})

const labelText = 'text-xs font-bold tracking-wider text-muted uppercase'
const grouped = (n: number) => n.toLocaleString('en-US')

function GmRebirthPage() {
  const queryClient = useQueryClient()
  const queryOptions = gmRebirthQueryOptions()
  const { data, isError } = useQuery(queryOptions)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const {
    register,
    handleSubmit,
    setError: setFieldError,
    clearErrors,
    control,
    setValue,
    formState: { errors },
  } = useForm<RebirthSettings>({ values: data?.settings })

  const save = useMutation({
    mutationFn: saveRebirthSettings,
    onSuccess: (state) => queryClient.setQueryData(queryOptions.queryKey, state),
  })

  const [liveValue, percent, limit] = useWatch({ control, name: ['live', 'percent', 'limit'] })
  const live = liveValue ?? false
  const top = Number(percent) * Number(limit)

  async function onSubmit(values: RebirthSettings) {
    setError(null)
    setSaved(false)
    clearErrors()
    const input = {
      live: values.live,
      priceGold: Number(values.priceGold),
      percent: Number(values.percent),
      limit: Number(values.limit),
    }
    let invalid = false
    for (const key of ['priceGold', 'percent', 'limit'] as const) {
      if (!Number.isInteger(input[key])) {
        setFieldError(key, { message: 'Enter a whole number' })
        invalid = true
      }
    }
    if (invalid) return
    try {
      await save.mutateAsync(input)
      setSaved(true)
    } catch (err) {
      setError(applyServerError(err, setFieldError))
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 md:py-10">
      <GmNav />
      <h1 className="text-4xl">Rebirth</h1>
      <p className="mt-2 text-sm text-muted">
        {
          "Players can send a level 90 character back to level 1 for Gold and keep a lasting bonus to all stats. A new price applies to the next rebirth. A new percent or limit changes every reborn character's bonus at its next login."
        }
      </p>

      <div className="mt-6 flex flex-col gap-6">
        <FormMessage message={isError && !data ? 'Could not load rebirth.' : null} />
        {data && (
          <>
            <form
              aria-label="Rebirth settings"
              noValidate
              onSubmit={(event) => void handleSubmit(onSubmit)(event)}
              className="flex flex-col gap-4 rounded-xs border border-line bg-surface p-4"
            >
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span id="rebirth-live-label" className={labelText}>
                  Rebirth is open
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={live}
                  aria-labelledby="rebirth-live-label"
                  onClick={() => setValue('live', !live, { shouldDirty: true })}
                  className={`flex items-center gap-2 rounded-xs border px-3 py-1.5 text-sm font-bold tracking-wide transition outline-none focus-visible:ring-2 focus-visible:ring-accent-text focus-visible:ring-offset-2 focus-visible:ring-offset-bg ${
                    live ? 'border-accent text-accent-text' : 'border-secondary/50 text-secondary'
                  }`}
                >
                  <span aria-hidden="true" className={`relative h-4 w-7 rounded-full transition ${live ? 'bg-accent' : 'bg-line'}`}>
                    <span className={`absolute top-0.5 size-3 rounded-full bg-fg transition-all ${live ? 'left-3.5' : 'left-0.5'}`} />
                  </span>
                  {live ? 'On' : 'Off'}
                </button>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <TextField
                  label="Price of the first rebirth (Gold)"
                  type="number"
                  registration={register('priceGold', { valueAsNumber: true })}
                  error={errors.priceGold?.message}
                />
                <TextField
                  label="Bonus per rebirth (%)"
                  type="number"
                  registration={register('percent', { valueAsNumber: true })}
                  error={errors.percent?.message}
                />
                <TextField
                  label="Most rebirths"
                  type="number"
                  registration={register('limit', { valueAsNumber: true })}
                  error={errors.limit?.message}
                />
              </div>
              <p className="text-sm text-muted">
                {`Rebirth 2 costs twice the price, rebirth 3 three times. A character at the limit has +${Number.isFinite(top) ? top : 0}% to all stats.`}
              </p>
              <FormMessage message={error} />
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" disabled={save.isPending}>
                  Save
                </Button>
                {saved && (
                  <p role="status" className="text-sm">
                    Saved.
                  </p>
                )}
              </div>
            </form>

            <section aria-labelledby="rebirth-recent-heading" className="flex flex-col gap-3">
              <h2 id="rebirth-recent-heading" className="text-2xl">
                Recent rebirths
              </h2>
              <p className="text-sm">{`Characters reborn: ${grouped(data.reborn)}`}</p>
              <RecentRebirths entries={data.recent} />
            </section>
          </>
        )}
      </div>
    </main>
  )
}

function RecentRebirths({ entries }: { entries: RebirthLogEntry[] }) {
  if (entries.length === 0) {
    return <p className="rounded-xs border border-dashed border-line p-10 text-center text-muted">Nobody has been reborn yet.</p>
  }
  return (
    <div className="overflow-x-auto rounded-xs border border-line bg-surface">
      <table className="w-full text-left text-sm">
        <thead className={labelText}>
          <tr>
            {['When', 'Character', 'Rebirth', 'Bonus', 'Price'].map((title) => (
              <th key={title} scope="col" className="px-3 py-2">
                {title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-t border-line">
              <td className="px-3 py-2 whitespace-nowrap text-muted">{formatSpinTime(entry.at)}</td>
              <td className="px-3 py-2 font-bold">{entry.name}</td>
              <td className="px-3 py-2">{entry.rebirth}</td>
              <td className="px-3 py-2">{`+${entry.bonus}%`}</td>
              <td className="px-3 py-2">{`${grouped(entry.priceGold)} Gold`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
