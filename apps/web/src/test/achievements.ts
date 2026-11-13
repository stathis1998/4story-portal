import type { Achievement, AchievementLevel, AchievementsOverview } from '@4story-portal/shared'

export function level(overrides: Partial<AchievementLevel> = {}): AchievementLevel {
  return {
    level: 1,
    threshold: 100,
    goal: 'Defeat 100 monsters',
    reward: null,
    done: false,
    earnedAt: null,
    holders: 0,
    ...overrides,
  }
}

/** Slayer: two of five levels done, 7,420 of the 10,000 for the third, which pays coins and an item. */
export function achievement(overrides: Partial<Achievement> = {}): Achievement {
  return {
    id: 'slayer',
    name: 'Slayer',
    category: 'combat',
    value: 7420,
    valueText: '7,420',
    levelsDone: 2,
    levels: [
      level({ level: 1, done: true, earnedAt: '2026-11-09T18:30:00', holders: 4 }),
      level({ level: 2, threshold: 1000, goal: 'Defeat 1,000 monsters', done: true, holders: 3 }),
      level({
        level: 3,
        threshold: 10_000,
        goal: 'Defeat 10,000 monsters',
        reward: { gold: 5, silver: 0, copper: 250, items: [{ itemId: 51, count: 3, name: 'Small Potion', icon: 12 }] },
        holders: 1,
      }),
      level({ level: 4, threshold: 50_000, goal: 'Defeat 50,000 monsters' }),
      level({ level: 5, threshold: 100_000, goal: 'Defeat 100,000 monsters' }),
    ],
    ...overrides,
  }
}

/** A one-level achievement, `percent` of the way there, or done at 100. */
export function simple(id: string, name: string, percent: number, overrides: Partial<Achievement> = {}): Achievement {
  const done = percent >= 100
  return achievement({
    id,
    name,
    value: percent,
    valueText: String(percent),
    levelsDone: done ? 1 : 0,
    levels: [level({ goal: `Reach 100 for ${name}`, done })],
    ...overrides,
  })
}

/** The totals follow from the achievements unless given. */
export function achievementsOverview(overrides: Partial<AchievementsOverview> = {}): AchievementsOverview {
  const achievements = overrides.achievements ?? [achievement()]
  return {
    achievements,
    levelsDone: achievements.reduce((sum, { levelsDone }) => sum + levelsDone, 0),
    levelsTotal: achievements.reduce((sum, { levels }) => sum + levels.length, 0),
    players: 5,
    live: true,
    ...overrides,
  }
}
