import { silverText } from '@4story-portal/shared'
import type { SlotJackpot } from '@4story-portal/shared'

type Props = {
  jackpot: SlotJackpot
  /** The spin on show won the pot. */
  won: boolean
}

/**
 * The shared pot. On a phone it is the label, the pot, the cap and the bar, so Spin stays on the first screen; the
 * explanation and the last winner show from sm up. Even so it does not fit above five reels on a 360 x 560 screen,
 * so on a phone it is drawn under the machine (by order, so it is still read first).
 */
export function JackpotBanner({ jackpot, won }: Props) {
  const { live, pot, cap, floor, last } = jackpot
  // A pot can read past its cap (a cap lowered after it grew): the bar stops at full.
  const filled = Math.min(pot, cap)
  return (
    <section
      aria-label="Jackpot"
      data-won={won ? 'true' : undefined}
      className="order-1 mt-2 rounded-xs border border-line bg-surface p-3 motion-safe:data-[won=true]:animate-[jackpot-won_1.2s_ease-in-out_3] sm:order-none sm:mt-0 sm:mb-4 sm:p-4"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-bold tracking-wider text-muted uppercase">Jackpot</span>
        <span className="text-xl font-bold text-accent-text tabular-nums sm:text-2xl">{silverText(pot)}</span>
      </div>
      <p className="mt-0.5 text-xs text-muted">{live ? `Must be won before ${silverText(cap)}` : 'The jackpot is paused.'}</p>
      <div
        role="progressbar"
        aria-label="Jackpot"
        aria-valuemin={0}
        aria-valuemax={cap}
        aria-valuenow={filled}
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-raised"
      >
        <div className="h-full bg-accent" style={{ width: `${cap > 0 ? (filled / cap) * 100 : 0}%` }} />
      </div>
      <p className="mt-2 hidden text-sm text-muted sm:block">
        Every lost round adds to it, on any machine. It can drop from {silverText(floor)}.
      </p>
      {last && (
        <p className="mt-1 hidden text-sm text-muted sm:block">
          Last won by {last.character}: {silverText(last.amount)}.
        </p>
      )}
    </section>
  )
}
