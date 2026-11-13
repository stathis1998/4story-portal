import {
  ACHIEVEMENT_CATEGORIES,
  type AchievementRewardInput,
  achievementLevelName,
  type GmAchievement,
} from '@4story-portal/shared'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { Button } from '../../../components/Button'
import { FormMessage } from '../../../components/FormMessage'
import { GmNav } from '../../../components/gm/GmNav'
import { RewardEditor } from '../../../components/gm/RewardEditor'
import { RewardSummary } from '../../../components/stats/RewardSummary'
import { StatusBadge } from '../../../components/StatusBadge'
import { Tabs } from '../../../components/Tabs'
import {
  achievementErrorMessage,
  formatCheckTime,
  gmAchievementsQueryOptions,
  paysSomething,
  useSaveAchievementReward,
  useSendTestAnnouncement,
  useSetAchievementsLive,
} from '../../../lib/achievements'
import { meQueryOptions } from '../../../lib/session'

export const Route = createFileRoute('/_authed/gm/achievements')({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions)
    if (!me?.isGm) throw redirect({ to: '/characters' })
  },
  component: GmAchievementsPage,
})

const labelText = 'text-xs font-bold tracking-wider text-muted uppercase'

const levelKey = (achievementId: string, level: number) => `${achievementId}:${level}`

