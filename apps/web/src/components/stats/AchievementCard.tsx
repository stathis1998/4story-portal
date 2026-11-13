import type { Achievement } from '@4story-portal/shared'
import { useCallback, useState } from 'react'
import { nextLevel, paysSomething, progressRatio } from '../../lib/achievements'
import { AchievementDialog } from './AchievementDialog'
import { LevelPips } from './LevelPips'
import { RewardSummary } from './RewardSummary'

type Props = {
  achievement: Achievement
  /** Ranked accounts, the `of y` behind every level's holders. */
  players: number
}

/** One achievement at a glance: its level and the next goal. A click opens every level in a pop-up. */
export function AchievementCard({ achievement, players }: Props) {
  const [open, setOpen] = useState(false)
  // Stable, so the pop-up's key listener isn't re-attached on every refresh of the data.
  const close = useCallback(() => setOpen(false), [])
  const { name, levels, levelsDone, valueText } = achievement
  const next = nextLevel(achievement)
  const percent = Math.round(progressRatio(achievement) * 100)
  const single = levels.length === 1
  const notStarted = levelsDone === 0

  return (
    // Dimmed until it has a level, and back to full while it is pointed at or focused.
    <li className={`rounded-xs ${notStarted ? 'opacity-60 transition-opacity focus-within:opacity-100 hover:opacity-100' : ''}`}>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className={`group flex h-full w-full cursor-pointer flex-col gap-1.5 rounded-xs border p-3 text-left outline-none transition-colors hover:border-accent hover:bg-surface-raised focus-visible:ring-2 focus-visible:ring-accent-text ${
          notStarted ? 'border-dashed border-line' : 'border-line bg-surface'
        }`}
      >
        <span className="flex items-baseline justify-between gap-2">
          <span className="min-w-0 font-bold break-words">{name}</span>
          <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
            {single ? (notStarted ? 'Not done' : 'Done') : `Level ${levelsDone}/${levels.length}`}
            {!single && <LevelPips levels={levels} />}
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
        <span className="text-xs text-muted">{next ? `${valueText} / ${next.thresholdText}` : valueText}</span>
        <span className="text-sm">{next ? `Next: ${next.goal}` : 'Completed'}</span>
        {next && paysSomething(next.reward) && (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className="text-muted">Reward</span>
            <RewardSummary reward={next.reward} />
          </span>
        )}
        <span className="mt-auto self-end pt-1 text-xs font-bold text-accent-text group-hover:underline">
          {single ? 'View details' : 'View levels'} <span aria-hidden="true">›</span>
        </span>
      </button>
      {open && <AchievementDialog achievement={achievement} players={players} onClose={close} />}
    </li>
  )
}
