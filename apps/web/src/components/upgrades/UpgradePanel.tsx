import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { attemptUpgrade, MAX_LEVEL, POTIONS, SCROLLS, TINCTURES, upgradeChance, type UpgradeChoices, type UpgradeResult } from '../../lib/upgrade-simulator'
import { Button } from '../Button'
import { Select } from '../Select'
import { Total } from './Total'

const MAX_RUN = 100_000
const NO_TOTALS = { attempts: 0, successes: 0, potions: 0, tinctures: 0, destroyed: 0 }
const levels = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => ({ value: from + index, label: `+${from + index}` }))
const START_OPTIONS = levels(0, MAX_LEVEL - 1)
const TARGET_OPTIONS = levels(1, MAX_LEVEL)
const DEFAULTS = { start: 10, target: MAX_LEVEL, scroll: 'apprentice', potion: 0, tincture: 'none' } as UpgradeChoices & {
  start: number
  target: number
}

const attemptsText = (count: number) => `${count.toLocaleString('en-US')} attempt${count === 1 ? '' : 's'}`

export function UpgradePanel() {
  const { register, control, getValues } = useForm({ defaultValues: DEFAULTS })
  const { potion, target } = useWatch({ control })
  const [level, setLevel] = useState(DEFAULTS.start)
  const [destroyed, setDestroyed] = useState(false)
  const [message, setMessage] = useState('Choose your items and press a button.')
  const [totals, setTotals] = useState(NO_TOTALS)

  const newItem = () => {
    setLevel(getValues('start'))
    setDestroyed(false)
    setMessage('Choose your items and press a button.')
  }

  /** Runs attempts until `done`, and returns how it ended. */
  const run = (done: (level: number) => boolean) => {
    const choices = getValues()
    const next = { ...totals }
    let current = level
    let ended: boolean
    let attempts = 0
    let outcome: UpgradeResult
    do {
      outcome = attemptUpgrade(current, choices)
      attempts += 1
      current = outcome.level
      ended = outcome.outcome === 'destroyed'
      next.attempts += 1
      if (outcome.outcome === 'success') next.successes += 1
      if (choices.potion > 0) next.potions += 1
      if (outcome.tinctureUsed) next.tinctures += 1
      if (ended) next.destroyed += 1
    } while (!ended && !done(current) && attempts < MAX_RUN)
    setLevel(current)
    setDestroyed(ended)
    setTotals(next)
    return { outcome, attempts, current, ended }
  }

  const upgradeOnce = () => {
    const { outcome, current } = run(() => true)
    const texts = {
      success: `Success! The item is now +${current}.`,
      kept: `The upgrade failed but the item stayed at +${current}.`,
      downgraded: `The upgrade failed and the item dropped to +${current}.`,
      destroyed: 'The upgrade failed and the item was destroyed.',
    }
    setMessage(texts[outcome.outcome])
  }

  const upgradeToTarget = () => {
    const goal = getValues('target')
    const { attempts, current, ended } = run((value) => value >= goal)
    const after = `after ${attemptsText(attempts)}.`
    if (ended) setMessage(`Destroyed at +${current} ${after}`)
    else if (current >= goal) setMessage(`Reached +${current} ${after}`)
    else setMessage(`Stopped at +${current} ${after}`)
  }

  const atTop = level >= MAX_LEVEL

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-5 rounded-xs border border-line bg-surface p-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <Select label="Starting level" registration={register('start', { valueAsNumber: true, onChange: newItem })} options={[...START_OPTIONS]} />
          <Select label="Scroll" registration={register('scroll')} options={[...SCROLLS]} />
          <Select label="Serendipity" registration={register('potion', { valueAsNumber: true })} options={[...POTIONS]} />
          <Select label="Tincture" registration={register('tincture')} options={[...TINCTURES]} />
          <Select label="Upgrade to" registration={register('target', { valueAsNumber: true })} options={[...TARGET_OPTIONS]} />
        </div>

        <div className="flex flex-wrap items-center gap-6">
          <p className="text-xl font-bold">{destroyed ? 'Item destroyed' : `Current item: +${level}`}</p>
          {!destroyed && !atTop && (
            <div>
              <p className="text-xs font-bold tracking-wider text-muted uppercase">Chance</p>
              <p className="text-xl font-bold text-accent-text">{upgradeChance(level, potion ?? 0)}%</p>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-3">
          <Button onClick={upgradeOnce} disabled={destroyed || atTop}>
            Upgrade once
          </Button>
          <Button variant="secondary" onClick={upgradeToTarget} disabled={destroyed || atTop || level >= (target ?? MAX_LEVEL)}>
            Upgrade to target
          </Button>
          {destroyed && (
            <Button variant="secondary" onClick={newItem}>
              Start with a new item
            </Button>
          )}
        </div>

        <p role="status">{message}</p>
      </section>

      <section aria-label="Your totals" className="rounded-xs border border-line bg-surface p-5">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <Total name="Attempts" value={totals.attempts} />
          <Total name="Successes" value={totals.successes} />
          <Total name="Serendipity used" value={totals.potions} />
          <Total name="Tinctures used" value={totals.tinctures} />
          <Total name="Items destroyed" value={totals.destroyed} />
        </dl>
        {totals.attempts > 0 && (
          <Button variant="secondary" size="sm" onClick={() => setTotals(NO_TOTALS)} className="mt-4">
            Reset
          </Button>
        )}
      </section>
    </div>
  )
}
