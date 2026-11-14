import {
  type GmSlotMachine,
  type GmSlots,
  type SlotMachine,
  SLOT_MAX_STAKE,
  SLOT_MIN_STAKE,
  type SlotStakes,
  type SlotTotals,
  silverText,
  slotLargestWin,
  slotMachine,
  slotMachineSettingsSchema,
  slotReturn,
  slotWindow,
} from '@4story-portal/shared'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { type FormEvent, useId, useState } from 'react'
import { Button } from '../../../components/Button'
import { FormMessage } from '../../../components/FormMessage'
import { GameIcon } from '../../../components/gm/GameIcon'
import { GmNav } from '../../../components/gm/GmNav'
import { meQueryOptions } from '../../../lib/session'
import { gmSlotsQueryOptions, slotsErrorMessage, useSaveSlots } from '../../../lib/slots'
import { formatSpinTime } from '../../../lib/wheel'

export const Route = createFileRoute('/_authed/gm/slots')({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions)
    if (!me?.isGm) throw redirect({ to: '/characters' })
  },
  component: GmSlotsPage,
})

const labelText = 'text-xs font-bold tracking-wider text-muted uppercase'

const STAKE_FIELDS = [
  { index: 0, label: 'Lowest stake' },
  { index: 1, label: 'Middle stake' },
  { index: 2, label: 'Highest stake' },
] as const
type Typed = [string, string, string]

const WHOLE = /^\d+$/

/** The house's side of the machine: what it took less what it paid, with a minus sign when it is down. */
const houseResult = (totals: SlotTotals) => {
  const result = totals.staked - totals.paid
  return result < 0 ? `-${silverText(-result)}` : silverText(result)
}

const paidBack = (totals: SlotTotals) => (totals.staked > 0 ? `${((totals.paid / totals.staked) * 100).toFixed(1)}%` : '-')

