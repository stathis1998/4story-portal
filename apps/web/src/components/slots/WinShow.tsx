import { silverText } from '@4story-portal/shared'
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

/** What is drawn over the window while a round shows: the free spins' banners, and a big or huge win with its coins. */
export function WinShow({ banner, win }: { banner: WinBanner | null; win: number | null }) {
  if (!banner) return null
  if (banner.kind === 'freeStart' || banner.kind === 'freeEnd') {
    const text =
      banner.kind === 'freeStart'
        ? `${banner.spins} free spins. Every win is doubled.`
        : `${banner.spins} free spins won ${banner.won > 0 ? silverText(banner.won) : 'nothing'}.`
    return (
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-2">
        <p className="rounded-xs border border-accent bg-black/85 px-4 py-2 text-center text-lg font-bold text-fg shadow-[0_4px_16px_rgb(0_0_0/0.7)] sm:text-2xl">
          {text}
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
