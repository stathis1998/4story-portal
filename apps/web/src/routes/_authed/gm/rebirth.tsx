import {
  type AchievementReward,
  type AchievementRewardInput,
  type GmRebirth,
  type GmRebirthReward,
  REBIRTH_MAX_NUMBER,
  type RebirthLogEntry,
  type RebirthSettings,
} from '@4story-portal/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { Button } from '../../../components/Button'
import { FormMessage } from '../../../components/FormMessage'
import { GmNav } from '../../../components/gm/GmNav'
import { RewardEditor } from '../../../components/gm/RewardEditor'
import { RewardSummary } from '../../../components/stats/RewardSummary'
import { TextField } from '../../../components/TextField'
import { paysSomething } from '../../../lib/achievements'
import { applyServerError } from '../../../lib/form-errors'
import { gmRebirthQueryOptions, saveRebirthReward, saveRebirthSettings } from '../../../lib/rebirth'
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
      expPercent: Number(values.expPercent),
      goldPercent: Number(values.goldPercent),
    }
    let invalid = false
    for (const key of ['priceGold', 'percent', 'limit', 'expPercent', 'goldPercent'] as const) {
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
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
                <TextField
                  label="EXP per rebirth"
                  type="number"
                  hint="0 = off"
                  registration={register('expPercent', { valueAsNumber: true })}
                  error={errors.expPercent?.message}
                />
                <TextField
                  label="Monster gold per rebirth"
                  type="number"
                  hint="0 = off"
                  registration={register('goldPercent', { valueAsNumber: true })}
                  error={errors.goldPercent?.message}
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

            <RewardsSection
              limit={data.settings.limit}
              rewards={data.rewards}
              onSaved={(state) => queryClient.setQueryData(queryOptions.queryKey, state)}
            />

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

type RewardsProps = { limit: number; rewards: GmRebirthReward[]; onSaved: (state: GmRebirth) => void }

function RewardsSection({ limit, rewards, onSaved }: RewardsProps) {
  const [editing, setEditing] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const editButtons = useRef<Record<number, HTMLButtonElement | null>>({})
  const returnTo = useRef<number | null>(null)
  const save = useMutation({
    mutationFn: ({ rebirth, reward }: { rebirth: number; reward: AchievementRewardInput }) => saveRebirthReward(rebirth, reward),
  })

  // Focus goes back to the Edit button of the row that was just closed.
  useEffect(() => {
    if (editing === null && returnTo.current !== null) {
      editButtons.current[returnTo.current]?.focus()
      returnTo.current = null
    }
  }, [editing])

  const rewardOf = (rebirth: number): AchievementReward | null => rewards.find((row) => row.rebirth === rebirth)?.reward ?? null
  const upToLimit = Array.from({ length: Math.min(limit, REBIRTH_MAX_NUMBER) }, (_, index) => index + 1)
  const beyond = rewards
    .map((row) => row.rebirth)
    .filter((rebirth) => rebirth > limit)
    .sort((a, b) => a - b)

  function close(rebirth: number) {
    returnTo.current = rebirth
    setEditing(null)
  }

  async function onSave(rebirth: number, reward: AchievementRewardInput) {
    setError(null)
    try {
      onSaved(await save.mutateAsync({ rebirth, reward }))
      close(rebirth)
    } catch (err) {
      setError(applyServerError(err, () => {}))
    }
  }

  const list = (numbers: number[], label: string) => (
    <ul aria-label={label} className="rounded-xs border border-line bg-surface">
      {numbers.map((rebirth) => {
        const reward = rewardOf(rebirth)
        return (
          <li key={rebirth} className="border-b border-line px-3 py-2 text-sm last:border-b-0">
            {editing === rebirth ? (
              <div className="flex flex-col gap-3">
                <p className="font-bold">{`Rebirth ${rebirth}`}</p>
                <RewardEditor
                  name={`Rebirth ${rebirth}`}
                  reward={reward}
                  saving={save.isPending}
                  error={error}
                  emptyNote="Saving with nothing removes this reward"
                  onSave={(input) => void onSave(rebirth, input)}
                  onCancel={() => close(rebirth)}
                />
              </div>
            ) : (
              <div className="grid items-center gap-x-4 gap-y-1 sm:grid-cols-[7rem_1fr_auto]">
                <span className="font-bold">{`Rebirth ${rebirth}`}</span>
                <span className="min-w-0">
                  {paysSomething(reward) ? <RewardSummary reward={reward} names /> : <span className="text-muted">Nothing</span>}
                </span>
                <div>
                  <Button
                    ref={(el) => {
                      editButtons.current[rebirth] = el
                    }}
                    variant="secondary"
                    size="sm"
                    aria-label={`Edit reward for rebirth ${rebirth}`}
                    onClick={() => {
                      setError(null)
                      setEditing(rebirth)
                    }}
                  >
                    Edit
                  </Button>
                </div>
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )

  return (
    <section aria-labelledby="rebirth-rewards-heading" className="flex flex-col gap-3">
      <div>
        <h2 id="rebirth-rewards-heading" className="text-2xl">
          Rewards
        </h2>
        <p className="mt-1 text-sm text-muted">
          A character gets this reward in a letter from Rebirth, waiting at its next login after the rebirth.
        </p>
      </div>
      {list(upToLimit, 'Rebirth rewards')}
      {beyond.length > 0 && (
        <>
          <h3 className="text-lg">Beyond the limit</h3>
          <p className="text-sm text-muted">These rewards are kept but cannot be reached until the limit is raised.</p>
          {list(beyond, 'Rewards beyond the limit')}
        </>
      )}
    </section>
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
