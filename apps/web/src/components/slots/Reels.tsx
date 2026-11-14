import { SLOT_REEL_STOPS, slotWindow } from '@4story-portal/shared'
import type { SlotMachine, SlotMachineKey, SlotStops } from '@4story-portal/shared'
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import { blurStepsAt, REEL_BLURS } from '../../lib/reel-blur'
import { planReels, reelsAt, SLOT_SPIN_SECONDS } from '../../lib/slots'

type ReelsProps = {
  machine: SlotMachine
  /** The stops showing when the reels are first drawn. Another machine needs a new Reels (a new React key). */
  rest: SlotStops
  /** A new key starts a spin from the stops showing to `stops`. A spin already there when the reels are drawn has been shown. */
  spin: { stops: SlotStops; key: number } | null
  /** False shows the result at once. */
  animate: boolean
  /** How many symbols on the line pay, from the left: 0, 2 or 3. */
  won: number
  /** Once per spin, when the last reel has stopped. Never after unmount. */
  onStopped: () => void
}

/** Tiles in a strip: one loop of the reel and the first few again, so the three rows are always full. */
const TILES = SLOT_REEL_STOPS + 4
const LETTERS = 'ABCDEF'

/** Each machine's cabinet: its frame, the inside behind the reels, and the colour of the win line and lit symbols. */
const CABINETS: Record<SlotMachineKey, { frame: string; inside: string; line: string }> = {
  // An alchemist's green glass.
  shelf: { frame: 'linear-gradient(160deg, #2f8a78, #123d35 70%)', inside: '#08201c', line: '#7ef0d2' },
  // Blued steel.
  armoury: { frame: 'linear-gradient(160deg, #5a6f8c, #1c2533 70%)', inside: '#0b1119', line: '#b4d0f5' },
  // Old gold.
  hoard: { frame: 'linear-gradient(160deg, #b08427, #45300b 70%)', inside: '#1c1305', line: '#ffd36b' },
}

/** Where a reel resting on `stop` is: the position whose stop on the line is `stop` (see reelStop in lib/slots). */
const restingAt = (stop: number) => (SLOT_REEL_STOPS - stop) % SLOT_REEL_STOPS

/**
 * How far a reel's strip is moved down, in rows, at `position`: tile n is drawn in row `offset + n`, and row 1 is the
 * win line. A growing position moves it down, and at rest on stop s tile s (or s + 32) is on the line, with the strip's
 * letter before it above and the one after it below, as slotWindow reads them.
 */
const stripOffset = (position: number) => (((position % SLOT_REEL_STOPS) + SLOT_REEL_STOPS + 1) % SLOT_REEL_STOPS) - SLOT_REEL_STOPS

/** The tile on the win line for a reel resting on `stop`. */
const lineTile = (stop: number) => 1 - stripOffset(restingAt(stop))

/** Moves each strip to its position, blurred along its run by `blurs` (a step from blurStep, 0 for sharp). */
function draw(strips: (HTMLDivElement | null)[], positions: number[], blurs: number[]) {
  strips.forEach((strip, i) => {
    if (!strip) return
    strip.style.transform = `translateY(${(stripOffset(positions[i]) / TILES) * 100}%)`
    strip.style.filter = blurs[i] > 0 ? `url(#${REEL_BLURS[blurs[i] - 1].id})` : ''
  })
}

/**
 * The cabinet: three reels of the machine's icons behind a window three symbols tall, the middle row the win line.
 * The strips are moved straight on the DOM, frame by frame, so a spin does not re-render React.
 */
