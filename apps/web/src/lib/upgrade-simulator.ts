/**
 * The game's item upgrades, from the IK_UPGRADE and IK_GEM cases of OnCS_ITEMUPGRADE_REQ and from CalcProb in the map server.
 * Runs in the browser and changes nothing in the game.
 */

/** TITEMGRADECHART.bProb for +0 to +24, as of 9 November 2026. */
const UPGRADE_PERCENT = [100, 100, 100, 100, 100, 100, 100, 100, 91, 80, 45, 35, 15, 35, 9, 10, 6, 7, 3, 5, 1, 2, 1, 3, 0]
/** TGEMGRADECHART.bProb for 0 to 5 gems, as of 9 November 2026. */
const GEM_PERCENT = [33, 20, 14, 8, 4, 0]

export const MAX_LEVEL = UPGRADE_PERCENT.length - 1
export const MAX_GEMS = GEM_PERCENT.length - 1

export const SCROLLS = [
  { value: 'apprentice', label: "Apprentice's Formula" },
  { value: 'master', label: "Master's Formula" },
] as const
export const POTIONS = [
  { value: 0, label: 'None' },
  { value: 100, label: '100%' },
  { value: 150, label: '150%' },
  { value: 200, label: '200%' },
  { value: 300, label: '300%' },
] as const
export const TINCTURES = [
  { value: 'none', label: 'None' },
  { value: 'survival', label: 'Survival Tincture' },
  { value: 'medium', label: 'Medium Survival Tincture' },
  { value: 'greater', label: 'Greater Survival Tincture' },
] as const
export const STONES = [
  { value: 'plain', label: 'Gemstone' },
  { value: 'flawless', label: 'Flawless Gemstone' },
  { value: 'perfect', label: 'Perfect Gemstone' },
  { value: 'cash', label: 'Cash Gemstone' },
  { value: 'green', label: 'Green Gemstone' },
] as const

export type Scroll = (typeof SCROLLS)[number]['value']
export type Tincture = (typeof TINCTURES)[number]['value']
export type Stone = (typeof STONES)[number]['value']
export type UpgradeChoices = { scroll: Scroll; potion: number; tincture: Tincture }
export type UpgradeResult = { outcome: 'success' | 'kept' | 'downgraded' | 'destroyed'; level: number; tinctureUsed: boolean }
export type GemResult = { success: boolean; gem: number }

// TITEMCHART.wUseValue halves to the multiplier: 50 is x1, 100 is x2 and 200 is x4.
const STONE_MULTIPLIER: Record<Stone, number> = { plain: 1, flawless: 2, perfect: 2, cash: 4, green: 26 }
const TINCTURE_FLOOR: Record<Exclude<Tincture, 'none'>, number> = { survival: 11, medium: 15, greater: 19 }
const MASTER_MAX_STEP = 3
const GEMS_WITH_A_PLAIN_LIMIT = 2

/** The game's rand() range, so the spread of rolls matches. */
const gameRand = (random: () => number) => Math.floor(random() * 32768)

export function upgradeChance(level: number, potion: number): number {
  const base = UPGRADE_PERCENT[level]
  return Math.min(100, base + Math.floor((base * potion) / 100))
}

function downgrade(level: number, floor: number, random: () => number): UpgradeResult {
  const roll = level <= floor ? 0 : gameRand(random) % 100
  const loss = Math.min(roll < 20 ? 0 : roll < 55 ? 1 : 2, Math.max(level - floor, 0))
  return { outcome: loss > 0 ? 'downgraded' : 'kept', level: level - loss, tinctureUsed: true }
}

export function attemptUpgrade(level: number, choices: UpgradeChoices, random: () => number = Math.random): UpgradeResult {
  if (gameRand(random) % 100 < upgradeChance(level, choices.potion)) {
    const step = choices.scroll === 'master' ? (gameRand(random) % MASTER_MAX_STEP) + 1 : 1
    return { outcome: 'success', level: Math.min(level + step, MAX_LEVEL), tinctureUsed: false }
  }

  const { tincture } = choices
  if (tincture === 'none') return { outcome: 'destroyed', level, tinctureUsed: false }
  const floor = TINCTURE_FLOOR[tincture]
  // A Medium or Greater Tincture below its level saves the item and is not used up.
  if (tincture !== 'survival' && level < floor) return { outcome: 'kept', level, tinctureUsed: false }
  return downgrade(level, floor, random)
}

export function gemChance(gems: number, stone: Stone): number {
  if (gems >= MAX_GEMS) return 0
  if (stone === 'green') return 100
  if (stone === 'plain' && gems === GEMS_WITH_A_PLAIN_LIMIT) return 0
  return Math.min(100, GEM_PERCENT[gems] * STONE_MULTIPLIER[stone])
}

export function attemptGem(gems: number, stone: Stone, random: () => number = Math.random): GemResult {
  const roll = (gameRand(random) % 100) + 1
  if (roll <= gemChance(gems, stone)) return { success: true, gem: gems + 1 }
  if (stone !== 'perfect') return { success: false, gem: 0 }
  return { success: false, gem: gems >= 3 ? gems - 1 : gems }
}
