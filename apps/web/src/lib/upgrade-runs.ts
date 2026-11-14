/** Many upgrade runs from one level to a target, to show how the luck spreads. Runs in the browser. */
import { attemptCost, NO_PRICES, type Prices } from './upgrade-prices'
import { attemptUpgrade, canAttempt, type UpgradeChoices } from './upgrade-simulator'

/**
 * With 10,000 runs a share such as "reached in 62%" is within 1 point of the truth 19 times in 20, and the 99th
 * percentile still has 100 runs beyond it. The error shrinks with the square root of the runs, so 10 times closer
 * would take 100 times longer.
 */
export const RUNS = 10_000
/** A run this long is treated as a setup that will not reach the target. */
export const MAX_RUN = 100_000
/** The page is frozen while it runs, so a slow setup ends with fewer runs. */
const MAX_MS = 2000

const COUNTS = ['attempts', 'potions', 'tinctures', 'reflections', 'cost'] as const
export const PERCENTILES = [50, 90, 95, 99] as const

export type Count = (typeof COUNTS)[number]
export type RunCounts = Record<Count, number>
export type Run = RunCounts & { end: 'reached' | 'destroyed' | 'stuck' }
export type Spread = { mean: number; percentiles: number[] }
export type Simulation = {
  /** Runs that ended, by reaching the target or by destroying the item. */
  runs: number
  reached: number
  destroyed: number
  /** A run hit MAX_RUN or a level it cannot leave, and the simulation stopped there. */
  stuck: boolean
  /** What the runs that reached the target used. Null when none did. */
  spread: Record<Count, Spread> | null
}
/** A simulation, the levels it ran between and whether any price was filled in for it. */
export type SimulationRun = Simulation & { from: number; target: number; priced: boolean }
type ChoicesAt = (level: number) => UpgradeChoices
type Options = { runs?: number; maxMs?: number; random?: () => number; prices?: Prices }

const whole = (value: number) => value.toLocaleString('en-US')

export const stuckText = (target: number) =>
  `Stopped: a run was still going after ${whole(MAX_RUN)} attempts, so this setup is very unlikely to ever reach +${target}.`

/** One line that sums a simulation up. */
export function simulationText({ runs, reached, stuck, from, target }: SimulationRun): string {
  if (stuck) return stuckText(target)
  const share = ((reached / runs) * 100).toLocaleString('en-US', { maximumFractionDigits: 1 })
  return `Ran ${whole(runs)} items from +${from} to +${target}: ${share}% reached it.`
}

/** One item from `start` until it reaches `target`, is destroyed or cannot go on. */
export function runToTarget(
  start: number,
  target: number,
  choicesAt: ChoicesAt,
  random: () => number = Math.random,
  prices: Prices = NO_PRICES,
): Run {
  const run: Run = { attempts: 0, potions: 0, tinctures: 0, reflections: 0, cost: 0, end: 'reached' }
  let level = start
  while (level < target) {
    const choices = choicesAt(level)
    if (run.attempts >= MAX_RUN || !canAttempt(level, choices.scroll)) return { ...run, end: 'stuck' }
    const result = attemptUpgrade(level, choices, random)
    run.attempts += 1
    // A Scroll of Reflection never touches the Serendipity or the Tincture.
    if (choices.scroll === 'reflection') run.reflections += 1
    else if (choices.potion > 0) run.potions += 1
    if (result.tinctureUsed) run.tinctures += 1
    run.cost += attemptCost(choices, result.tinctureUsed, prices)
    if (result.outcome === 'destroyed') return { ...run, end: 'destroyed' }
    level = result.level
  }
  return run
}

/** The smallest value that at least `percent` of the sorted values do not exceed. */
export function percentile(sorted: ArrayLike<number>, percent: number): number {
  return sorted[Math.max(Math.ceil((percent / 100) * sorted.length), 1) - 1]
}

function spreadOf(values: Float64Array): Spread {
  const sorted = values.slice().sort()
  return { mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length, percentiles: PERCENTILES.map((percent) => percentile(sorted, percent)) }
}

export function simulate(start: number, target: number, choicesAt: ChoicesAt, options: Options = {}): Simulation {
  const { runs = RUNS, maxMs = MAX_MS, random = Math.random, prices = NO_PRICES } = options
  const deadline = performance.now() + maxMs
  // Float64, because a cost in Cron can pass what 32 bits hold.
  const used = Object.fromEntries(COUNTS.map((count) => [count, new Float64Array(runs)])) as Record<Count, Float64Array>
  let reached = 0
  let destroyed = 0
  let stuck = false

  do {
    const run = runToTarget(start, target, choicesAt, random, prices)
    if (run.end === 'stuck') {
      stuck = true
      break
    }
    if (run.end === 'destroyed') destroyed += 1
    else {
      for (const count of COUNTS) used[count][reached] = run[count]
      reached += 1
    }
  } while (reached + destroyed < runs && performance.now() < deadline)

  const spread = reached
    ? (Object.fromEntries(COUNTS.map((count) => [count, spreadOf(used[count].subarray(0, reached))])) as Record<Count, Spread>)
    : null
  return { runs: reached + destroyed, reached, destroyed, stuck, spread }
}
