import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import {
  attemptUpgrade,
  canAttempt,
  MAX_LEVEL,
  POTIONS,
  SCROLLS,
  TINCTURES,
  upgradeChance,
  type UpgradeChoices,
} from '../../lib/upgrade-simulator'
import {
  cleanPrices,
  clearMyPrices,
  fromCoins,
  gamePricesQueryOptions,
  hasPrices,
  loadMyPrices,
  NO_PRICES,
  saveMyPrices,
  toCoins,
  withMine,
} from '../../lib/upgrade-prices'
import { RUNS, simulate, simulationText, type SimulationRun } from '../../lib/upgrade-runs'
import { fillStrategy, loadStrategy, saveStrategy } from '../../lib/upgrade-strategy'
import { Button } from '../Button'
import { Checkbox } from '../Checkbox'
import { Select } from '../Select'
import { SimulationResults } from './SimulationResults'
import { PriceFields } from './PriceFields'
import { StrategyTable, type UpgradeForm } from './StrategyTable'
import { Total } from './Total'

const NO_TOTALS = { attempts: 0, successes: 0, potions: 0, tinctures: 0, reflections: 0, destroyed: 0 }
const levels = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => ({ value: from + index, label: `+${from + index}` }))
const START_OPTIONS = levels(0, MAX_LEVEL - 1)
const TARGET_OPTIONS = levels(1, MAX_LEVEL)
const CHOICES: UpgradeChoices = { scroll: 'apprentice', potion: 0, tincture: 'none' }
const START = 10

/** The saved setup per level if there is one, or every level on the default choices. The game's prices come in later. */
const firstValues = (): UpgradeForm => ({
  start: START,
  target: MAX_LEVEL,
  ...CHOICES,
  ...(loadStrategy() ?? { perLevel: false, rows: fillStrategy(CHOICES) }),
  prices: toCoins(withMine(NO_PRICES, loadMyPrices())),
})

/** The choices an attempt at this level uses: its own row, or the one setup for every level. */
const choicesFrom =
  (values: UpgradeForm) =>
  (at: number): UpgradeChoices =>
    values.perLevel ? values.rows[at] : values

