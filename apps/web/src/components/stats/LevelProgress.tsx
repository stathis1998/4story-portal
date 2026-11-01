export function LevelProgress({ progress }: { progress: number }) {
  const percent = Math.round(progress * 100)
  return (
    <div
      role="progressbar"
      aria-label="Progress to next level"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      title={`${percent}% to next level`}
      className="h-1.5 overflow-hidden rounded-full bg-line"
    >
      <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
    </div>
  )
}
