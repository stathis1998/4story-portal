/**
 * What each upgrade item costs, as game money counted in Cron. The prices start as what the game's vendors charge,
 * and the ones the user changed are kept in this browser.
 */
import { joinMoney, splitMoney, type UpgradePriceKey, type UpgradePrices } from '@4story-portal/shared'
import { queryOptions } from '@tanstack/react-query'
import { apiFetch } from './api'
import type { UpgradeChoices } from './upgrade-simulator'

/** What the game's vendors charge now. A GM can change these, so they are read from the game each visit. */
export const gamePricesQueryOptions = queryOptions({
  queryKey: ['upgrade-prices'],
  queryFn: () => apiFetch<UpgradePrices>('/upgrade-prices'),
})

export const PRICE_FIELDS = [
  { key: 'apprentice', label: "Apprentice's Formula" },
  { key: 'master', label: "Master's Formula" },
  { key: 'reflection', label: 'Scroll of Reflection' },
  { key: 'potion100', label: 'Serendipity 100%' },
  { key: 'potion150', label: 'Serendipity 150%' },
  { key: 'potion200', label: 'Serendipity 200%' },
  { key: 'potion300', label: 'Serendipity 300%' },
  { key: 'survival', label: 'Survival Tincture' },
  { key: 'medium', label: 'Medium Survival Tincture' },
  { key: 'greater', label: 'Greater Survival Tincture' },
] as const satisfies readonly { key: UpgradePriceKey; label: string }[]

export type PriceKey = UpgradePriceKey
export type Prices = UpgradePrices
export type Coins = { rune: number; luna: number; cron: number }
/** The prices as the form holds them: three coin fields an item. */
export type PriceCoins = Record<PriceKey, Coins>

const KEY = 'upgrade-simulator.my-prices'

/** Anything that is not a number of 0 or more counts as 0, such as an emptied field. Money has no fractions. */
const whole = (amount: unknown) => (typeof amount === 'number' && Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : 0)

/** A price in Cron for every item. */
export function cleanPrices(prices: Partial<Record<PriceKey, unknown>> = {}): Prices {
  const clean = {} as Prices
  for (const { key } of PRICE_FIELDS) {
    clean[key] = whole(prices[key])
  }
  return clean
}

export const NO_PRICES = cleanPrices()

export function toCoins(prices: Prices): PriceCoins {
  const coins = {} as PriceCoins
  for (const { key } of PRICE_FIELDS) coins[key] = splitMoney(prices[key])
  return coins
}

/** Joins the coin fields, carrying 1,000 Cron into a Luna and 1,000 Luna into a Rune. */
export function fromCoins(coins: PriceCoins): Prices {
  const prices = {} as Prices
  for (const { key } of PRICE_FIELDS) {
    const { rune, luna, cron } = coins[key]
    prices[key] = joinMoney({ rune: whole(rune), luna: whole(luna), cron: whole(cron) })
  }
  return prices
}

export const hasPrices = (prices: Prices) => PRICE_FIELDS.some(({ key }) => prices[key] > 0)

/** What one attempt used up: always the scroll, the Serendipity unless it was a Scroll of Reflection, and the Tincture if it went. */
export function attemptCost(choices: UpgradeChoices, tinctureUsed: boolean, prices: Prices): number {
  const { scroll, potion, tincture } = choices
  const potionCost = scroll !== 'reflection' && potion > 0 ? prices[`potion${potion}` as PriceKey] : 0
  const tinctureCost = tinctureUsed && tincture !== 'none' ? prices[tincture] : 0
  return prices[scroll] + potionCost + tinctureCost
}

/** The game's prices with the user's own on top. */
export const withMine = (game: Prices, mine: Partial<Prices>): Prices => ({ ...game, ...mine })

/** The prices the user changed, and only those. Empty when nothing usable is saved or the browser blocks storage. */
export function loadMyPrices(): Partial<Prices> {
  const mine: Partial<Prices> = {}
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (typeof saved !== 'object' || saved === null) return mine
    for (const { key } of PRICE_FIELDS) {
      const price = (saved as Record<string, unknown>)[key]
      // 0 is a price too: an item the user gets for free.
      if (typeof price === 'number' && Number.isFinite(price) && price >= 0) mine[key] = Math.floor(price)
    }
  } catch {
    // Not JSON, or storage is blocked: the game's prices are used.
  }
  return mine
}

/** Keeps the prices that differ from the game's, so the rest go on following the game when a GM changes them. */
export function saveMyPrices(prices: Prices, game: Prices): void {
  const mine: Partial<Prices> = {}
  for (const { key } of PRICE_FIELDS) if (prices[key] !== game[key]) mine[key] = prices[key]
  try {
    localStorage.setItem(KEY, JSON.stringify(mine))
  } catch {
    // Storage is blocked or full: the prices still work for this visit.
  }
}

export function clearMyPrices(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Storage is blocked: there was nothing saved to clear.
  }
}
