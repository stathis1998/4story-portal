import { SLOT_LETTERS, SLOT_REEL_STOPS, SLOT_REELS, slotWindow } from '@4story-portal/shared'
import type { SlotMachine, SlotMachineKey, SlotStops } from '@4story-portal/shared'
import type { ReactNode } from 'react'
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import { blurStepsAt, REEL_BLURS } from '../../lib/reel-blur'
import { planReels, reelsAt, restTimes } from '../../lib/slots'

type ReelsProps = {
  machine: SlotMachine
  /** The stops showing when the reels are first drawn. Another machine needs a new Reels (a new React key). */
  rest: SlotStops
  /**
   * A new key starts a spin from the stops showing to `stops`, each reel resting at its time in `times`. A spin
   * already there when the reels are drawn has been shown.
   */
  spin: { stops: SlotStops; key: string; times: readonly number[] } | null
  /** False shows the result at once. */
  animate: boolean
  /** Tiles to light as [reel, row]; drawn only while the reels are at rest. */
  lit: readonly (readonly [number, number])[]
  /** A changed number stops turning reels at once on their stops. */
  stopNow: number
  /** Once per reel per spin, in reel order, as each comes to rest. */
  onReelStopped: (reel: number) => void
  /** Once per spin, after the last reel. Never after unmount. */
  onStopped: () => void
  /** Drawn over the window: win lines, banners. */
  children?: ReactNode
}

/** Tiles in a strip: one loop of the reel and the first few again, so the three rows are always full. */
const TILES = SLOT_REEL_STOPS + 4
const ROW_NAMES = ['top', 'middle', 'bottom']
const SHARP = new Array<number>(SLOT_REELS).fill(0)

/** Each machine's cabinet: its frame, the inside behind the reels, and the colour of the win lines and lit symbols. */
const CABINETS: Record<SlotMachineKey, { frame: string; inside: string; line: string }> = {
  // An alchemist's green glass.
  shelf: { frame: 'linear-gradient(160deg, #2f8a78, #123d35 70%)', inside: '#08201c', line: '#7ef0d2' },
  // Blued steel.
  armoury: { frame: 'linear-gradient(160deg, #5a6f8c, #1c2533 70%)', inside: '#0b1119', line: '#b4d0f5' },
  // Old gold.
  hoard: { frame: 'linear-gradient(160deg, #b08427, #45300b 70%)', inside: '#1c1305', line: '#ffd36b' },
}

/** The colour a machine draws its win lines and lit symbols in, for WinLines over its window. */
// Beside the cabinets it reads from; a hot reload of this file reloads the page.
// eslint-disable-next-line react-refresh/only-export-components
export function cabinetLine(key: SlotMachineKey): string {
  return CABINETS[key].line
}

/** Where a reel resting on `stop` is: the position whose stop on the middle row is `stop` (see reelStop in lib/slots). */
const restingAt = (stop: number) => (SLOT_REEL_STOPS - stop) % SLOT_REEL_STOPS

/**
 * How far a reel's strip is moved down, in rows, at `position`: tile n is drawn in row `offset + n`, and row 1 is the
 * middle row. A growing position moves it down, and at rest on stop s tile s (or s + 32) is in the middle, with the
 * strip's letter before it above and the one after it below, as slotWindow reads them.
 */
const stripOffset = (position: number) => (((position % SLOT_REEL_STOPS) + SLOT_REEL_STOPS + 1) % SLOT_REEL_STOPS) - SLOT_REEL_STOPS

/** The tile in `row` (0 top, 1 middle, 2 bottom) for a reel resting on `stop`. */
const tileIn = (stop: number, row: number) => row - stripOffset(restingAt(stop))

/** Moves each strip to its position, blurred along its run by `blurs` (a step from blurStep, 0 for sharp). */
function draw(strips: (HTMLDivElement | null)[], positions: number[], blurs: number[]) {
  strips.forEach((strip, i) => {
    if (!strip) return
    strip.style.transform = `translateY(${(stripOffset(positions[i]) / TILES) * 100}%)`
    strip.style.filter = blurs[i] > 0 ? `url(#${REEL_BLURS[blurs[i] - 1].id})` : ''
  })
}

/**
 * The cabinet: five reels of the machine's icons behind a window three symbols tall. The strips are moved straight
 * on the DOM, frame by frame, so a spin does not re-render React.
 */
