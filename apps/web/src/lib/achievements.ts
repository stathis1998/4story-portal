import type {
  Achievement,
  AchievementLevel,
  AchievementReward,
  AchievementRewardRequest,
  AchievementsOverview,
  GmAchievements,
  News,
} from '@4story-portal/shared'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError, apiFetch } from './api'
import { formatDay } from './stats'

export const achievementsQueryOptions = queryOptions({
  // Not under 'me': the query client treats that key as the login check and ignores its 401s.
  queryKey: ['achievements'],
  queryFn: () => apiFetch<AchievementsOverview>('/me/achievements'),
  refetchInterval: 60_000,
})

export const newsQueryOptions = queryOptions({
  queryKey: ['news'],
  queryFn: () => apiFetch<News>('/news'),
  refetchInterval: 60_000,
})

export const gmAchievementsQueryOptions = queryOptions({
  queryKey: ['gm', 'achievements'],
  queryFn: () => apiFetch<GmAchievements>('/gm/achievements'),
  refetchInterval: 10_000,
})

/** Both answer with the whole GM state, so it replaces what the page shows without a refetch. */
function useGmAchievementsMutation<Input>(key: string, path: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['gm', 'achievements', key],
    mutationFn: (input: Input) => apiFetch<GmAchievements>(path, { method: 'PUT', body: JSON.stringify(input) }),
    onSuccess: (state) => {
      queryClient.setQueryData(gmAchievementsQueryOptions.queryKey, state)
      // Players see the rewards and the live note too.
      void queryClient.invalidateQueries({ queryKey: achievementsQueryOptions.queryKey })
    },
  })
}

export const useSaveAchievementReward = () =>
  useGmAchievementsMutation<AchievementRewardRequest>('rewards', '/gm/achievements/rewards')

export const useSetAchievementsLive = () => useGmAchievementsMutation<{ live: boolean }>('live', '/gm/achievements/live')

export function useSendTestAnnouncement() {
  return useMutation({
    mutationKey: ['gm', 'achievements', 'test-announcement'],
    mutationFn: () => apiFetch<void>('/gm/achievements/test-announcement', { method: 'POST' }),
  })
}

/** The API writes its 422s for the GM, and the 503 when the control server isn't connected. */
export const achievementErrorMessage = (err: unknown) =>
  err instanceof ApiError && (err.status < 500 || err.status === 503)
    ? err.message
    : 'Something went wrong. Please try again.'

/** The first level still to do, or undefined when every level is done. */
export const nextLevel = (achievement: Pick<Achievement, 'levels'>): AchievementLevel | undefined =>
  achievement.levels.find((level) => !level.done)

/** How far along the next level is, 0 to 1. A finished achievement is 1. */
export function progressRatio(achievement: Achievement) {
  const next = nextLevel(achievement)
  if (!next) return 1
  if (next.threshold <= 0) return 0
  return Math.min(Math.max(achievement.value / next.threshold, 0), 1)
}

/** A threshold next to `valueText`: `10,000`, or `+24` when the value is written as `+22`. */
export const formatThreshold = (threshold: number, valueText: string) =>
  `${valueText.startsWith('+') ? '+' : ''}${threshold.toLocaleString('en-US')}`

/** A reward the API would have sent as null. */
export const paysSomething = (reward: AchievementReward | null): reward is AchievementReward =>
  reward !== null && (reward.gold > 0 || reward.silver > 0 || reward.copper > 0 || reward.items.length > 0)

// In progress, then not started, then finished. Not started means no level yet, the same as the dashed card.
const sortGroup = (achievement: Achievement) => (!nextLevel(achievement) ? 2 : achievement.levelsDone === 0 ? 1 : 0)

/** Closest to its next level first within each group. Finished ones keep the API's order. */
export const sortAchievements = (achievements: Achievement[]) =>
  [...achievements].sort((a, b) => sortGroup(a) - sortGroup(b) || progressRatio(b) - progressRatio(a))

/** The unfinished achievements closest to their next level, leaving out the ones with nothing counted yet. */
export const almostThere = (achievements: Achievement[], count = 3) =>
  achievements
    .filter((achievement) => nextLevel(achievement) && achievement.value > 0)
    .sort((a, b) => progressRatio(b) - progressRatio(a))
    .slice(0, count)

// Both ends are the server's clock, so any zone suffix is dropped and UTC only does the arithmetic.
function clockMs(value: string) {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?/.exec(value)
  return match ? Date.parse(`${match[1]}T${match[2]}:${match[3] ?? '00'}Z`) : NaN
}

/** How long ago `at` was on the server's clock: `just now`, `5 min ago`, `3 h ago`, `2 d ago`. */
export function timeAgo(serverNow: string, at: string) {
  const minutes = Math.floor((clockMs(serverNow) - clockMs(at)) / 60_000)
  if (Number.isNaN(minutes)) return ''
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ago`
  return `${Math.floor(minutes / (24 * 60))} d ago`
}

/** `13 Nov 21:14`, read straight off the server's clock. */
export const formatCheckTime = (value: string) => `${formatDay(value)} ${value.slice(11, 16)}`
