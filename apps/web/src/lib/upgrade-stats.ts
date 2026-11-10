import type { UpgradeLevelStats, UpgradeOutcomes, UpgradeStats } from '@4story-portal/shared'
import { queryOptions } from '@tanstack/react-query'
import { apiFetch } from './api'

/** The whole server, or one character's alone. */
export const upgradeStatsQueryOptions = (character?: number) =>
  queryOptions({
    queryKey: ['upgrade-stats', character ?? 'everyone'],
    queryFn: () => apiFetch<UpgradeStats>(character === undefined ? '/upgrade-stats' : `/upgrade-stats?character=${character}`),
  })

export const failuresOf = ({ saved, lostLevels, destroyed }: UpgradeOutcomes) => saved + lostLevels + destroyed
export const attemptsOf = (outcomes: UpgradeOutcomes) => outcomes.success + failuresOf(outcomes)

/** Failures in the order they stack away from the baseline: the worst one closest to it. */
export const FAILURE_PARTS = ['destroyed', 'lostLevels', 'saved'] as const

export const OUTCOME_LABELS: Record<keyof UpgradeOutcomes, string> = {
  success: 'Success',
  saved: 'Saved, nothing lost',
  lostLevels: 'Lost levels',
  destroyed: 'Destroyed',
}

/** Chart colours, validated as a diverging set on the page surface: success, the neutral middle, then the warm arm. */
export const OUTCOME_COLORS: Record<keyof UpgradeOutcomes, string> = {
  success: 'var(--viz-success)',
  saved: 'var(--viz-saved)',
  lostLevels: 'var(--viz-lost)',
  destroyed: 'var(--viz-destroyed)',
}

/** Round tick values from 0 to at least `max`, at most five of them. */
export function niceTicks(max: number): number[] {
  if (max <= 0) return [0, 1]
  const rough = max / 4
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? 10 * magnitude
  const wholeStep = Math.max(1, step)
  const ticks = [0]
  while (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + wholeStep)
  return ticks
}

const EMPTY_LEVEL = { success: 0, saved: 0, lostLevels: 0, destroyed: 0, expectedRate: 0 }

/** Every level from the lowest to the highest tried, so a gap shows as an empty column. */
export function fillLevels(levels: UpgradeLevelStats[]): UpgradeLevelStats[] {
  if (levels.length === 0) return []
  const byLevel = new Map(levels.map((level) => [level.level, level]))
  const first = levels[0].level
  const last = levels[levels.length - 1].level
  return Array.from({ length: last - first + 1 }, (_, i) => byLevel.get(first + i) ?? { ...EMPTY_LEVEL, level: first + i })
}

export const percent = (part: number, whole: number) => (whole === 0 ? '0%' : `${Math.round((part / whole) * 100)}%`)

export const count = (value: number) => value.toLocaleString('en-US')

const oneDecimal = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 1 })

/** How the real successes compare with what the odds predicted. */
export function luckText(successes: number, expected: number): string {
  const difference = successes - expected
  if (Math.abs(difference) < 0.05) return 'exactly what the odds predicted'
  return difference > 0
    ? `${oneDecimal(difference)} more than the odds predicted`
    : `${oneDecimal(-difference)} fewer than the odds predicted`
}

/** "an upgrade", "a gemstone". */
export const withArticle = (noun: string) => `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`

export const levelLabel =(kind: 'scroll' | 'gem', level: number) => (kind === 'scroll' ? `+${level}` : `Gem ${level}`)
