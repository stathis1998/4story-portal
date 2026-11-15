import { SLOT_LETTERS, SLOT_REEL_STOPS, SLOT_REELS, SLOT_ROWS, slotWindow } from '@4story-portal/shared'
import type { SlotGrid, SlotMachine, SlotMachineKey, SlotStops, SlotSymbol } from '@4story-portal/shared'
import type { ReactNode, Ref } from 'react'
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import { blurStepsAt, REEL_BLURS } from '../../lib/reel-blur'
import { planReels, reelsAt, restTimes } from '../../lib/slots'

/** A cascade step as the reels draw it: its grid, how far each tile fell to it, and the tiles it wins, which burst on the way to the next. */
type ReelStep = { grid: SlotGrid; drop: number[][]; burst: [number, number][]; key: string }
type StepTimes = { burst: number; fall: number }

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
  /**
   * When set, the window shows this grid instead of the strips: a cascade step. A new key starts its transition: the
   * step before's `burst` tiles burst, then this grid's tiles fall by their `drop`. A step that follows the strips
   * (step 1) is drawn in place at once. A step already there when the reels are drawn has been shown.
   */
  step?: ReelStep | null
  /** Called once per step key when its tiles have landed. Never after unmount. */
  onStepLanded?: () => void
  /** Seconds for a burst and for a fall; the page halves them for quick spin. */
  stepTimes?: StepTimes
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

const STEP_TIMES: StepTimes = { burst: 0.3, fall: 0.35 }
/** How small a bursting tile has shrunk when it has faded out. */
const BURST_SCALE = 0.4
/** The share of a fall spent reaching the place, ease-in; the rest is a bounce this many rows high. */
const LAND = 0.8
const BOUNCE = 0.08

/**
 * How long each part of the way to `step` takes, in seconds: a burst only when the step before won tiles, a fall only
 * when a tile moves. Both 0 without animation, and for step 1, which follows the strips and is drawn in place.
 */
function stepPhases(from: ReelStep | null, step: ReelStep, animate: boolean, times: StepTimes): StepTimes {
  if (!animate) return { burst: 0, fall: 0 }
  return {
    burst: from !== null && from.burst.length > 0 ? times.burst : 0,
    fall: step.drop.some((rows) => rows.some((rowsFell) => rowsFell > 0)) ? times.fall : 0,
  }
}

/** How many rows above its place a tile that falls `drop` rows is at `progress` (0 to 1) of the fall. */
function rowsAbove(drop: number, progress: number): number {
  if (drop === 0 || progress >= 1) return 0
  if (progress < LAND) return drop * (1 - (progress / LAND) ** 2)
  return BOUNCE * Math.sin((Math.PI * (progress - LAND)) / (1 - LAND))
}

const isIn = (tiles: readonly (readonly [number, number])[], reel: number, row: number) => tiles.some(([r, w]) => r === reel && w === row)

