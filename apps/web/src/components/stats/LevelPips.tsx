import type { AchievementLevel } from '@4story-portal/shared'

/** One dot per level, filled when done. The text beside it says the same, so it is hidden from readers. */
export function LevelPips({ levels }: { levels: AchievementLevel[] }) {
  return (
    <span aria-hidden="true" className="flex gap-0.5">
      {levels.map((level) => (
        <span key={level.level} className={`size-1.5 rounded-full ${level.done ? 'bg-accent' : 'bg-line'}`} />
      ))}
    </span>
  )
}