export function Reels({ machine, rest, spin, animate, lit, stopNow, onReelStopped, onStopped, children }: ReelsProps) {
  const strips = useRef<(HTMLDivElement | null)[]>(new Array(SLOT_REELS).fill(null))
  // The stops at rest, where the next spin starts from.
  const showing = useRef<SlotStops>(spin?.stops ?? rest)
  // The spin whose reels have all come to rest, so the label and the lit symbols can tell it.
  const [restingKey, setRestingKey] = useState<string | null>(spin?.key ?? null)
  // What has been told of the latest spin: how many reels, and whether the spin. React's development mode runs
  // effects twice, and each reel stops once.
  const reported = useRef({ key: spin?.key ?? null, reels: spin ? SLOT_REELS : 0, done: spin !== null })
  const tell = useEffectEvent((spinKey: string, reels: number) => {
    if (reported.current.key !== spinKey) reported.current = { key: spinKey, reels: 0, done: false }
    const told = reported.current
    while (told.reels < reels) onReelStopped(told.reels++)
    if (told.reels === SLOT_REELS && !told.done) {
      told.done = true
      onStopped()
    }
  })
  // The spin turning now, if any, to stop at once.
  const turning = useRef<{ stop: () => void } | null>(null)

  useLayoutEffect(() => {
    draw(strips.current, showing.current.map(restingAt), SHARP)
  }, [])

  // Before the spin's own effect, so a change seen with a new spin stops only the one before it.
  const seenStop = useRef(stopNow)
  useEffect(() => {
    if (stopNow === seenStop.current) return
    seenStop.current = stopNow
    turning.current?.stop()
  }, [stopNow])

  const key = spin?.key
  const stops = spin?.stops
  const times = spin?.times
  useEffect(() => {
    if (key === undefined || stops === undefined || times === undefined) return
    if (reported.current.key === key && reported.current.done) return
    const finish = () => {
      showing.current = stops
      draw(strips.current, stops.map(restingAt), SHARP)
    }
    if (!animate) {
      finish()
      tell(key, SLOT_REELS)
      return
    }
    const plan = planReels(showing.current, stops, times)
    let start: number | null = null
    let stopping = false
    let stopAt = Infinity
    let request = 0
    const self = { stop: () => (stopping = true) }
    turning.current = self
    const step = (now: number) => {
      start ??= now
      const seconds = (now - start) / 1000
      if (stopping && stopAt === Infinity) stopAt = seconds
      const stopped = stopAt !== Infinity
      const rests = restTimes(plan, stopAt)
      // Reels at rest, from the left. One stopped at once is told only when its settle has ended, as it lands.
      const resting = rests.findIndex((time) => time > seconds)
      if (seconds < Math.max(...rests)) {
        // A reel settling after a stop at once moves too slowly to blur.
        const blurs = blurStepsAt(plan, seconds).map((blur, i) => (stopped && plan.times[i] > stopAt ? 0 : blur))
        draw(strips.current, reelsAt(plan, seconds, stopAt), blurs)
        tell(key, resting < 0 ? SLOT_REELS : resting)
        request = requestAnimationFrame(step)
        return
      }
      finish()
      turning.current = null
      setRestingKey(key)
      tell(key, SLOT_REELS)
    }
    request = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(request)
      if (turning.current === self) turning.current = null
    }
    // A spin is started by its key alone: a new `animate` mid-spin must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const atRest = spin === null || !animate || restingKey === spin.key
  const shownStops = spin?.stops ?? rest
  const litTiles = shownStops.map(() => new Set<number>())
  if (atRest) for (const [reel, row] of lit) litTiles[reel]?.add(tileIn(shownStops[reel], row))
  const label = (() => {
    if (spin === null) return 'Reels'
    if (!atRest) return 'Reels, spinning'
    const showingNow = slotWindow(machine, spin.stops)
    const rows = ROW_NAMES.map((name, row) => `${name} row ${showingNow.map((symbols) => machine.symbols[symbols[row]].name).join(', ')}`)
    return `Reels: ${rows.join('; ')}`
  })()
  const cabinet = CABINETS[machine.key]

  return (
    <div
      role="img"
      aria-label={label}
      // On a phone the frame is thinner, so five reels fit and Spin is on the first screen.
      className="mx-auto w-fit rounded-md border border-black/60 p-1 shadow-[0_6px_20px_rgb(0_0_0/0.5)] sm:p-3.5"
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
        className="rounded-sm border border-black/70 px-2 py-1 shadow-[inset_0_2px_10px_rgb(0_0_0/0.8)] sm:px-4 sm:py-1.5"
        style={{ backgroundColor: cabinet.inside }}
      >
        <div className="relative flex gap-1 sm:gap-2">
          {machine.reels.map((reel, i) => (
            <div key={i} className="relative h-42 w-14 overflow-hidden rounded-xs bg-black/40 sm:h-57 sm:w-19 lg:h-81 lg:w-27">
              <div
                ref={(element) => {
                  strips.current[i] = element
                }}
                data-testid={`reel-${i}`}
                className="will-change-transform"
              >
                {Array.from({ length: TILES }, (_, n) => {
                  const symbol = machine.symbols[SLOT_LETTERS.indexOf(reel[n % SLOT_REEL_STOPS])]
                  const isLit = litTiles[i].has(n)
                  return (
                    <div key={n} data-won={isLit ? 'true' : undefined} className="flex h-14 items-center justify-center sm:h-19 lg:h-27">
                      <div
                        className="rounded-xs border p-0.5 transition-[box-shadow,background-color] duration-300 sm:p-1"
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
                          className="block h-12 w-12 select-none [image-rendering:pixelated] sm:h-16 sm:w-16 lg:h-24 lg:w-24"
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
          {/* The rows above and below the middle are shaded a little, so the window reads as three rows. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{ background: 'linear-gradient(to bottom, rgb(0 0 0 / 0.55), rgb(0 0 0 / 0.1) 33.4%, transparent 33.4%, transparent 66.6%, rgb(0 0 0 / 0.1) 66.6%, rgb(0 0 0 / 0.55))' }}
          />
          {/*
            What is drawn over the window. It reaches half a gap past the outer reels, so each reel with its share of
            the gaps is exactly a fifth of it and a tile's middle is at (reel + 0.5) fifths: what WinLines draws to.
          */}
          {children !== undefined && <div className="absolute inset-y-0 -inset-x-0.5 sm:-inset-x-1">{children}</div>}
        </div>
      </div>
    </div>
  )
}
