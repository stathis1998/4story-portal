import { type GmWheelPrize, WHEEL_MAX_PRIZES, type WheelPrizeInput } from '@4story-portal/shared'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '../../../components/Button'
import { FormMessage } from '../../../components/FormMessage'
import { GmNav } from '../../../components/gm/GmNav'
import { PrizeEditor } from '../../../components/gm/PrizeEditor'
import { RewardSummary } from '../../../components/stats/RewardSummary'
import { StatusBadge } from '../../../components/StatusBadge'
import { meQueryOptions } from '../../../lib/session'
import { formatChance, gmWheelQueryOptions, useChangeWheel, wheelErrorMessage } from '../../../lib/wheel'

export const Route = createFileRoute('/_authed/gm/wheel')({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions)
    if (!me?.isGm) throw redirect({ to: '/characters' })
  },
  component: GmWheelPage,
})

const labelText = 'text-xs font-bold tracking-wider text-muted uppercase'
const NEW = 'new'

function GmWheelPage() {
  const { data, isError } = useQuery(gmWheelQueryOptions)
  const change = useChangeWheel()
  /** The prize whose editor is open: its ID, NEW for the add form, or null. */
  const [editing, setEditing] = useState<number | typeof NEW | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function toggleLive() {
    if (!data) return
    const live = !data.live
    if (live && !window.confirm('Open the wheel? Players can spin for these prizes straight away.')) return
    setError(null)
    try {
      await change.mutateAsync({ kind: 'live', live })
    } catch (err) {
      setError(wheelErrorMessage(err))
    }
  }

  async function save(prize: WheelPrizeInput) {
    if (editing === null) return
    setSaveError(null)
    try {
      await change.mutateAsync(editing === NEW ? { kind: 'add', prize } : { kind: 'save', id: editing, prize })
      setEditing(null)
    } catch (err) {
      setSaveError(wheelErrorMessage(err))
    }
  }

  async function remove(prize: GmWheelPrize) {
    if (!window.confirm(`Delete the prize "${prize.name}"? Spins already made keep what they paid.`)) return
    setError(null)
    try {
      await change.mutateAsync({ kind: 'delete', id: prize.id })
    } catch (err) {
      setError(wheelErrorMessage(err))
    }
  }

  const open = (target: number | typeof NEW) => {
    setSaveError(null)
    setEditing(target)
  }

  const prizes = data?.prizes ?? []
  const onWheel = prizes.filter((prize) => prize.enabled)
  const nextOrder = prizes.reduce((highest, prize) => Math.max(highest, prize.order), 0) + 10

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 md:py-10">
      <GmNav />
      <h1 className="text-4xl">Wheel of Fortune</h1>
      <p className="mt-2 text-sm text-muted">
        The prizes players spin for, once a day. A prize's chance is its weight out of the total weight of the prizes on the wheel. A
        change takes effect from the next spin.
      </p>

      <div className="mt-6 flex flex-col gap-6">
        <FormMessage message={isError && !data ? 'Could not load the wheel.' : null} />
        {data && (
          <>
            <section aria-label="Status" className="flex flex-col gap-4 rounded-xs border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span id="wheel-live-label" className={labelText}>
                  Wheel open
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={data.live}
                  aria-labelledby="wheel-live-label"
                  disabled={change.isPending}
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
                <p className="text-sm text-muted">
                  {data.live ? 'Players can spin once a day.' : 'Players see the wheel and its prizes, and cannot spin.'}
                </p>
              </div>

              <dl className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
                <div className="flex flex-col gap-0.5">
                  <dt className={labelText}>Control server</dt>
                  <dd>
                    <StatusBadge state={data.control} />
                  </dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className={labelText}>Spins today</dt>
                  <dd>{data.spinsToday.toLocaleString('en-US')}</dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className={labelText}>On the wheel</dt>
                  <dd>
                    {onWheel.length} of {prizes.length} prizes
                  </dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className={labelText}>Total weight</dt>
                  <dd>{onWheel.reduce((sum, prize) => sum + prize.weight, 0).toLocaleString('en-US')}</dd>
                </div>
              </dl>
              <FormMessage message={error} />
            </section>

            <section aria-labelledby="wheel-prizes-heading" className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="wheel-prizes-heading" className="text-2xl">
                  Prizes
                </h2>
                {editing !== NEW && (
                  <Button size="sm" onClick={() => open(NEW)} disabled={prizes.length >= WHEEL_MAX_PRIZES}>
                    Add prize
                  </Button>
                )}
              </div>
              {prizes.length >= WHEEL_MAX_PRIZES && <p className="text-sm text-muted">The wheel holds at most {WHEEL_MAX_PRIZES} prizes.</p>}

              {editing === NEW && (
                <div className="rounded-xs border border-line bg-surface p-3">
                  <PrizeEditor
                    prize={null}
                    nextOrder={nextOrder}
                    saving={change.isPending}
                    error={saveError}
                    onSave={(prize) => void save(prize)}
                    onCancel={() => setEditing(null)}
                  />
                </div>
              )}

              {prizes.length === 0 ? (
                <p className="rounded-xs border border-dashed border-line p-10 text-center text-muted">The wheel has no prizes yet.</p>
              ) : (
                <ul aria-label="Prizes" className="rounded-xs border border-line bg-surface">
                  {prizes.map((prize) => (
                    <li key={prize.id} className="border-b border-line px-3 py-2 text-sm last:border-b-0">
                      {editing === prize.id ? (
                        <PrizeEditor
                          prize={prize}
                          nextOrder={nextOrder}
                          saving={change.isPending}
                          error={saveError}
                          onSave={(input) => void save(input)}
                          onCancel={() => setEditing(null)}
                        />
                      ) : (
                        <div className={`grid items-center gap-x-4 gap-y-1 sm:grid-cols-[3rem_14rem_1fr_9rem_auto] ${prize.enabled ? '' : 'opacity-60'}`}>
                          <span className="text-muted tabular-nums" title="Position on the wheel">
                            #{prize.order}
                          </span>
                          <span className="font-bold">
                            {prize.announce && (
                              <span className="text-accent-text" title="Announced in game">
                                ★{' '}
                              </span>
                            )}
                            {prize.name}
                          </span>
                          <span>{prize.reward ? <RewardSummary reward={prize.reward} names /> : <span className="text-muted">No prize</span>}</span>
                          <span className="tabular-nums">
                            {prize.enabled ? (
                              <>
                                Weight {prize.weight} <span className="font-bold">({formatChance(prize.chance)})</span>
                              </>
                            ) : (
                              <span className="text-muted">Off the wheel</span>
                            )}
                          </span>
                          <div className="flex gap-2">
                            <Button variant="secondary" size="sm" aria-label={`Edit prize ${prize.name}`} onClick={() => open(prize.id)}>
                              Edit
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              aria-label={`Delete prize ${prize.name}`}
                              disabled={change.isPending}
                              onClick={() => void remove(prize)}
                            >
                              Delete
                            </Button>
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  )
}
