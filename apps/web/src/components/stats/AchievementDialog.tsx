import { ACHIEVEMENT_CATEGORIES, type Achievement, type AchievementLevel, achievementLevelName } from '@4story-portal/shared'
import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { nextLevel, paysSomething, progressRatio } from '../../lib/achievements'
import { formatDay } from '../../lib/stats'
import { LevelPips } from './LevelPips'
import { RewardSummary } from './RewardSummary'

type Props = {
  achievement: Achievement
  /** Ranked accounts, the `of y` behind every level's holders. */
  players: number
  onClose: () => void
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

/** `Aki`, `Aki and Bo`, `Aki, Bo and Cy`. */
function listNames(names: string[]) {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

function reachedBy({ holders, holderNames }: AchievementLevel, players: number) {
  if (holders === 0) return 'Nobody has reached this yet'
  const count = `${holders} of ${players} players`
  return holderNames.length > 0 ? `Reached by ${listNames(holderNames)} · ${count}` : count
}

/** Everything about one achievement, over the page: each level, its reward, who has it and how far you are. */
export function AchievementDialog({ achievement, players, onClose }: Props) {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  const { name, levels, levelsDone, valueText } = achievement
  const next = nextLevel(achievement)
  const percent = Math.round(progressRatio(achievement) * 100)
  const single = levels.length === 1
  const category = ACHIEVEMENT_CATEGORIES.find(({ id }) => id === achievement.category)?.label

  // Focus goes in while it is open and back to where it was after, and the page behind holds still.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    close.current?.focus()
    return () => {
      document.body.style.overflow = overflow
      opener?.focus()
    }
  }, [])

  // On the document, not the panel: a click on the text inside leaves the focus on the page itself,
  // and Escape and Tab still have to work from there.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        return onClose()
      }
      if (event.key !== 'Tab') return
      const stops = [...(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
      const first = stops[0]
      const last = stops[stops.length - 1]
      if (!first || !last) return event.preventDefault()
      const active = document.activeElement
      const outside = !panel.current?.contains(active)
      // Tab stays inside while the rest of the page is covered.
      if (event.shiftKey ? outside || active === first : outside || active === last) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])
  // On the body: a card that hasn't been started is dimmed, and the pop-up must not be dimmed with it.
  return createPortal(
    <div
      role="presentation"
      data-testid="achievement-backdrop"
      onClick={(event) => event.target === event.currentTarget && onClose()}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center sm:p-4"
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[90dvh] w-full max-w-xl flex-col rounded-xs border border-line bg-surface shadow-2xl"
      >
        <header className="flex flex-col gap-2 border-b border-line p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {category && <p className="text-xs font-bold tracking-wider text-muted uppercase">{category}</p>}
              <h2 id={titleId} className="text-2xl break-words">
                {name}
              </h2>
            </div>
            <button
              ref={close}
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="shrink-0 cursor-pointer rounded-xs border border-line px-2.5 py-1 text-lg leading-none text-muted outline-none transition hover:border-accent hover:text-fg focus-visible:ring-2 focus-visible:ring-accent-text"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <span>{single ? (levelsDone === 0 ? 'Not done' : 'Done') : `Level ${levelsDone}/${levels.length}`}</span>
            {!single && <LevelPips levels={levels} />}
            <span>{next ? `${valueText} / ${next.thresholdText}` : `${valueText} · Completed`}</span>
          </p>
        </header>

        <ol aria-label={`${name} levels`} className="overflow-y-auto">
          {levels.map((level) => {
            const current = level === next
            const locked = !level.done && !current
            return (
              <li
                key={level.level}
                className={`flex flex-col gap-1.5 border-b border-line px-4 py-3 text-sm last:border-b-0 ${current ? 'bg-surface-raised' : ''}`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className={`font-bold ${level.done ? 'text-accent-text' : locked ? 'text-muted' : ''}`}>
                    {achievementLevelName(name, level.level, levels.length)}
                  </span>
                  <span className="shrink-0 text-xs text-muted">
                    {level.done ? (level.earnedAt ? `Earned ${formatDay(level.earnedAt)}` : 'Done') : current ? 'In progress' : null}
                  </span>
                </div>
                <p className={locked ? 'text-muted' : ''}>{level.goal}</p>
                {current && (
                  <div className="flex items-center gap-3">
                    <span
                      role="progressbar"
                      aria-label={`${achievementLevelName(name, level.level, levels.length)} progress`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={percent}
                      className="block h-1.5 flex-1 overflow-hidden rounded-full bg-line"
                    >
                      <span className="block h-full bg-accent" style={{ width: `${percent}%` }} />
                    </span>
                    <span className="shrink-0 text-xs text-muted tabular-nums">
                      {valueText} / {level.thresholdText}
                    </span>
                  </div>
                )}
                {paysSomething(level.reward) && (
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-xs font-bold tracking-wider text-muted uppercase">Reward</span>
                    <RewardSummary reward={level.reward} names />
                  </p>
                )}
                <p className="text-xs text-muted">{reachedBy(level, players)}</p>
              </li>
            )
          })}
        </ol>
      </div>
    </div>,
    document.body,
  )
}
