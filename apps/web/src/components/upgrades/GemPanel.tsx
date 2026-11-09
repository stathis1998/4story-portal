import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { attemptGem, gemChance, MAX_GEMS, STONES, type Stone } from '../../lib/upgrade-simulator'
import { Button } from '../Button'
import { Select } from '../Select'
import { Total } from './Total'

const MAX_RUN = 100_000
const NO_TOTALS = { stones: 0, successes: 0, failures: 0 }
const START_OPTIONS = Array.from({ length: MAX_GEMS }, (_, gems) => ({ value: gems, label: String(gems) }))
const DEFAULTS = { start: 0, stone: 'flawless' as Stone }

const gemsText = (count: number) => `${count} gem${count === 1 ? '' : 's'}`
const stonesText = (count: number) => `${count.toLocaleString('en-US')} stone${count === 1 ? '' : 's'}`

export function GemPanel() {
  const { register, control, getValues } = useForm({ defaultValues: DEFAULTS })
  const stone = useWatch({ control, name: 'stone' })
  const [gems, setGems] = useState(DEFAULTS.start)
  const [message, setMessage] = useState('Choose a gemstone and press a button.')
  const [totals, setTotals] = useState(NO_TOTALS)

  const restart = () => {
    setGems(getValues('start'))
    setMessage('Choose a gemstone and press a button.')
  }

  const run = (keepGoing: (gems: number) => boolean) => {
    const chosen = getValues('stone')
    const next = { ...totals }
    let current = gems
    let used = 0
    let succeeded: boolean
    do {
      const result = attemptGem(current, chosen)
      used += 1
      current = result.gem
      succeeded = result.success
      next.stones += 1
      if (result.success) next.successes += 1
      else next.failures += 1
    } while (keepGoing(current) && used < MAX_RUN)
    setGems(current)
    setTotals(next)
    return { used, current, succeeded }
  }

  const addOne = () => {
    const { current, succeeded } = run(() => false)
    setMessage(succeeded ? `Success! The item now has ${gemsText(current)}.` : `It failed and the item now has ${gemsText(current)}.`)
  }

  const addToFull = () => {
    const { used, current } = run((value) => value < MAX_GEMS)
    setMessage(`${current >= MAX_GEMS ? 'Reached' : 'Stopped at'} ${gemsText(current)} after ${stonesText(used)}.`)
  }

  const chance = gemChance(gems, stone)
  const full = gems >= MAX_GEMS

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-5 rounded-xs border border-line bg-surface p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Starting gems" registration={register('start', { valueAsNumber: true, onChange: restart })} options={START_OPTIONS} />
          <Select label="Gemstone" registration={register('stone')} options={[...STONES]} />
        </div>

        <div className="flex flex-wrap items-center gap-6">
          <p className="text-xl font-bold">Current gems: {gems}</p>
          {!full && (
            <div>
              <p className="text-xs font-bold tracking-wider text-muted uppercase">Chance</p>
              <p className="text-xl font-bold text-accent-text">{chance}%</p>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-3">
          <Button onClick={addOne} disabled={full}>
            Add one gemstone
          </Button>
          <Button variant="secondary" onClick={addToFull} disabled={full || chance === 0}>
            Keep adding to 5 gems
          </Button>
        </div>

        {stone === 'plain' && <p className="text-sm text-muted">A plain Gemstone can never take an item from 2 gems to 3.</p>}
        <p role="status">{message}</p>
      </section>

      <section aria-label="Your totals" className="rounded-xs border border-line bg-surface p-5">
        <dl className="grid grid-cols-3 gap-4">
          <Total name="Gemstones used" value={totals.stones} />
          <Total name="Successes" value={totals.successes} />
          <Total name="Failures" value={totals.failures} />
        </dl>
        {totals.stones > 0 && (
          <Button variant="secondary" size="sm" onClick={() => setTotals(NO_TOTALS)} className="mt-4">
            Reset
          </Button>
        )}
      </section>
    </div>
  )
}
