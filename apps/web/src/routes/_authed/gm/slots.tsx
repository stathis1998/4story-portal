import {
  type GmSlotMachine,
  type GmSlotPot,
  type GmSlots,
  type SlotMachine,
  SLOT_DAILY_MAX,
  SLOT_DAILY_MIN,
  SLOT_JACKPOT_MAX_CAP,
  SLOT_JACKPOT_MIN_CAP,
  SLOT_MAX_STAKE,
  SLOT_MIN_STAKE,
  SLOT_POTS,
  type SlotPot,
  type SlotPotsSettingsInput,
  type SlotStakes,
  type SlotTotals,
  silverText,
  slotDailySchema,
  slotLargestWin,
  slotMachine,
  slotMachineSettingsSchema,
  slotPotsSettingsSchema,
  slotReturn,
} from '@4story-portal/shared'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { type FormEvent, useId, useState } from 'react'
import { Button } from '../../../components/Button'
import { FormMessage } from '../../../components/FormMessage'
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

/** A player who presses Spin again the moment it rests plays about this many rounds an hour. */
const NONSTOP_ROUNDS_PER_HOUR = 1200

/** The house's side of the machine: what it took less what it paid and what it sent to the jackpot, with a minus sign when it is down. */
const houseResult = (totals: SlotTotals) => {
  const result = totals.staked - totals.paid - totals.added
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

            <JackpotsSection jackpots={data.jackpots} />

            <DailySection limit={data.daily.limit} />

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

const POT_NAMES: Record<SlotPot, string> = { mini: 'Mini', major: 'Major', giga: 'Giga' }

function JackpotsSection({ jackpots }: { jackpots: GmSlotPot[] }) {
  const save = useSaveSlots()
  const headingId = useId()
  const idPrefix = useId()
  /** What is typed in each cap field, or nothing while it shows the saved cap. */
  const [draft, setDraft] = useState<Partial<Record<SlotPot, string>>>({})
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<SlotPot, string>>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const pots = SLOT_POTS.flatMap((key) => {
    const state = jackpots.find((jackpot) => jackpot.pot === key)
    return state ? [state] : []
  })
  const typedOf = (pot: GmSlotPot) => draft[pot.pot] ?? String(pot.setCap)

  /** All three pots as saved: the page always saves the three together. */
  const savedSettings = (): SlotPotsSettingsInput => {
    const settings = { mini: { live: true, cap: 1 }, major: { live: true, cap: 10 }, giga: { live: true, cap: 50 } }
    for (const pot of pots) settings[pot.pot] = { live: pot.live, cap: pot.setCap }
    return settings
  }

  async function toggleLive(key: SlotPot) {
    setError(null)
    // The saved caps, never the fields': half-typed numbers are not a save.
    const settings = savedSettings()
    settings[key] = { ...settings[key], live: !settings[key].live }
    try {
      await save.mutateAsync({ kind: 'jackpots', settings })
    } catch (err) {
      setError(slotsErrorMessage(err))
    }
  }

  async function saveCaps(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setFormError(null)
    const errors: Partial<Record<SlotPot, string>> = {}
    const settings = savedSettings()
    for (const pot of pots) {
      const text = typedOf(pot).trim()
      if (WHOLE.test(text)) settings[pot.pot] = { live: pot.live, cap: Number(text) }
      else errors[pot.pot] = 'Enter a whole number'
    }
    if (Object.keys(errors).length === 0) {
      const parsed = slotPotsSettingsSchema.safeParse(settings)
      if (parsed.success) {
        setFieldErrors({})
        try {
          await save.mutateAsync({ kind: 'jackpots', settings: parsed.data })
          setDraft({})
        } catch (err) {
          setError(slotsErrorMessage(err))
        }
        return
      }
      for (const issue of parsed.error.issues) {
        const [key, field] = issue.path
        if (field === 'cap' && typeof key === 'string' && key in POT_NAMES) errors[key as SlotPot] = `From ${SLOT_JACKPOT_MIN_CAP} to ${SLOT_JACKPOT_MAX_CAP.toLocaleString('en-US')} Gold`
        else setFormError(issue.message)
      }
    }
    setFieldErrors(errors)
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4 rounded-xs border border-line bg-surface p-4">
      <h2 id={headingId} className="text-2xl">
        Jackpots
      </h2>
      <p className="text-sm text-muted">Three pots, each fed by lost rounds and each dropping on its own. The caps must rise from Mini to Giga.</p>

      <form aria-label="Jackpot caps" noValidate onSubmit={(event) => void saveCaps(event)} className="flex flex-col gap-4">
        <div className="grid gap-4 lg:grid-cols-3">
          {pots.map((pot) => (
            <PotBox
              key={pot.pot}
              pot={pot}
              id={`${idPrefix}-${pot.pot}`}
              typed={typedOf(pot)}
              fieldError={fieldErrors[pot.pot]}
              disabled={save.isPending}
              onType={(text) => setDraft({ ...draft, [pot.pot]: text })}
              onToggle={() => void toggleLive(pot.pot)}
            />
          ))}
        </div>
        <FormMessage message={formError} />
        <div>
          <Button type="submit" disabled={save.isPending}>
            Save jackpots
          </Button>
        </div>
      </form>
      <FormMessage message={error} />
    </section>
  )
}

function PotBox({
  pot,
  id,
  typed,
  fieldError,
  disabled,
  onType,
  onToggle,
}: {
  pot: GmSlotPot
  id: string
  typed: string
  fieldError: string | undefined
  disabled: boolean
  onType: (text: string) => void
  onToggle: () => void
}) {
  const headingId = useId()
  const name = POT_NAMES[pot.pot]
  const typedCap = WHOLE.test(typed.trim()) ? Number(typed) : null
  const { running } = pot
  const wins = pot.wins.flatMap((spin) => {
    const rules = slotMachine(spin.machine)
    return rules ? [{ spin, rules }] : []
  })

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4 rounded-xs border border-line bg-bg p-4">
      <h3 id={headingId} className="text-xl">
        {name}
      </h3>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Switch label={`${name} on`} checked={pot.live} disabled={disabled} onToggle={onToggle} />
        <p className="text-sm text-muted">{pot.live ? 'Lost rounds add to the pot.' : 'The pot is kept. Lost rounds add nothing and it cannot drop.'}</p>
      </div>

      <div className="flex max-w-xs flex-col gap-1">
        <label htmlFor={id} className={labelText}>
          {name} cap, in Gold
        </label>
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={SLOT_JACKPOT_MIN_CAP}
          max={SLOT_JACKPOT_MAX_CAP}
          value={typed}
          aria-invalid={fieldError ? true : undefined}
          onChange={(event) => onType(event.target.value)}
          className="rounded-xs border border-line bg-surface px-3 py-2 tabular-nums"
        />
        {typedCap !== null && typedCap >= SLOT_JACKPOT_MIN_CAP && typedCap <= SLOT_JACKPOT_MAX_CAP && (
          <span className="text-sm text-muted">{`Can drop from ${silverText(typedCap * 100)}, must drop before ${silverText(typedCap * 1000)}.`}</span>
        )}
        {fieldError && (
          <p role="alert" className="text-sm text-danger">
            {fieldError}
          </p>
        )}
      </div>

      {running ? (
        <div className="flex flex-col gap-2 text-sm">
          <dl className="flex flex-col gap-0.5">
            <dt className={labelText}>Pot now</dt>
            <dd className="font-bold">{silverText(running.pot)}</dd>
          </dl>
          <p className="text-muted">
            {running.cap === pot.setCap * 1000
              ? `Must drop before ${silverText(running.cap)}.`
              : `This jackpot must drop before ${silverText(running.cap)}. The next one: ${silverText(pot.setCap * 1000)}.`}
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted">The jackpot's table is not in this database yet.</p>
      )}

      <dl className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
        <div className="flex flex-col gap-0.5">
          <dt className={labelText}>Added</dt>
          <dd>{silverText(pot.added)}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className={labelText}>Paid out</dt>
          <dd>{silverText(pot.paid)}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className={labelText}>Drops</dt>
          <dd>{pot.drops.toLocaleString('en-US')}</dd>
        </div>
      </dl>

      {wins.length === 0 ? (
        <p className="rounded-xs border border-dashed border-line p-6 text-center text-muted">Nobody has won this jackpot yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xs border border-line bg-surface">
          <table aria-label={`${name} drops`} className="w-full text-left text-sm">
            <thead className={labelText}>
              <tr>
                {['When', 'Character', 'Machine', 'Won'].map((title) => (
                  <th key={title} scope="col" className="px-3 py-2">
                    {title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {wins.map(({ spin, rules }) => (
                <tr key={spin.id} className="border-t border-line">
                  <td className="px-3 py-2 whitespace-nowrap text-muted">{formatSpinTime(spin.at)}</td>
                  <td className="px-3 py-2 font-bold">{spin.character}</td>
                  <td className="px-3 py-2">{rules.name}</td>
                  <td className="px-3 py-2">{silverText(spin.pots[pot.pot])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function DailySection({ limit }: { limit: number }) {
  const save = useSaveSlots()
  const headingId = useId()
  const fieldId = useId()
  /** What is typed, or null while the field shows the saved limit. */
  const [draft, setDraft] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const typed = draft ?? String(limit)

  async function saveLimit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (!WHOLE.test(typed.trim())) {
      setFieldError('Enter a whole number')
      return
    }
    const parsed = slotDailySchema.safeParse({ rounds: Number(typed) })
    if (!parsed.success) {
      setFieldError(`From ${SLOT_DAILY_MIN} to ${SLOT_DAILY_MAX.toLocaleString('en-US')} rounds`)
      return
    }
    setFieldError(null)
    try {
      await save.mutateAsync({ kind: 'daily', rounds: parsed.data.rounds })
      setDraft(null)
    } catch (err) {
      setError(slotsErrorMessage(err))
    }
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4 rounded-xs border border-line bg-surface p-4">
      <h2 id={headingId} className="text-2xl">
        Daily limit
      </h2>
      <p className="text-sm text-muted">The most rounds one account can play in a day, across all the machines. The day is the database's.</p>
      <form aria-label="Daily limit form" noValidate onSubmit={(event) => void saveLimit(event)} className="flex flex-col gap-4">
        <div className="flex max-w-xs flex-col gap-1">
          <label htmlFor={fieldId} className={labelText}>
            Rounds per account per day
          </label>
          <input
            id={fieldId}
            type="number"
            inputMode="numeric"
            min={SLOT_DAILY_MIN}
            max={SLOT_DAILY_MAX}
            value={typed}
            aria-invalid={fieldError ? true : undefined}
            onChange={(event) => setDraft(event.target.value)}
            className="rounded-xs border border-line bg-bg px-3 py-2 tabular-nums"
          />
          {fieldError && (
            <p role="alert" className="text-sm text-danger">
              {fieldError}
            </p>
          )}
        </div>
        <div>
          <Button type="submit" disabled={save.isPending}>
            Save limit
          </Button>
        </div>
      </form>
      <FormMessage message={error} />
    </section>
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
      // The schema has one message for every way three whole stakes can be wrong, and the form shows it as it stands.
      // A stake past what a number holds also fails on its own; that issue's wording is not the GM's.
      setFormError(parsed.error.issues.find((issue) => issue.path.length === 1)?.message ?? parsed.error.issues[0].message)
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
                  max={SLOT_MAX_STAKE}
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

      <p className="text-sm text-muted">The most one paid spin can win at these stakes is {silverText(slotLargestWin(rules, shown))}.</p>
      <p className="text-sm text-muted">Pays back {(slotReturn(rules) * 100).toFixed(1)}% by its reels.</p>
      <p className="text-sm text-muted">
        At 105%, a player spinning nonstop at {silverText(shown[2])} gains about {silverText((shown[2] * NONSTOP_ROUNDS_PER_HOUR * 5) / 100)} an hour.
      </p>

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
          <dt className={labelText}>To the jackpot</dt>
          <dd>{silverText(totals.added)}</dd>
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
          <table aria-labelledby="slots-latest-heading" className="w-full text-left text-sm">
            <thead className={labelText}>
              <tr>
                {['When', 'Character', 'Machine', 'Staked', 'Paid'].map((title) => (
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
                  <td className="px-3 py-2">{silverText(spin.stake)}</td>
                  <td className="px-3 py-2">
                    {spin.jackpot > 0 ? `Jackpot ${silverText(spin.jackpot)}` : silverText(spin.payout)}
                    {/* A round is the paid spin and its free spins: the paid amount is all of it. */}
                    {spin.free.length > 0 && ` with ${spin.free.length} free spins`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