export function Reels({ machine, rest, spin, animate, won, onStopped }: ReelsProps) {
  const strips = useRef<(HTMLDivElement | null)[]>([null, null, null])
  // The stops at rest, where the next spin starts from.
  const showing = useRef<SlotStops>(spin?.stops ?? rest)
  // The spin that has finished, so the label and the lit symbols can tell it.
  const [stoppedKey, setStoppedKey] = useState<number | null>(spin?.key ?? null)
  // The last spin reported as stopped. React's development mode runs effects twice, and a spin ends once.
  const reported = useRef<number | null>(spin?.key ?? null)
  const stopped = useEffectEvent((spinKey: number) => {
    if (reported.current === spinKey) return
    reported.current = spinKey
    onStopped()
  })

  useLayoutEffect(() => {
    draw(strips.current, showing.current.map(restingAt), [0, 0, 0])
  }, [])

  const key = spin?.key
  const stops = spin?.stops
  useEffect(() => {
    if (key === undefined || stops === undefined || reported.current === key) return
    const plan = planReels(showing.current, stops)
    const finish = () => {
      showing.current = stops
      draw(strips.current, reelsAt(plan, SLOT_SPIN_SECONDS), [0, 0, 0])
    }
    if (!animate) {
      finish()
      stopped(key)
      return
    }
    let start: number | null = null
    let request = 0
    const step = (now: number) => {
      start ??= now
      const seconds = (now - start) / 1000
      if (seconds < SLOT_SPIN_SECONDS) {
        draw(strips.current, reelsAt(plan, seconds), blurStepsAt(plan, seconds))
        request = requestAnimationFrame(step)
        return
      }
      finish()
      setStoppedKey(key)
      stopped(key)
    }
    request = requestAnimationFrame(step)
    return () => cancelAnimationFrame(request)
    // A spin is started by its key alone: a new `animate` mid-spin must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const settled = spin !== null && (!animate || stoppedKey === spin.key)
  const onLine = settled ? slotWindow(machine, spin.stops).map((rows) => machine.symbols[rows[1]].name) : null
  const label = spin === null ? 'Reels' : onLine ? `Reels: ${onLine.join(', ')} on the win line` : 'Reels, spinning'
  const cabinet = CABINETS[machine.key]

  return (
    <div
      role="img"
      aria-label={label}
      className="mx-auto w-fit rounded-md border border-black/60 p-2.5 shadow-[0_6px_20px_rgb(0_0_0/0.5)] min-[400px]:p-3.5"
      style={{ background: cabinet.frame }}
    >
      {/* The blurs for a moving reel: along the reel only, never sideways. Only one Reels is on a page, so the ids are unique. */}
      <svg aria-hidden="true" width="0" height="0" className="absolute">
        <defs>
          {REEL_BLURS.map((blur) => (
            <filter key={blur.id} id={blur.id} x="0" y="-10%" width="100%" height="120%" colorInterpolationFilters="sRGB">
              <feGaussianBlur stdDeviation={`0 ${blur.deviation}`} />
            </filter>
          ))}
        </defs>
      </svg>
      <div
        className="rounded-sm border border-black/70 px-3 py-1.5 shadow-[inset_0_2px_10px_rgb(0_0_0/0.8)] min-[400px]:px-4"
        style={{ backgroundColor: cabinet.inside }}
      >
        <div className="relative flex gap-1.5 min-[400px]:gap-2">
          {machine.reels.map((reel, i) => {
            const lit = settled && i < won ? lineTile(spin.stops[i]) : null
            return (
              <div key={i} className="relative h-42 w-14 overflow-hidden rounded-xs bg-black/40 min-[400px]:h-57 min-[400px]:w-19">
                <div
                  ref={(element) => {
                    strips.current[i] = element
                  }}
                  data-testid={`reel-${i}`}
                  className="will-change-transform"
                >
                  {Array.from({ length: TILES }, (_, n) => {
                    const symbol = machine.symbols[LETTERS.indexOf(reel[n % SLOT_REEL_STOPS])]
                    const isLit = n === lit
                    return (
                      <div key={n} data-won={isLit ? 'true' : undefined} className="flex h-14 items-center justify-center min-[400px]:h-19">
                        <div
                          className="rounded-xs border p-0.5 transition-[box-shadow,background-color] duration-300 min-[400px]:p-1"
                          style={
                            isLit
                              ? {
                                  borderColor: cabinet.line,
                                  backgroundColor: `color-mix(in srgb, ${cabinet.line} 30%, #141010)`,
                                  boxShadow: `inset 0 0 0 1px ${cabinet.line}, 0 0 12px ${cabinet.line}`,
                                }
                              : { borderColor: 'rgb(255 255 255 / 0.12)', backgroundColor: '#141010' }
                          }
                        >
                          <img
                            src={`/game-icons/${symbol.sprite}.png`}
                            alt=""
                            width={64}
                            height={64}
                            draggable={false}
                            className="block h-12 w-12 select-none [image-rendering:pixelated] min-[400px]:h-16 min-[400px]:w-16"
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
          {/* The rows above and below the line are shaded, so the eye goes to the line. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{ background: 'linear-gradient(to bottom, rgb(0 0 0 / 0.55), rgb(0 0 0 / 0.1) 33.4%, transparent 33.4%, transparent 66.6%, rgb(0 0 0 / 0.1) 66.6%, rgb(0 0 0 / 0.55))' }}
          />
          {/* The win line: a rule above and below the middle row, and a pointer at each end. */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/3 h-1/3">
            <div className="absolute -inset-x-1 -top-px h-0.5 rounded-full opacity-80" style={{ backgroundColor: cabinet.line }} />
            <div className="absolute -inset-x-1 -bottom-px h-0.5 rounded-full opacity-80" style={{ backgroundColor: cabinet.line }} />
            <div
              className="absolute top-1/2 -left-2.5 h-0 w-0 -translate-y-1/2 border-y-[7px] border-l-[9px] border-y-transparent min-[400px]:-left-3.5"
              style={{ borderLeftColor: cabinet.line }}
            />
            <div
              className="absolute top-1/2 -right-2.5 h-0 w-0 -translate-y-1/2 border-y-[7px] border-r-[9px] border-y-transparent min-[400px]:-right-3.5"
              style={{ borderRightColor: cabinet.line }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
