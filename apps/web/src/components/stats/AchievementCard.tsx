import { type Achievement, achievementLevelName } from '@4story-portal/shared'
import { useId, useState } from 'react'
import { nextLevel, paysSomething, progressRatio } from '../../lib/achievements'
import { formatDay } from '../../lib/stats'
import { RewardSummary } from './RewardSummary'

type Props = {
  achievement: Achievement
  /** Ranked accounts, the `of y` behind every level's holders. */
  players: number
}

/** One achievement with all its levels: the next goal at a glance, every level once opened. */
export function AchievementCard({ achievement, players }: Props) {
  const [open, setOpen] = useState(false)
  const listId = useId()
  const { name, levels, levelsDone, valueText } = achievement
  const next = nextLevel(achievement)
  const percent = Math.round(progressRatio(achievement) * 100)
  const single = levels.length === 1
  const notStarted = levelsDone === 0

  return (
    <li
      className={`rounded-xs border ${
        notStarted
          ? `border-dashed border-line ${open ? '' : 'opacity-60 focus-within:opacity-100 hover:opacity-100'}`
          : 'border-line bg-surface'
      }`}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full flex-col gap-1.5 rounded-xs p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent-text"
      >
        <span className="flex items-baseline justify-between gap-2">
          <span className="min-w-0 font-bold break-words">{name}</span>
          <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
            {single ? (notStarted ? 'Not done' : 'Done') : `Level ${levelsDone}/${levels.length}`}
            {!single && (
              <span aria-hidden="true" className="flex gap-0.5">
                {levels.map((level) => (
                  <span key={level.level} className={`size-1.5 rounded-full ${level.done ? 'bg-accent' : 'bg-line'}`} />
                ))}
              </span>
            )}
          </span>
        </span>
        <span
          role="progressbar"
          aria-label={`${name} progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="block h-1 overflow-hidden rounded-full bg-line"
        >
          <span className="block h-full bg-accent" style={{ width: `${percent}%` }} />
        </span>
        <span className="text-xs text-muted">
          {next ? `${valueText} / ${next.thresholdText}` : valueText}
        </span>
        <span className="text-sm">{next ? `Next: ${next.goal}` : 'Completed'}</span>
        {next && paysSomething(next.reward) && (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className="text-muted">Reward</span>
            <RewardSummary reward={next.reward} />
          </span>
        )}
      </button>
      {open && (
        <ol id={listId} aria-label={`${name} levels`} className="border-t border-line">
          {levels.map((level) => (
            <li key={level.level} className="flex flex-col gap-0.5 border-b border-line px-3 py-2 text-sm last:border-b-0">
              <span className="flex items-baseline justify-between gap-2">
                <span className={`font-bold ${level.done ? 'text-accent-text' : ''}`}>
                  {achievementLevelName(name, level.level, levels.length)}
                </span>
                {level.done && (
                  <span className="shrink-0 text-xs text-muted">
                    {level.earnedAt ? `Earned ${formatDay(level.earnedAt)}` : 'Done'}
                  </span>
                )}
              </span>
              <span className="text-muted">{level.goal}</span>
              {paysSomething(level.reward) && <RewardSummary reward={level.reward} names />}
              <span className="text-xs text-muted">
                {level.holders} of {players} players
              </span>
            </li>
          ))}
        </ol>
      )}
    </li>
  )
}