/** One symbol in its frame, a row tall: the strips' tiles and a step's are the same, so a step sits where the strips were. */
function SymbolTile({ symbol, lit, line, ref }: { symbol: SlotSymbol; lit: boolean; line: string; ref?: Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} data-won={lit ? 'true' : undefined} className="flex h-14 items-center justify-center sm:h-19 lg:h-27">
      <div
        className="rounded-xs border p-0.5 transition-[box-shadow,background-color] duration-300 sm:p-1"
        style={
          lit
            ? {
                borderColor: line,
                backgroundColor: `color-mix(in srgb, ${line} 30%, #141010)`,
                boxShadow: `inset 0 0 0 1px ${line}, 0 0 12px ${line}`,
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
}

/** [reel][row] places for tile elements. */
const tileGrid = () => Array.from({ length: SLOT_REELS }, () => new Array<HTMLDivElement | null>(SLOT_ROWS).fill(null))

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
 * on the DOM, frame by frame, so a spin does not re-render React; a cascade step's tiles burst and fall the same way,
 * on the same clock.
 */
export function Reels({
  machine,
  rest,
  spin,
  animate,
  lit,
  stopNow,
  onReelStopped,
  onStopped,
  step = null,
  onStepLanded,
  stepTimes = STEP_TIMES,
  children,
}: ReelsProps) {
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

  // The step shown and the one drawn before it, whose burst tiles go on the way to it: none when the strips were
  // showing. Kept from the props before, in state, so the burst can be drawn in the same render as the new step.
  const stepKey = step?.key ?? null
  const [stepPair, setStepPair] = useState<{ step: ReelStep | null; from: ReelStep | null }>({ step, from: null })
  const stepIsNew = (stepPair.step?.key ?? null) !== stepKey
  if (stepIsNew) setStepPair({ step, from: stepPair.step })
  const from = stepIsNew ? stepPair.step : stepPair.from
  // The step whose tiles have all landed, so the label and the lit symbols can tell it.
  const [landedKey, setLandedKey] = useState<string | null>(stepKey)
  const phases = step === null ? null : stepPhases(from, step, animate, stepTimes)
  const stepMoves = phases !== null && phases.burst + phases.fall > 0
  const stepLanded = step !== null && (landedKey === step.key || !stepMoves)
  const bursting = from !== null && !stepLanded && phases !== null && phases.burst > 0
  // The step's tiles, the layers they sit in, and those of the step before for its burst: moved on the DOM.
  const landing = useRef(tileGrid())
  const landingLayers = useRef<(HTMLDivElement | null)[]>(new Array(SLOT_REELS).fill(null))
  const burstTiles = useRef(tileGrid())
  const burstLayers = useRef<(HTMLDivElement | null)[]>(new Array(SLOT_REELS).fill(null))
  // The step told as landed. React's development mode runs effects twice, and each step lands once.
  const landedTold = useRef(stepKey)
  const tellLanded = useEffectEvent((landedStep: string) => {
    if (landedTold.current === landedStep) return
    landedTold.current = landedStep
    onStepLanded?.()
  })
  // What the step's transition needs, as it is when its key arrives.
  const transition = useEffectEvent(() => ({ step, from, phases }))

  // Before paint, so a new grid is never seen at its place before it falls.
  useLayoutEffect(() => {
    const { step: shown, from: before, phases: times } = transition()
    if (shown === null || times === null) return
    const showLayers = (burst: boolean) => {
      for (const layer of burstLayers.current) if (layer) layer.style.visibility = burst ? '' : 'hidden'
      for (const layer of landingLayers.current) if (layer) layer.style.visibility = burst ? 'hidden' : ''
    }
    const drawFall = (progress: number) =>
      landing.current.forEach((tiles, reel) =>
        tiles.forEach((tile, row) => {
          if (!tile) return
          const rows = rowsAbove(shown.drop[reel][row], progress)
          tile.style.transform = rows === 0 ? '' : `translateY(${-rows * 100}%)`
        }),
      )
    const drawBurst = (progress: number) =>
      burstTiles.current.forEach((tiles, reel) =>
        tiles.forEach((tile, row) => {
          if (!tile) return
          const goes = before !== null && isIn(before.burst, reel, row)
          tile.style.opacity = goes && progress > 0 ? String(1 - progress) : ''
          tile.style.transform = goes && progress > 0 ? `scale(${1 - (1 - BURST_SCALE) * progress})` : ''
        }),
      )
    const land = () => {
      showLayers(false)
      drawFall(1)
    }
    if (landedTold.current === shown.key || times.burst + times.fall === 0) {
      land()
      tellLanded(shown.key)
      return
    }
    showLayers(times.burst > 0)
    drawBurst(0)
    drawFall(0)
    let start: number | null = null
    let request = 0
    const frame = (now: number) => {
      start ??= now
      const seconds = (now - start) / 1000
      if (seconds < times.burst) {
        drawBurst(seconds / times.burst)
        request = requestAnimationFrame(frame)
        return
      }
      if (seconds < times.burst + times.fall) {
        showLayers(false)
        drawFall((seconds - times.burst) / times.fall)
        request = requestAnimationFrame(frame)
        return
      }
      land()
      setLandedKey(shown.key)
      tellLanded(shown.key)
    }
    request = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(request)
  }, [stepKey])

  const atRest = step === null && (spin === null || !animate || restingKey === spin.key)
  const shownStops = spin?.stops ?? rest
  const litTiles = shownStops.map(() => new Set<number>())
  if (atRest) for (const [reel, row] of lit) litTiles[reel]?.add(tileIn(shownStops[reel], row))
  const label = (() => {
    const rowsOf = (grid: SlotGrid) =>
      `Reels: ${ROW_NAMES.map((name, row) => `${name} row ${grid.map((symbols) => machine.symbols[symbols[row]].name).join(', ')}`).join('; ')}`
    if (step !== null) return stepLanded ? rowsOf(step.grid) : 'Reels, tiles falling'
    if (spin === null) return 'Reels'
    if (!atRest) return 'Reels, spinning'
    return rowsOf(slotWindow(machine, spin.stops))
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
              {/* Kept, hidden, under a step, so the next spin starts from where they rest. */}
              <div style={step === null ? undefined : { visibility: 'hidden' }}>
                <div
                  ref={(element) => {
                    strips.current[i] = element
                  }}
                  data-testid={`reel-${i}`}
                  className="will-change-transform"
                >
                  {Array.from({ length: TILES }, (_, n) => (
                    <SymbolTile
                      key={n}
                      symbol={machine.symbols[SLOT_LETTERS.indexOf(reel[n % SLOT_REEL_STOPS])]}
                      lit={litTiles[i].has(n)}
                      line={cabinet.line}
                    />
                  ))}
                </div>
              </div>
              {/*
                A step's grid, its tiles in the rows the strips' three showed, from the top of the window. The step
                before is drawn under it while its tiles burst; the effect shows one layer at a time.
              */}
              {bursting && (
                <div
                  ref={(element) => {
                    burstLayers.current[i] = element
                  }}
                  data-testid={`burst-${i}`}
                  className="absolute inset-x-0 top-0"
                >
                  {from.grid[i].map((symbol, row) => (
                    <SymbolTile
                      key={row}
                      ref={(element) => {
                        burstTiles.current[i][row] = element
                      }}
                      symbol={machine.symbols[symbol]}
                      lit={false}
                      line={cabinet.line}
                    />
                  ))}
                </div>
              )}
              {step !== null && (
                <div
                  ref={(element) => {
                    landingLayers.current[i] = element
                  }}
                  data-testid={`step-${i}`}
                  className="absolute inset-x-0 top-0"
                >
                  {step.grid[i].map((symbol, row) => (
                    <SymbolTile
                      key={row}
                      ref={(element) => {
                        landing.current[i][row] = element
                      }}
                      symbol={machine.symbols[symbol]}
                      lit={stepLanded && isIn(lit, i, row)}
                      line={cabinet.line}
                    />
                  ))}
                </div>
              )}
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