function Switch({ label, checked, disabled, onToggle }: { label: string; checked: boolean; disabled: boolean; onToggle: () => void }) {
  const labelId = useId()
  return (
    <>
      <span id={labelId} className={labelText}>
        {label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        disabled={disabled}
        onClick={onToggle}
        className={`flex items-center gap-2 rounded-xs border px-3 py-1.5 text-sm font-bold tracking-wide transition outline-none focus-visible:ring-2 focus-visible:ring-accent-text focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-60 ${
          checked ? 'border-accent text-accent-text' : 'border-secondary/50 text-secondary'
        }`}
      >
        <span aria-hidden="true" className={`relative h-4 w-7 rounded-full transition ${checked ? 'bg-accent' : 'bg-line'}`}>
          <span className={`absolute top-0.5 size-3 rounded-full bg-fg transition-all ${checked ? 'left-3.5' : 'left-0.5'}`} />
        </span>
        {checked ? 'On' : 'Off'}
      </button>
    </>
  )
}

function GmSlotsPage() {
  const { data, isError } = useQuery(gmSlotsQueryOptions)
  const save = useSaveSlots()
  const [error, setError] = useState<string | null>(null)

  async function toggleFloor() {
    if (!data) return
    setError(null)
    try {
      await save.mutateAsync({ kind: 'floor', live: !data.live })
    } catch (err) {
      setError(slotsErrorMessage(err))
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 md:py-10">
      <GmNav />
      <h1 className="text-4xl">Slots</h1>
      <p className="mt-2 text-sm text-muted">
        The machines players spin. The switches and the stakes take effect from the next spin. All money here is in Gold and Silver.
      </p>

      <div className="mt-6 flex flex-col gap-6">
        <FormMessage message={isError && !data ? 'Could not load the slot machines.' : null} />
        {data && (
          <>
            <section aria-label="Status" className="flex flex-col gap-4 rounded-xs border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <Switch label="Slots open" checked={data.live} disabled={save.isPending} onToggle={() => void toggleFloor()} />
                <p className="text-sm text-muted">{data.live ? 'Players can spin.' : 'Players see the machines and cannot spin.'}</p>
              </div>
              <FormMessage message={error} />
            </section>

            {data.machines.map((state) => {
              const rules = slotMachine(state.key)
              return rules ? <MachineSection key={state.key} state={state} rules={rules} /> : null
            })}

            <LatestSpins spins={data.latest} />
          </>
        )}
      </div>
    </main>
  )
}

function MachineSection({ state, rules }: { state: GmSlotMachine; rules: SlotMachine }) {
  const save = useSaveSlots()
  const headingId = useId()
  const idPrefix = useId()
  /** What is typed in the stakes form, or null while it shows the saved stakes. */
  const [draft, setDraft] = useState<Typed | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<number, string>>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const saved = (): Typed => state.stakes.map(String) as Typed
  const typed = draft ?? saved()
  // The largest win follows what is typed while it is usable, and the saved stakes otherwise.
  const shown: SlotStakes = typed.every((text) => WHOLE.test(text.trim())) ? (typed.map(Number) as SlotStakes) : state.stakes

  async function toggleLive() {
    setError(null)
    // The saved stakes, never the form's: half-typed numbers are not a save.
    try {
      await save.mutateAsync({ kind: 'machine', key: state.key, settings: { live: !state.live, stakes: state.stakes } })
    } catch (err) {
      setError(slotsErrorMessage(err))
    }
  }

  async function saveStakes(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setFormError(null)
    const errors: Partial<Record<number, string>> = {}
    const numbers = typed.map((text, index) => {
      if (WHOLE.test(text.trim())) return Number(text)
      errors[index] = 'Enter a whole number'
      return 0
    })
    if (Object.keys(errors).length === 0) {
      const parsed = slotMachineSettingsSchema.safeParse({ live: state.live, stakes: numbers })
      if (parsed.success) {
        setFieldErrors({})
        try {
          await save.mutateAsync({ kind: 'machine', key: state.key, settings: parsed.data })
          setDraft(null)
        } catch (err) {
          setError(slotsErrorMessage(err))
        }
        return
      }
      for (const issue of parsed.error.issues) {
        const index = issue.path[1]
        if (typeof index === 'number') errors[index] ??= `From ${SLOT_MIN_STAKE} to ${SLOT_MAX_STAKE.toLocaleString('en-US')} Silver`
        else setFormError((current) => current ?? issue.message)
      }
    }
    setFieldErrors(errors)
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4 rounded-xs border border-line bg-surface p-4">
      <h2 id={headingId} className="text-2xl">
        {rules.name}
      </h2>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Switch label={`${rules.name} open`} checked={state.live} disabled={save.isPending} onToggle={() => void toggleLive()} />
      </div>

      <form aria-label={`${rules.name} stakes`} noValidate onSubmit={(event) => void saveStakes(event)} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          {STAKE_FIELDS.map(({ index, label }) => {
            const id = `${idPrefix}-${index}`
            const value = typed[index]
            return (
              <div key={index} className="flex flex-col gap-1">
                <label htmlFor={id} className={labelText}>
                  {label}
                </label>
                <input
                  id={id}
                  type="number"
                  inputMode="numeric"
                  min={SLOT_MIN_STAKE}
                  value={value}
                  aria-invalid={fieldErrors[index] ? true : undefined}
                  onChange={(event) => {
                    const next: Typed = [...typed]
                    next[index] = event.target.value
                    setDraft(next)
                  }}
                  className="rounded-xs border border-line bg-bg px-3 py-2 tabular-nums"
                />
                <span className="text-sm text-muted">{WHOLE.test(value.trim()) ? silverText(Number(value)) : ''}</span>
                {fieldErrors[index] && (
                  <p role="alert" className="text-sm text-danger">
                    {fieldErrors[index]}
                  </p>
                )}
              </div>
            )
          })}
        </div>
        <FormMessage message={formError} />
        <div>
          <Button type="submit" disabled={save.isPending}>
            Save stakes
          </Button>
        </div>
      </form>
      <FormMessage message={error} />

      <p className="text-sm text-muted">The most one spin can win at these stakes is {silverText(slotLargestWin(rules, shown))}.</p>
      <p className="text-sm text-muted">Pays back {(slotReturn(rules) * 100).toFixed(1)}% by its reels.</p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Totals title="Today" totals={state.today} />
        <Totals title="All time" totals={state.allTime} />
      </div>
    </section>
  )
}

function Totals({ title, totals }: { title: string; totals: SlotTotals }) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3 rounded-xs border border-line bg-bg p-4">
      <h3 id={headingId} className="text-xl">
        {title}
      </h3>
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
        <div className="flex flex-col gap-0.5">
          <dt className={labelText}>Paid back so far</dt>
          <dd>{paidBack(totals)}</dd>
        </div>
      </dl>
    </section>
  )
}

function LatestSpins({ spins }: { spins: GmSlots['latest'] }) {
  const rows = spins.flatMap((spin) => {
    const rules = slotMachine(spin.machine)
    return rules ? [{ spin, rules }] : []
  })
  return (
    <section aria-labelledby="slots-latest-heading" className="flex flex-col gap-3">
      <h2 id="slots-latest-heading" className="text-2xl">
        Latest spins
      </h2>
      {rows.length === 0 ? (
        <p className="rounded-xs border border-dashed border-line p-10 text-center text-muted">Nobody has spun yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xs border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className={labelText}>
              <tr>
                {['When', 'Character', 'Machine', 'Symbols', 'Staked', 'Paid'].map((title) => (
                  <th key={title} scope="col" className="px-3 py-2">
                    {title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ spin, rules }) => (
                <tr key={spin.id} className="border-t border-line">
                  <td className="px-3 py-2 whitespace-nowrap text-muted">{formatSpinTime(spin.at)}</td>
                  <td className="px-3 py-2 font-bold">{spin.character}</td>
                  <td className="px-3 py-2">{rules.name}</td>
                  <td className="px-3 py-2">
                    {/* The win line is the middle row of each reel. */}
                    <span className="flex gap-1">
                      {slotWindow(rules, spin.stops).map((column, reel) => {
                        const symbol = rules.symbols[column[1]]
                        return <GameIcon key={reel} spriteId={symbol.sprite} size={28} alt={symbol.name} className="[image-rendering:pixelated]" />
                      })}
                    </span>
                  </td>
                  <td className="px-3 py-2">{silverText(spin.stake)}</td>
                  <td className="px-3 py-2">{silverText(spin.payout)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
