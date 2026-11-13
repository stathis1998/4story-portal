import type {
  Achievement,
  AchievementGroup,
  AchievementLevel,
  AchievementsOverview,
  CharacterAchievements,
} from '@4story-portal/shared'

export function level(overrides: Partial<AchievementLevel> = {}): AchievementLevel {
  const threshold = overrides.threshold ?? 100
  return {
    level: 1,
    threshold,
    thresholdText: threshold.toLocaleString('en-US'),
    goal: 'Defeat 100 monsters',
    reward: null,
    done: false,
    earnedAt: null,
    holders: 0,
    holderNames: [],
    ...overrides,
  }
}

/**
 * Slayer, a character achievement measured against five characters: two of five levels done, 7,420 of
 * the 10,000 for the third, which pays coins and an item.
 */
export function achievement(overrides: Partial<Achievement> = {}): Achievement {
  return {
    id: 'slayer',
    name: 'Slayer',
    category: 'combat',
    scope: 'character',
    population: 5,
    value: 7420,
    valueText: '7,420',
    levelsDone: 2,
    levels: [
      level({ level: 1, done: true, earnedAt: '2026-11-09T18:30:00', holders: 4, holderNames: ['Aki', 'Bo', 'Cy', 'Dee'] }),
      level({ level: 2, threshold: 1000, goal: 'Defeat 1,000 monsters', done: true, holders: 3, holderNames: ['Aki', 'Bo', 'Cy'] }),
      level({
        level: 3,
        threshold: 10_000,
        goal: 'Defeat 10,000 monsters',
        reward: { gold: 5, silver: 0, copper: 250, items: [{ itemId: 51, count: 3, name: 'Small Potion', icon: 12 }] },
        holders: 1,
        holderNames: ['Aki'],
      }),
      level({ level: 4, threshold: 50_000, goal: 'Defeat 50,000 monsters' }),
      level({ level: 5, threshold: 100_000, goal: 'Defeat 100,000 monsters' }),
    ],
    ...overrides,
  }
}

/** A one-level achievement, `percent` of the way there, or done at 100. It pays nothing. */
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

/** A set of achievements with the totals that follow from them. */
export function achievementGroup(achievements: Achievement[]): AchievementGroup {
  return {
    achievements,
    levelsDone: achievements.reduce((sum, { levelsDone }) => sum + levelsDone, 0),
    levelsTotal: achievements.reduce((sum, { levels }) => sum + levels.length, 0),
  }
}

/** Kaelith, a level 50 Warrior, with Slayer unless given other achievements. */
export function characterGroup(overrides: Partial<CharacterAchievements> = {}): CharacterAchievements {
  return {
    id: 1,
    name: 'Kaelith',
    level: 50,
    className: 'Warrior',
    ...achievementGroup(overrides.achievements ?? [achievement()]),
    ...overrides,
  }
}

/** The account's own achievements, each marked as one. */
export function accountGroup(achievements: Achievement[] = []): AchievementGroup {
  return achievementGroup(achievements.map((item) => ({ ...item, scope: 'account' })))
}

/** One character, Kaelith with Slayer, and an account with no achievements of its own, unless given. */
export function achievementsOverview(overrides: Partial<AchievementsOverview> = {}): AchievementsOverview {
  return {
    account: accountGroup(),
    characters: [characterGroup()],
    live: true,
    ...overrides,
  }
}
