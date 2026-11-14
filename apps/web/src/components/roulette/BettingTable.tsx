import { ROULETTE_SPOTS, rouletteColour, silverText, spotLabel } from '@4story-portal/shared'
import type { RouletteSpot } from '@4story-portal/shared'
import type { CSSProperties } from 'react'
import { ChipDisc } from './ChipRack'

type TableProps = {
  bets: Partial<Record<RouletteSpot, number>>
  winning: RouletteSpot[]
  disabled: boolean
  onPlace: (spot: RouletteSpot) => void
}

const FELT = '#1d5c3a'
const BLACK = '#1b1616'

/** Grid lines for a spot: upright on a phone (zero on top, three numbers across) and lying down from lg. */
type Place = { row: string; col: string; wideRow: string; wideCol: string }

// The even-money spots, top to bottom upright and left to right lying down, as on a real table.
const EVEN_MONEY: RouletteSpot[] = ['low', 'even', 'red', 'black', 'odd', 'high']

function placeOf(spot: RouletteSpot): Place {
  if (spot === 'n0') return { row: '1', col: '3 / span 3', wideRow: '1 / span 3', wideCol: '1' }
  if (spot.startsWith('n')) {
    const n = Number(spot.slice(1))
    const across = (n - 1) % 3
    const down = Math.ceil(n / 3)
    return { row: String(1 + down), col: String(3 + across), wideRow: String(3 - across), wideCol: String(1 + down) }
  }
  if (spot.startsWith('column')) {
    const c = Number(spot.slice(-1))
    return { row: '14', col: String(2 + c), wideRow: String(4 - c), wideCol: '14' }
  }
  if (spot.startsWith('dozen')) {
    const d = Number(spot.slice(-1)) - 1
    return { row: `${2 + 4 * d} / span 4`, col: '2', wideRow: '4', wideCol: `${2 + 4 * d} / span 4` }
  }
  const i = EVEN_MONEY.indexOf(spot)
  return { row: `${2 + 2 * i} / span 2`, col: '1', wideRow: '5', wideCol: `${2 + 2 * i} / span 2` }
}

const background = (spot: RouletteSpot) => {
  if (!spot.startsWith('n')) return FELT
  const colour = rouletteColour(Number(spot.slice(1)))
  return colour === 'red' ? 'var(--accent)' : colour === 'black' ? BLACK : FELT
}

/** The red and black diamonds on the felt. */
const Diamond = ({ fill }: { fill: string }) => (
  <svg viewBox="0 0 40 24" aria-hidden="true" className="h-5 w-9">
    <path d="M20 1 L39 12 L20 23 L1 12 Z" fill={fill} stroke="#f4efe8" strokeOpacity={0.8} strokeWidth={1.5} />
  </svg>
)

function face(spot: RouletteSpot) {
  if (spot === 'red') return <Diamond fill="var(--accent)" />
  if (spot === 'black') return <Diamond fill={BLACK} />
  if (spot.startsWith('column')) return <span className="text-sm font-bold">2:1</span>
  if (spot.startsWith('n')) return <span className="text-base font-bold lg:text-lg">{spotLabel(spot)}</span>
  return <span className="px-1 text-center text-xs font-bold leading-tight tracking-wide uppercase lg:text-sm">{spotLabel(spot)}</span>
}

/**
 * The betting felt: one button per spot. The DOM order is the same on a phone and a desktop; only the grid
 * placement changes, so the reading order and the tab order never jump around.
 */
export function BettingTable({ bets, winning, disabled, onPlace }: TableProps) {
  return (
    <div
      className="mx-auto grid w-full max-w-[26rem] auto-rows-[minmax(2.75rem,auto)] grid-cols-[minmax(0,4fr)_minmax(0,4fr)_repeat(3,minmax(0,5fr))] rounded-xs border-4 border-[#4a2e1c] p-1 text-[#f4efe8] select-none lg:max-w-none lg:auto-rows-[minmax(3.5rem,auto)] lg:grid-cols-[minmax(0,1.25fr)_repeat(12,minmax(0,1fr))_minmax(0,1.25fr)]"
      style={{ backgroundColor: FELT }}
    >
      {ROULETTE_SPOTS.map((spot) => {
        const amount = bets[spot] ?? 0
        const name = `Bet on ${spotLabel(spot)}${amount > 0 ? `, ${silverText(amount)} on it` : ''}`
        const place = placeOf(spot)
        const won = winning.includes(spot)
        return (
          <button
            key={spot}
            type="button"
            aria-label={name}
            title={name}
            data-won={won ? 'true' : undefined}
            disabled={disabled}
            onClick={() => onPlace(spot)}
            className="relative flex min-h-11 min-w-0 items-center justify-center shadow-[inset_0_0_0_1px_rgb(244_239_232/0.4)] transition outline-none [grid-column:var(--col)] [grid-row:var(--row)] focus-visible:z-20 focus-visible:shadow-[inset_0_0_0_3px_var(--fg)] enabled:hover:brightness-125 disabled:cursor-not-allowed data-[won=true]:z-10 data-[won=true]:brightness-125 data-[won=true]:shadow-[inset_0_0_0_3px_#f5d76e,0_0_14px_#f5d76e] lg:[grid-column:var(--wide-col)] lg:[grid-row:var(--wide-row)]"
            style={
              {
                backgroundColor: background(spot),
                '--row': place.row,
                '--col': place.col,
                '--wide-row': place.wideRow,
                '--wide-col': place.wideCol,
              } as CSSProperties
            }
          >
            {face(spot)}
            {amount > 0 && (
              // The chip sits on the spot, as on a real table; the label above carries the exact amount.
              <span className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/4 -translate-y-1/4">
                <ChipDisc amount={amount} size="felt" />
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