function GmAchievementsPage() {
  const { data, isError } = useQuery(gmAchievementsQueryOptions)
  const setLive = useSetAchievementsLive()
  const saveReward = useSaveAchievementReward()
  const testAnnouncement = useSendTestAnnouncement()
  const [chosen, setChosen] = useState<string>()
  const [editing, setEditing] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const editButtons = useRef<Record<string, HTMLButtonElement | null>>({})
  const focusAfterClose = useRef<string | null>(null)

  // The editor takes its row's Edit button away, so closing it has to put the focus somewhere: back on
  // that button after Cancel, on the next level's after Save. Filling in every level is then Enter,
  // type, Enter.
  useEffect(() => {
    if (editing !== null || focusAfterClose.current === null) return
    editButtons.current[focusAfterClose.current]?.focus()
    focusAfterClose.current = null
  }, [editing])

  const categories = ACHIEVEMENT_CATEGORIES.map(({ id, label }) => {
    const achievements = (data?.achievements ?? []).filter((achievement) => achievement.category === id)
    const levels = achievements.flatMap((achievement) => achievement.levels)
    return {
      id,
      // How far along the GM is: levels with a reward, out of all of them.
      label: `${label} ${levels.filter((level) => paysSomething(level.reward)).length}/${levels.length}`,
      achievements,
    }
  }).filter((category) => category.achievements.length > 0)
  const active = categories.find((category) => category.id === chosen) ?? categories[0]
  const keys = (active?.achievements ?? []).flatMap((achievement) =>
    achievement.levels.map((level) => levelKey(achievement.id, level.level)),
  )

  async function toggleLive() {
    if (!data) return
    const live = !data.live
    if (
      live &&
      !window.confirm('Go live? Every level players have already completed will be mailed and announced now.')
    ) {
      return
    }
    setNote(null)
    setError(null)
    try {
      await setLive.mutateAsync({ live })
    } catch (err) {
      setError(achievementErrorMessage(err))
    }
  }

  async function sendTest() {
    setNote(null)
    setError(null)
    try {
      await testAnnouncement.mutateAsync()
      setNote('Test announcement sent.')
    } catch (err) {
      setError(achievementErrorMessage(err))
    }
  }

  // Only closes the editor it was asked about: another level may have been opened while this one saved.
  function close(key: string, focus: string) {
    focusAfterClose.current = focus
    setEditing((current) => (current === key ? null : current))
  }

  async function save(achievement: GmAchievement, level: number, reward: AchievementRewardInput) {
    const key = levelKey(achievement.id, level)
    setSaveError(null)
    try {
      await saveReward.mutateAsync({ achievementId: achievement.id, level, reward })
      close(key, keys[keys.indexOf(key) + 1] ?? key)
    } catch (err) {
      setSaveError(achievementErrorMessage(err))
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <GmNav />
      <h1 className="text-4xl">Achievements</h1>
      <p className="mt-2 text-sm text-muted">
        What each achievement level pays. Once rewards are live, a completed level is mailed to the player and
        announced in the game.
      </p>

      <div className="mt-6 flex flex-col gap-6">
        <FormMessage message={isError && !data ? 'Could not load achievements.' : null} />
        {data && (
          <>
            <section aria-label="Status" className="flex flex-col gap-4 rounded-xs border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span id="go-live-label" className={labelText}>
                  Go live
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={data.live}
                  aria-labelledby="go-live-label"
                  disabled={setLive.isPending}
                  onClick={() => void toggleLive()}
                  className={`flex items-center gap-2 rounded-xs border px-3 py-1.5 text-sm font-bold tracking-wide transition outline-none focus-visible:ring-2 focus-visible:ring-accent-text focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-60 ${
                    data.live ? 'border-accent text-accent-text' : 'border-secondary/50 text-secondary'
                  }`}
                >
                  <span aria-hidden="true" className={`relative h-4 w-7 rounded-full transition ${data.live ? 'bg-accent' : 'bg-line'}`}>
                    <span className={`absolute top-0.5 size-3 rounded-full bg-fg transition-all ${data.live ? 'left-3.5' : 'left-0.5'}`} />
                  </span>
                  {data.live ? 'On' : 'Off'}
                </button>
                <p className="text-sm text-muted">
                  {data.live
                    ? 'Rewards are live: completed levels are mailed and announced.'
                    : 'Rewards are off: levels are counted, but nothing is mailed or announced.'}
                </p>
              </div>

              <dl className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
                <div className="flex flex-col gap-0.5">
                  <dt className={labelText}>Control server</dt>
                  <dd>
                    <StatusBadge state={data.control} />
                  </dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className={labelText}>Awards</dt>
                  <dd>{data.awards.toLocaleString('en-US')}</dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className={labelText}>Pending announcements</dt>
                  <dd>{data.pendingAnnouncements.toLocaleString('en-US')}</dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className={labelText}>Last check</dt>
                  <dd>{data.lastCheck ? formatCheckTime(data.lastCheck) : 'Not yet'}</dd>
                </div>
              </dl>

              <div className="flex flex-wrap items-center gap-3">
                <Button variant="secondary" size="sm" onClick={() => void sendTest()} disabled={testAnnouncement.isPending}>
                  Send test announcement
                </Button>
                {note && <p className="text-sm font-bold text-accent-text">{note}</p>}
              </div>
              <FormMessage message={error} />
            </section>

            <section aria-labelledby="rewards-heading" className="flex flex-col gap-3">
              <div>
                <h2 id="rewards-heading" className="text-2xl">
                  Rewards
                </h2>
                <p className="mt-1 text-sm text-muted">
                  Each tab counts the levels that pay something. Saving a level moves on to the next one.
                </p>
              </div>
              {active ? (
                <>
                  <Tabs
                    tabs={categories.map(({ id, label }) => ({ id, label }))}
                    active={active.id}
                    onChange={(id) => {
                      setChosen(id)
                      focusAfterClose.current = null
                      setEditing(null)
                    }}
                  />
                  <div
                    role="tabpanel"
                    id={`panel-${active.id}`}
                    aria-labelledby={`tab-${active.id}`}
                    className="flex flex-col gap-4"
                  >
                    {active.achievements.map((achievement) => (
                      <section
                        key={achievement.id}
                        aria-labelledby={`reward-${achievement.id}`}
                        className="rounded-xs border border-line bg-surface"
                      >
                        <h3 id={`reward-${achievement.id}`} className="border-b border-line px-3 py-2 text-lg">
                          {achievement.name}
                        </h3>
                        <ul>
                          {achievement.levels.map((level) => {
                            const key = levelKey(achievement.id, level.level)
                            const name = achievementLevelName(achievement.name, level.level, achievement.levels.length)
                            return (
                              <li key={level.level} className="border-b border-line px-3 py-2 text-sm last:border-b-0">
                                {editing === key ? (
                                  <div className="flex flex-col gap-3">
                                    <p>
                                      <span className="font-bold">{name}</span>{' '}
                                      <span className="text-muted">{level.goal}</span>
                                    </p>
                                    <RewardEditor
                                      name={name}
                                      reward={level.reward}
                                      saving={saveReward.isPending}
                                      error={saveError}
                                      onSave={(reward) => void save(achievement, level.level, reward)}
                                      onCancel={() => close(key, key)}
                                    />
                                  </div>
                                ) : (
                                  <div className="grid items-center gap-x-4 gap-y-1 sm:grid-cols-[10rem_1fr_auto_auto]">
                                    <span className="font-bold">{name}</span>
                                    <span className="text-muted">{level.goal}</span>
                                    <span>
                                      {paysSomething(level.reward) ? (
                                        <RewardSummary reward={level.reward} names />
                                      ) : (
                                        <span className="text-muted">No reward</span>
                                      )}
                                    </span>
                                    <div>
                                      <Button
                                        ref={(el) => {
                                          editButtons.current[key] = el
                                        }}
                                        variant="secondary"
                                        size="sm"
                                        aria-label={`Edit reward for ${name}`}
                                        onClick={() => {
                                          setSaveError(null)
                                          setEditing(key)
                                        }}
                                      >
                                        Edit
                                      </Button>
                                    </div>
                                  </div>
                                )}
                              </li>
                            )
                          })}
                        </ul>
                      </section>
                    ))}
                  </div>
                </>
              ) : (
                <p className="rounded-xs border border-dashed border-line p-10 text-center text-muted">
                  No achievements have been set up yet.
                </p>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  )
}
