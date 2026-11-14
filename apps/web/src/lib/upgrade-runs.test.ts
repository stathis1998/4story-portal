import { describe, expect, it } from 'vitest'
import { MAX_RUN, percentile, runToTarget, simulate } from './upgrade-runs'
import { cleanPrices } from './upgrade-prices'
import type { UpgradeChoices } from './upgrade-simulator'

/** Hands out these game rand() values over and over. */
const rolls = (...values: number[]) => {
  let next = 0
  return () => (values[next++ % values.length] + 0.5) / 32768
}

const choices = (over: Partial<UpgradeChoices> = {}): UpgradeChoices => ({ scroll: 'apprentice', potion: 0, tincture: 'none', ...over })
const always = (over: Partial<UpgradeChoices> = {}) => () => choices(over)
const FAIL = 99

describe('runToTarget', () => {
  it('counts the attempts and Serendipity it took to reach the target', () => {
    expect(runToTarget(10, 13, always({ potion: 100 }), rolls(0))).toEqual({ attempts: 3, potions: 3, tinctures: 0, reflections: 0, cost: 0, end: 'reached' })
  })

  it('ends when the item is destroyed', () => {
    expect(runToTarget(10, 13, always(), rolls(0, FAIL))).toMatchObject({ attempts: 2, end: 'destroyed' })
  })

  it('counts the Tinctures that were used up', () => {
    // Fails at +12 and keeps the level, then succeeds.
    expect(runToTarget(12, 13, always({ tincture: 'survival' }), rolls(FAIL, 0, 0))).toMatchObject({ attempts: 2, tinctures: 1, end: 'reached' })
  })

  it('follows the choices for each level, with no Serendipity for a Scroll of Reflection', () => {
    const perLevel = (level: number) => choices({ potion: 100, scroll: level === 20 ? 'reflection' : 'master' })

    // No roll at +20, then a success at +19 and a Master's Formula step of 3.
    expect(runToTarget(20, 21, perLevel, rolls(0, 2))).toEqual({ attempts: 2, potions: 1, tinctures: 0, reflections: 1, cost: 0, end: 'reached' })
  })

  it('adds up what every attempt cost at the prices given', () => {
    const prices = cleanPrices({ apprentice: 10, potion100: 5, survival: 1000 })

    // A failure at +12 that uses up the Tincture, then a success: two scrolls, two Serendipity and one Tincture.
    const run = runToTarget(12, 13, always({ potion: 100, tincture: 'survival' }), rolls(FAIL, 0, 0), prices)

    expect(run).toMatchObject({ attempts: 2, cost: 1030 })
  })

  it('is stuck after 100,000 attempts', () => {
    expect(runToTarget(18, 19, always({ tincture: 'greater' }), rolls(FAIL))).toMatchObject({ attempts: MAX_RUN, end: 'stuck' })
  })

  it('is stuck on a Scroll of Reflection at +0', () => {
    expect(runToTarget(1, 2, always({ scroll: 'reflection' }), rolls(0))).toMatchObject({ attempts: 1, reflections: 1, end: 'stuck' })
  })

  it('has nothing to do at the target', () => {
    expect(runToTarget(13, 13, always(), rolls(0))).toMatchObject({ attempts: 0, end: 'reached' })
  })
})

describe('percentile', () => {
  const oneToHundred = Array.from({ length: 100 }, (_, index) => index + 1)

  it.each([
    [50, 50],
    [90, 90],
    [95, 95],
    [99, 99],
  ])('finds the %ith percentile of 1 to 100', (percent, value) => {
    expect(percentile(oneToHundred, percent)).toBe(value)
  })

  it('rounds up to a value that really happened', () => {
    expect(percentile([1, 2, 3], 50)).toBe(2)
    expect(percentile([1, 2, 3], 90)).toBe(3)
    expect(percentile([7], 99)).toBe(7)
  })
})

describe('simulate', () => {
  it('counts how many runs reached the target and how many destroyed the item', () => {
    // Runs take turns: one success, then one failure with no Tincture.
    const result = simulate(10, 11, always(), { runs: 10, random: rolls(0, FAIL) })

    expect(result).toMatchObject({ runs: 10, reached: 5, destroyed: 5, stuck: false })
  })

  it('spreads what the runs that reached the target used', () => {
    // Three kinds of run in turn: 1, 2 and 3 attempts, with a Survival Tincture keeping +10 on each failure.
    const random = rolls(0, FAIL, 0, FAIL, FAIL, 0)
    const { spread } = simulate(10, 11, always({ tincture: 'survival', potion: 100 }), { runs: 300, random })

    expect(spread?.attempts).toEqual({ mean: 2, percentiles: [2, 3, 3, 3] })
    expect(spread?.potions).toEqual({ mean: 2, percentiles: [2, 3, 3, 3] })
    expect(spread?.tinctures).toEqual({ mean: 1, percentiles: [1, 2, 2, 2] })
    expect(spread?.reflections).toEqual({ mean: 0, percentiles: [0, 0, 0, 0] })
  })

  it('spreads the cost of the runs at the prices given', () => {
    // Runs of 1, 2 and 3 attempts in turn, at 3 Bronze a scroll.
    const random = rolls(0, FAIL, 0, FAIL, FAIL, 0)
    const { spread } = simulate(10, 11, always({ tincture: 'survival' }), { runs: 300, random, prices: cleanPrices({ apprentice: 3 }) })

    expect(spread?.cost).toEqual({ mean: 6, percentiles: [6, 9, 9, 9] })
  })

  it('costs nothing with no prices', () => {
    expect(simulate(10, 11, always(), { runs: 3, random: rolls(0) }).spread?.cost).toEqual({ mean: 0, percentiles: [0, 0, 0, 0] })
  })

  it('sorts by number, so 10 attempts come after 9', () => {
    // Runs take turns: 9 attempts, then 10.
    const fails = (count: number) => Array.from({ length: count }, () => FAIL)
    const { spread } = simulate(10, 11, always({ tincture: 'survival' }), { runs: 100, random: rolls(...fails(8), 0, ...fails(9), 0) })

    expect(spread?.attempts.percentiles).toEqual([9, 10, 10, 10])
  })

  it('has no spread when no run reached the target', () => {
    expect(simulate(10, 11, always(), { runs: 5, random: rolls(FAIL) })).toMatchObject({ reached: 0, destroyed: 5, spread: null })
  })

  it('stops at the first run that is stuck', () => {
    const result = simulate(18, 19, always({ tincture: 'greater' }), { runs: 5, random: rolls(FAIL) })

    expect(result).toMatchObject({ runs: 0, stuck: true, spread: null })
  })

  it('ends early once it has taken too long', () => {
    const result = simulate(10, 13, always(), { runs: 100, maxMs: 0, random: rolls(0) })

    expect(result).toMatchObject({ runs: 1, reached: 1, stuck: false })
  })
})
