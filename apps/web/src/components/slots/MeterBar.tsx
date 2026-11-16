type Props = {
  points: number
  /** The machine's meter size. */
  size: number
}

/**
 * The player's meter for the machine and stake chosen: "Meter 12 / 30" over a thin bar. One line tall, so it sits
 * beside the Win figure under the stakes and never pushes Spin down. Points over the size (the moment it fills) read
 * as full.
 */
export function MeterBar({ points, size }: Props) {
  const shown = Math.min(points, size)
  return (
    <div className="flex w-24 shrink-0 flex-col justify-center gap-1 sm:w-36">
      <span className="text-xs leading-none text-muted tabular-nums">{`Meter ${shown} / ${size}`}</span>
      <div
        role="progressbar"
        aria-label="Meter"
        aria-valuemin={0}
        aria-valuemax={size}
        aria-valuenow={shown}
        className="h-1.5 overflow-hidden rounded-full bg-surface-raised"
      >
        <div className="h-full bg-accent transition-[width] duration-200" style={{ width: `${size > 0 ? (shown / size) * 100 : 0}%` }} />
      </div>
    </div>
  )
}
