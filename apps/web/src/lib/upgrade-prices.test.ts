import { describe, expect, it } from 'vitest'
import {
  attemptCost,
  cleanPrices,
  clearMyPrices,
  fromCoins,
  hasPrices,
  loadMyPrices,
  NO_PRICES,
  saveMyPrices,
  toCoins,
  withMine,
} from './upgrade-prices'
import type { UpgradeChoices } from './upgrade-simulator'

const prices = cleanPrices({ apprentice: 1, master: 20, reflection: 5, potion100: 100, potion300: 300, survival: 1000, greater: 3000 })
const choices = (over: Partial<UpgradeChoices> = {}): UpgradeChoices => ({ scroll: 'apprentice', potion: 0, tincture: 'none', ...over })

describe('cleanPrices', () => {
  it('has a price of 0 for everything left out', () => {
    expect(cleanPrices({ master: 20 })).toMatchObject({ apprentice: 0, master: 20, potion150: 0, medium: 0 })
  })

  it.each([Number.NaN, -5, Infinity, '12', null])('counts %s as 0', (price) => {
    expect(cleanPrices({ master: price }).master).toBe(0)
  })

  it('drops a fraction, as money has none', () => {
    expect(cleanPrices({ master: 2.5 }).master).toBe(2)
  })
})

describe('coins', () => {
  it('splits every price into Rune, Luna and Cron', () => {
    const coins = toCoins(cleanPrices({ greater: 3_250_075 }))

    expect(coins.greater).toEqual({ rune: 3, luna: 250, cron: 75 })
    expect(coins.master).toEqual({ rune: 0, luna: 0, cron: 0 })
  })

  it('joins them back into Cron', () => {
    expect(fromCoins(toCoins(prices))).toEqual(prices)
  })

  it('carries 1,000 of a coin into the next one', () => {
    const coins = { ...toCoins(NO_PRICES), master: { rune: 1, luna: 1500, cron: 2 } }

    expect(fromCoins(coins).master).toBe(2_500_002)
  })

  it('counts an emptied or negative field as 0', () => {
    const coins = { ...toCoins(NO_PRICES), master: { rune: Number.NaN, luna: -4, cron: 7 } }

    expect(fromCoins(coins).master).toBe(7)
  })
})

describe('hasPrices', () => {
  it('is false until some price is above 0', () => {
    expect(hasPrices(NO_PRICES)).toBe(false)
    expect(hasPrices(cleanPrices({ greater: 1 }))).toBe(true)
  })
})

describe('attemptCost', () => {
  it('is the scroll alone with nothing else', () => {
    expect(attemptCost(choices({ scroll: 'master' }), false, prices)).toBe(20)
  })

  it('adds the Serendipity of the strength used', () => {
    expect(attemptCost(choices({ potion: 300 }), false, prices)).toBe(301)
    expect(attemptCost(choices({ potion: 100 }), false, prices)).toBe(101)
  })

  it('adds the Tincture only when it was used up', () => {
    expect(attemptCost(choices({ tincture: 'greater' }), false, prices)).toBe(1)
    expect(attemptCost(choices({ tincture: 'greater' }), true, prices)).toBe(3001)
  })

  it('is the Scroll of Reflection alone, whatever else is chosen', () => {
    expect(attemptCost(choices({ scroll: 'reflection', potion: 300, tincture: 'survival' }), false, prices)).toBe(5)
  })
})

describe('my prices', () => {
  const game = cleanPrices({ apprentice: 10_000, master: 100_000, greater: 40_000_000 })

  it('are none until some are saved', () => {
    expect(loadMyPrices()).toEqual({})
  })

  it('are only the ones that differ from the game', () => {
    saveMyPrices({ ...game, master: 90_000 }, game)

    expect(loadMyPrices()).toEqual({ master: 90_000 })
  })

  it('include an item made free', () => {
    saveMyPrices({ ...game, greater: 0 }, game)

    expect(loadMyPrices()).toEqual({ greater: 0 })
  })

  it('go on top of the game prices, which the rest keep following', () => {
    saveMyPrices({ ...game, master: 90_000 }, game)
    const dearer = { ...game, apprentice: 20_000, master: 200_000 }

    expect(withMine(dearer, loadMyPrices())).toEqual({ ...dearer, master: 90_000 })
  })

  it('are none again once cleared', () => {
    saveMyPrices({ ...game, master: 90_000 }, game)

    clearMyPrices()

    expect(loadMyPrices()).toEqual({})
  })

  it.each([
    ['text that is not JSON', 'nope'],
    ['a list', '[1, 2]'],
    ['a negative price', JSON.stringify({ master: -1 })],
    ['a price that is not a number', JSON.stringify({ master: '12' })],
    ['an item that does not exist', JSON.stringify({ legendary: 5 })],
  ])('ignore %s', (_, stored) => {
    localStorage.setItem('upgrade-simulator.my-prices', stored)

    expect(loadMyPrices()).toEqual({})
  })
})
