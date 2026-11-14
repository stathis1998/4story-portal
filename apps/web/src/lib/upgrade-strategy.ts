/** The upgrade simulator's setup per level, kept in this browser only. */
import { canAttempt, MAX_LEVEL, POTIONS, SCROLLS, TINCTURES, type UpgradeChoices } from './upgrade-simulator'

/** One row per level an item can be upgraded from: index 0 is +0, the last is +23. */
export type Strategy = { perLevel: boolean; rows: UpgradeChoices[] }

const KEY = 'upgrade-simulator.strategy'

const isOneOf = (options: readonly { value: unknown }[], value: unknown) => options.some((option) => option.value === value)

function isRow(row: unknown, level: number): row is UpgradeChoices {
  if (typeof row !== 'object' || row === null) return false
  const { scroll, potion, tincture } = row as Record<string, unknown>
  return isOneOf(SCROLLS, scroll) && isOneOf(POTIONS, potion) && isOneOf(TINCTURES, tincture) && canAttempt(level, scroll as UpgradeChoices['scroll'])
}

/** The same choices at every level, except that +0 cannot take a Scroll of Reflection. */
export function fillStrategy({ scroll, potion, tincture }: UpgradeChoices): UpgradeChoices[] {
  return Array.from({ length: MAX_LEVEL }, (_, level) => ({ scroll: canAttempt(level, scroll) ? scroll : 'apprentice', potion, tincture }))
}

/** Null when nothing usable is saved, including when the browser blocks storage. */
export function loadStrategy(): Strategy | null {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (typeof saved !== 'object' || saved === null) return null
    const { perLevel, rows } = saved as Record<string, unknown>
    if (typeof perLevel !== 'boolean' || !Array.isArray(rows) || rows.length !== MAX_LEVEL || !rows.every(isRow)) return null
    return { perLevel, rows: rows.map(({ scroll, potion, tincture }) => ({ scroll, potion, tincture })) }
  } catch {
    return null
  }
}

export function saveStrategy({ perLevel, rows }: Strategy): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ perLevel, rows }))
  } catch {
    // Storage is blocked or full: the strategy still works for this visit.
  }
}