export function UpgradePanel() {
  const [defaultValues] = useState(firstValues)
  const { register, control, getValues, setValue } = useForm({ defaultValues })
  const [scroll, potion, tincture, target, perLevel, rows] = useWatch({
    control,
    name: ['scroll', 'potion', 'tincture', 'target', 'perLevel', 'rows'],
  })
  const [level, setLevel] = useState(START)
  const [destroyed, setDestroyed] = useState(false)
  const [message, setMessage] = useState('Choose your items and press a button.')
  const [totals, setTotals] = useState(NO_TOTALS)
  const [simulation, setSimulation] = useState<SimulationRun>()
  const gameQuery = useQuery(gamePricesQueryOptions)
  const game = gameQuery.data && cleanPrices(gameQuery.data)

  // The game's prices arrive after the first render, and again when a GM changes one: they go under whatever the user changed.
  useEffect(() => {
    if (gameQuery.data) setValue('prices', toCoins(withMine(cleanPrices(gameQuery.data), loadMyPrices())))
  }, [gameQuery.data, setValue])

  const newItem = () => {
    setLevel(getValues('start'))
    setDestroyed(false)
    setMessage('Choose your items and press a button.')
  }

  const remember = () => saveStrategy({ perLevel: getValues('perLevel'), rows: getValues('rows') })

  const rememberPrices = () => saveMyPrices(fromCoins(getValues('prices')), game ?? NO_PRICES)

  const backToGamePrices = () => {
    clearMyPrices()
    setValue('prices', toCoins(game ?? NO_PRICES))
  }

  const applyToAll = () => {
    const [scroll, potion, tincture] = getValues(['scroll', 'potion', 'tincture'])
    setValue('rows', fillStrategy({ scroll, potion, tincture }))
    remember()
  }

  // The first time it is turned on, every level starts with the setup already chosen. After that the rows are the user's.
  const togglePerLevel = () => {
    if (getValues('perLevel') && !loadStrategy()) applyToAll()
    else remember()
  }

  const upgradeOnce = () => {
    const choices = choicesFrom(getValues())(level)
    const { outcome, level: current, tinctureUsed } = attemptUpgrade(level, choices)
    // A Scroll of Reflection never touches the Serendipity or the Tincture.
    const reflected = choices.scroll === 'reflection'
    setLevel(current)
    setDestroyed(outcome === 'destroyed')
    setTotals({
      attempts: totals.attempts + 1,
      successes: totals.successes + Number(outcome === 'success'),
      potions: totals.potions + Number(!reflected && choices.potion > 0),
      tinctures: totals.tinctures + Number(tinctureUsed),
      reflections: totals.reflections + Number(reflected),
      destroyed: totals.destroyed + Number(outcome === 'destroyed'),
    })
    const texts = {
      success: `Success! The item is now +${current}.`,
      kept: `The upgrade failed but the item stayed at +${current}.`,
      downgraded: `The upgrade failed and the item dropped to +${current}.`,
      destroyed: 'The upgrade failed and the item was destroyed.',
      reflected: `The Scroll of Reflection lowered the item to +${current}.`,
    }
    setMessage(texts[outcome])
  }

  /** Tries it on many copies of the item. The item itself and the totals stay as they are. */
  const upgradeToTarget = () => {
    const values = getValues()
    const prices = fromCoins(values.prices)
    const result = { ...simulate(level, values.target, choicesFrom(values), { prices }), from: level, target: values.target, priced: hasPrices(prices) }
    setSimulation(result)
    setMessage(simulationText(result))
  }

  const atTop = level >= MAX_LEVEL
  const active: UpgradeChoices = perLevel && !atTop ? rows[level] : { scroll, potion, tincture }
  const reflecting = active.scroll === 'reflection'
  const blocked = destroyed || atTop || !canAttempt(level, active.scroll)

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-5 rounded-xs border border-line bg-surface p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <Select label="Starting level" registration={register('start', { valueAsNumber: true, onChange: newItem })} options={[...START_OPTIONS]} />
          <Select label="Scroll" registration={register('scroll')} options={[...SCROLLS]} />
          {/* A Scroll of Reflection never touches the Serendipity or the Tincture. */}
          <Select
            label="Serendipity"
            registration={register('potion', { valueAsNumber: true })}
            options={[...POTIONS]}
            disabled={scroll === 'reflection'}
          />
          <Select label="Tincture" registration={register('tincture')} options={[...TINCTURES]} disabled={scroll === 'reflection'} />
          <Select label="Upgrade to" registration={register('target', { valueAsNumber: true })} options={[...TARGET_OPTIONS]} />
        </div>

        <Checkbox label="Use a different setup per level" {...register('perLevel', { onChange: togglePerLevel })} />
        {perLevel && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary" size="sm" onClick={applyToAll}>
                Apply to all levels
              </Button>
              <p className="text-sm text-muted">
                Each attempt uses the row for the level the item is at. The Scroll, Serendipity and Tincture above only fill the rows. Saved
                in this browser.
              </p>
            </div>
            <StrategyTable register={register} rows={rows} current={destroyed ? undefined : level} onChange={remember} />
          </div>
        )}

        <fieldset className="flex flex-col gap-3">
          <legend className="font-bold">Prices</legend>
          <p className="text-sm text-muted">
            {gameQuery.isError
              ? "Could not load the game's prices, so fill in what each item costs you."
              : 'These start as what Tranus charges in the game. Change any of them to what the item costs you.'}{' '}
            Upgrade to target shows what a run costs. Your changes are saved in this browser.
          </p>
          <PriceFields register={register} onChange={rememberPrices} />
          {game && (
            <div>
              <Button variant="secondary" size="sm" onClick={backToGamePrices}>
                Use the game's prices
              </Button>
            </div>
          )}
        </fieldset>

        <div className="flex flex-wrap items-center gap-6">
          <p className="text-xl font-bold">{destroyed ? 'Item destroyed' : `Current item: +${level}`}</p>
          {!destroyed && !atTop && (
            <div>
              <p className="text-xs font-bold tracking-wider text-muted uppercase">{reflecting ? 'Scroll of Reflection' : 'Chance'}</p>
              <p className="text-xl font-bold text-accent-text">
                {!reflecting ? `${upgradeChance(level, active.potion)}%` : level > 0 ? `Drops to +${level - 1}` : 'Cannot be used at +0'}
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-3">
          <Button onClick={upgradeOnce} disabled={blocked}>
            Upgrade once
          </Button>
          {/* With one setup for every level, a Scroll of Reflection can only ever go down. */}
          <Button variant="secondary" onClick={upgradeToTarget} disabled={blocked || level >= target || (!perLevel && reflecting)}>
            Upgrade to target
          </Button>
          {destroyed && (
            <Button variant="secondary" onClick={newItem}>
              Start with a new item
            </Button>
          )}
        </div>

        <p className="text-sm text-muted">
          Upgrade to target tries it on {RUNS.toLocaleString('en-US')} copies of this item and shows how the luck spreads. Your item and totals
          stay as they are.
        </p>
        <p role="status">{message}</p>
      </section>

      {simulation && <SimulationResults result={simulation} />}

      <section aria-label="Your totals" className="rounded-xs border border-line bg-surface p-4 sm:p-5">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Total name="Attempts" value={totals.attempts} />
          <Total name="Successes" value={totals.successes} />
          <Total name="Serendipity used" value={totals.potions} />
          <Total name="Tinctures used" value={totals.tinctures} />
          <Total name="Reflections used" value={totals.reflections} />
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
