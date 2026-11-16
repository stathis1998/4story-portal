import { silverText } from '@4story-portal/shared'
import type { SlotJackpotView, SlotPot } from '@4story-portal/shared'

const POT_NAMES: Record<SlotPot, string> = { mini: 'Mini', major: 'Major', giga: 'Giga' }

type Props = {
  /** Mini first; empty when the pots cannot be read. */
  jackpots: readonly SlotJackpotView[]
  /** The pots the round on show won. */
  won: readonly SlotPot[]
}

/**
 * The three shared pots side by side, even on a phone: each its name, its pot, its bar and when it must drop. The
 * last winner shows from sm up. On a phone, and on a screen too short for them above the machine, the three are
 * drawn under the machine (by order, so they are still read first), so Spin stays on the first screen.
 */
export function JackpotMeters({ jackpots, won }: Props) {
  if (jackpots.length === 0) return null
  return (
    <section aria-label="Jackpots" className="order-1 mt-2 grid grid-cols-3 gap-1.5 sm:order-none sm:mt-0 sm:mb-4 sm:gap-3 short:order-1 short:mt-3 short:mb-0">
      {jackpots.map((jackpot) => (
        <Pot key={jackpot.pot} jackpot={jackpot} won={won.includes(jackpot.pot)} />
      ))}
    </section>
  )
}

function Pot({ jackpot, won }: { jackpot: SlotJackpotView; won: boolean }) {
  const { pot, live, amount, cap, last } = jackpot
  const name = POT_NAMES[pot]
  // A pot can read past its cap (a cap lowered after it grew): the bar stops at full.
  const filled = Math.min(amount, cap)
  return (
    <div
      role="group"
      aria-label={name}
      data-won={won ? 'true' : undefined}
      className="min-w-0 rounded-xs border border-line bg-surface p-2 motion-safe:data-[won=true]:animate-[jackpot-won_1.2s_ease-in-out_3] sm:p-3"
    >
      <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between sm:gap-2">
        <span className="text-xs font-bold tracking-wider text-muted uppercase">{name}</span>
        <span className="text-xs font-bold text-accent-text tabular-nums sm:text-xl">{silverText(amount)}</span>
      </div>
      <div
        role="progressbar"
        aria-label={`${name} jackpot`}
        aria-valuemin={0}
        aria-valuemax={cap}
        aria-valuenow={filled}
        className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-raised"
      >
        <div className="h-full bg-accent" style={{ width: `${cap > 0 ? (filled / cap) * 100 : 0}%` }} />
      </div>
      <p className="mt-1 text-[11px] leading-tight text-muted sm:text-xs">{live ? `must drop before ${silverText(cap)}` : 'Paused'}</p>
      {last && (
        <p className="mt-1 hidden text-sm text-muted sm:block">
          Last won by {last.character}: {silverText(last.amount)}.
        </p>
      )}
    </div>
  )
}
