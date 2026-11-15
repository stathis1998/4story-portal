import { SLOT_METER_FREE, silverText } from '@4story-portal/shared'
import type { WinBanner } from '../../lib/use-slot-round'

/** Coins falling through a big win, and more through a huge one. Where each starts across the window, as a share. */
const COIN_SPOTS = [0.06, 0.52, 0.27, 0.81, 0.4, 0.93, 0.15, 0.67, 0.34, 0.74, 0.02, 0.58, 0.21, 0.88, 0.46, 0.11, 0.63, 0.3, 0.97, 0.38, 0.84, 0.18, 0.7, 0.49]

function Coins({ count }: { count: number }) {
  return (
    // None at all when the browser asks for no motion.
    <div aria-hidden="true" className="absolute inset-0 hidden motion-safe:block">
      {COIN_SPOTS.slice(0, count).map((spot, i) => (
        <span
          key={i}
          className="absolute -top-8 size-5 animate-[slot-coin_1.6s_linear_infinite] rounded-full border border-[#7a5410] sm:size-7"
          style={{
            left: `${spot * 92}%`,
            animationDelay: `${(i * 0.23) % 1.6}s`,
            background: 'radial-gradient(circle at 35% 30%, #fff1b8, #ffd36b 40%, #b8860b 80%)',
          }}
        />
      ))}
    </div>
  )
}

/** The free spins' and the meter's banners, in words. */
function bannerText(banner: Exclude<WinBanner, { kind: 'big' } | { kind: 'huge' }>): string {
  switch (banner.kind) {
    case 'freeStart':
      return `${banner.spins} free spins. The multiplier climbs.`
    case 'retrigger':
      return `+${banner.added} free spins`
    case 'meterFull':
      return `Meter full: ${SLOT_METER_FREE} free spins`
    case 'freeEnd':
      return `${banner.spins} free spins won ${banner.won > 0 ? silverText(banner.won) : 'nothing'}.`
  }
}

type WinShowProps = { banner: WinBanner | null; win: number | null; times: number | null }

/**
 * What is drawn over the window while a round shows: the multiplier in a corner, the free spins' and the meter's
 * banners, and a big or huge win with its coins.
 */
export function WinShow({ banner, win, times }: WinShowProps) {
  return (
    <>
      {times !== null && (
        <p
          data-testid="slot-multiplier"
          className="pointer-events-none absolute top-1 right-1 rounded-xs border border-[#ffd36b]/60 bg-black/80 px-1.5 text-sm leading-6 font-bold text-[#ffd36b] tabular-nums shadow-[0_2px_8px_rgb(0_0_0/0.7)] sm:top-2 sm:right-2 sm:px-2 sm:text-lg sm:leading-8"
        >
          {`x${times}`}
        </p>
      )}
      {banner && <Banner banner={banner} win={win} />}
    </>
  )
}

function Banner({ banner, win }: { banner: WinBanner; win: number | null }) {
  if (banner.kind !== 'big' && banner.kind !== 'huge') {
    return (
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-2">
        <p className="rounded-xs border border-accent bg-black/85 px-4 py-2 text-center text-lg font-bold text-fg shadow-[0_4px_16px_rgb(0_0_0/0.7)] sm:text-2xl">
          {bannerText(banner)}
        </p>
      </div>
    )
  }
  const huge = banner.kind === 'huge'
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center overflow-hidden bg-black/55">
      <Coins count={huge ? COIN_SPOTS.length : 12} />
      <p
        className={`relative font-display font-bold tracking-widest text-[#ffd36b] uppercase [text-shadow:0_2px_8px_rgb(0_0_0/0.9)] ${huge ? 'text-4xl sm:text-6xl' : 'text-3xl sm:text-5xl'}`}
      >
        {huge ? 'Huge win' : 'Big win'}
      </p>
      <p className="relative mt-1 text-xl font-bold text-fg tabular-nums [text-shadow:0_2px_6px_rgb(0_0_0/0.9)] sm:text-3xl">{silverText(win ?? 0)}</p>
    </div>
  )
}
