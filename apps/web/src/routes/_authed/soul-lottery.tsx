import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Button } from '../../components/Button'
import { Select } from '../../components/Select'
import { formatCopper, MAX_LOTTERY_LEVEL, rollSoulLottery, type SoulLotteryRoll } from '../../lib/soul-lottery'

export const Route = createFileRoute('/_authed/soul-lottery')({
  component: SoulLotteryPage,
})

const LEVEL_OPTIONS = Array.from({ length: MAX_LOTTERY_LEVEL }, (_, index) => ({ value: index + 1, label: `Level ${index + 1}` }))
const NO_TOTALS = { played: 0, won: 0, copper: 0 }

function SoulLotteryPage() {
  const { register, getValues } = useForm({ defaultValues: { level: 60 } })
  const [roll, setRoll] = useState<SoulLotteryRoll | null>(null)
  const [totals, setTotals] = useState(NO_TOTALS)

  const play = () => {
    const next = rollSoulLottery(getValues('level'))
    setRoll(next)
    setTotals((current) => ({
      played: current.played + 1,
      won: current.won + (next.won ? 1 : 0),
      copper: current.copper + next.copper,
    }))
  }

  const reset = () => {
    setRoll(null)
    setTotals(NO_TOTALS)
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-4xl">Soul Lottery Simulator</h1>
      <p className="mt-1 mb-6 text-muted">
        Same odds and prizes as the game: you get 4 numbers out of 30, and one number is drawn. Just for fun, nothing here changes your
        characters or gold.
      </p>

      <section className="flex flex-col gap-5 rounded-xs border border-line bg-surface p-5">
        <div className="flex flex-wrap items-end gap-3">
          <Select label="Character level" registration={register('level', { valueAsNumber: true })} options={LEVEL_OPTIONS} />
          <Button onClick={play}>Play the lottery</Button>
        </div>

        <div role="status" className="min-h-32">
          {roll ? <RollResult roll={roll} /> : <p className="text-muted">Press the button to play.</p>}
        </div>
      </section>

      <section aria-label="Your totals" className="mt-4 rounded-xs border border-line bg-surface p-5">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Total name="Played" value={totals.played.toLocaleString('en-US')} />
          <Total name="Won" value={totals.won.toLocaleString('en-US')} />
          <Total name="Lost" value={(totals.played - totals.won).toLocaleString('en-US')} />
          <Total name="Gold" value={formatCopper(totals.copper)} />
        </dl>
        {totals.played > 0 && (
          <Button variant="secondary" size="sm" onClick={reset} className="mt-4">
            Reset
          </Button>
        )}
      </section>
    </main>
  )
}

function RollResult({ roll }: { roll: SoulLotteryRoll }) {
  return (
    <div className="flex flex-col gap-3">
      <ul aria-label="Your numbers" className="flex gap-2">
        {roll.numbers.map((number) => (
          <li
            key={number}
            className={`flex size-11 items-center justify-center rounded-xs border font-bold ${
              number === roll.drawn ? 'border-accent bg-accent text-accent-fg' : 'border-line bg-surface-raised'
            }`}
          >
            {number}
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted">Drawn number: {roll.drawn}</p>
      {roll.won ? (
        <p className="text-2xl font-bold text-accent-text">You won {formatCopper(roll.copper)}</p>
      ) : (
        <div>
          <p className="text-2xl font-bold">You lost and got {formatCopper(roll.copper)}</p>
          <p className="text-sm text-muted">The prize was {formatCopper(roll.prize)}</p>
        </div>
      )}
    </div>
  )
}

function Total({ name, value }: { name: string; value: string }) {
  const id = `soul-lottery-total-${name.toLowerCase()}`

  return (
    <div>
      <dt id={id} className="text-xs font-bold tracking-wider text-muted uppercase">
        {name}
      </dt>
      <dd aria-labelledby={id} className="text-xl font-bold">
        {value}
      </dd>
    </div>
  )
}
