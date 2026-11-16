import { SLOT_FREE_MULTIPLIER_MAX, SLOT_FREE_START, SLOT_METER_FREE, SLOT_REELS, SLOT_SCATTER, slotWindow } from '@4story-portal/shared'
import type { SlotGrid, SlotMachine, SlotMachineKey, SlotSpinView, SlotStops } from '@4story-portal/shared'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { jackpotCheered, roundSpins, winTier, wonTiles } from './slot-round'
import type { RoundSpin, ShownStep, WinTier } from './slot-round'
import { createSlotSounds } from './slot-sounds'
import type { SlotSound, SlotSounds } from './slot-sounds'
import { reelTimes, suspenseReels } from './slots'

// The show of one round: the paid spin's reels and its chain step by step, its meter points, any free spins one
// after another with their chains, then the end. The server played the whole round before anything moved; this only
// decides when each part of it is shown and heard, and never shows or sounds a step before it is on the reels.

/** Each winning line drawn by itself, in seconds. However many lines, a step's take at most LINES_MAX. Quick spin halves both. */
const LINE_SECONDS = 0.6
const LINES_MAX = 2.4
/** The Win figure counting up a step's win, once the round has won its stake back; quick spin halves it. */
const COUNT_SECONDS = 0.6
/** The winning tiles bursting, and the tiles falling into their places; quick spin halves both. */
const STEP_SECONDS = { burst: 0.3, fall: 0.35 } as const
/** Before each meter point arrives; quick spin halves it. */
const METER_POINT_SECONDS = 0.25
/** "Meter full: 8 free spins" */
const METER_FULL_SECONDS = 1.5
/** "8 free spins. The multiplier climbs." */
const FREE_START_SECONDS = 2
/** "+5 free spins" */
const RETRIGGER_SECONDS = 1.5
/** From one free spin's chain to the next free spin. */
const FREE_GAP_SECONDS = 0.4
/** "8 free spins won 3 Gold." */
const FREE_END_SECONDS = 2
/** The end of a round that paid the stake or more: its sound, with the Win figure held, for this long. */
const CELEBRATION_SECONDS = { win: 0.8, big: 3, huge: 5 } as const
/** The count's ticks, at most this many a second. */
const TICKS_PER_SECOND = 12
/** The Win figure is drawn again at most this often while it counts, so the page is not drawn on every frame. */
const DRAWS_PER_SECOND = 30
const NO_SCATTERS: readonly boolean[] = new Array<boolean>(SLOT_REELS).fill(false)
const TIER_SOUNDS: Record<Exclude<WinTier, 'none'>, SlotSound> = { small: 'smallWin', win: 'win', big: 'bigWin', huge: 'hugeWin' }

let testSounds: SlotSounds | null = null

/** Tests hand the page a sound engine that records its calls; null puts the real one back. */
export function setSlotSoundsForTest(sounds: SlotSounds | null) {
  testSounds = sounds
}

/** One sound engine for a visit to the page, stopped when the page goes. */
export function useSlotSounds(): SlotSounds {
  const [sounds] = useState(() => testSounds ?? createSlotSounds())
  useEffect(() => () => sounds.stop(), [sounds])
  return sounds
}

/**
 * The sound of the biggest pot a round won: the Giga's, then the Major's, then the Mini's. Null for none, and for pots
 * that won less than the stake: those are a small win.
 */
function potSound(spin: SlotSpinView): SlotSound | null {
  if (!jackpotCheered(spin)) return null
  if (spin.pots.giga > 0) return 'jackpot'
  if (spin.pots.major > 0) return 'jackpotMajor'
  if (spin.pots.mini > 0) return 'jackpotMini'
  // A jackpot the record does not split: the Giga's sound, as the one pot before the three.
  return 'jackpot'
}

/** How loud a round's end is when no pot is cheered: by its win against the stake. Pots below the stake are a small win. */
function endTier(spin: SlotSpinView): WinTier {
  const tier = winTier(spin.payout, spin.stake)
  return tier === 'none' && spin.jackpot > 0 ? 'small' : tier
}

type Clock = { after(seconds: number, run: () => void): void; clear(): void }

/**
 * Runs each task on the first animation frame after its time. Frames, not timeouts, so the show keeps time with the
 * reels: both wait together in a hidden tab, and a test moves both with one clock.
 */
function createClock(): Clock {
  let tasks: { at: number; run: () => void }[] = []
  let frame = 0
  // Cleared tasks must not run, even ones already due in the frame that cleared them.
  let generation = 0
  const tick = () => {
    frame = 0
    const now = performance.now()
    const due = tasks.filter((task) => task.at <= now).sort((a, b) => a.at - b.at)
    tasks = tasks.filter((task) => task.at > now)
    const mine = generation
    for (const task of due) {
      if (generation !== mine) break
      task.run()
    }
    if (tasks.length > 0 && frame === 0) frame = requestAnimationFrame(tick)
  }
  return {
    after(seconds, run) {
      tasks.push({ at: performance.now() + seconds * 1000, run })
      if (frame === 0) frame = requestAnimationFrame(tick)
    },
    clear() {
      generation++
      tasks = []
      if (frame !== 0) cancelAnimationFrame(frame)
      frame = 0
    },
  }
}

export type WinBanner =
  | { kind: 'freeStart'; spins: number }
  | { kind: 'retrigger'; added: number }
  | { kind: 'meterFull' }
  | { kind: 'freeEnd'; spins: number; won: number }
  | { kind: 'big' }
  | { kind: 'huge' }

/** A cascade step as Reels draws it. */
export type ReelStep = { grid: SlotGrid; drop: number[][]; burst: [number, number][]; key: string }

export type RoundShow = {
  /** The machine the reels' spin, lines and figure belong to. */
  machine: SlotMachineKey | null
  /** For Reels: the spin on the reels now. */
  reel: { stops: SlotStops; key: string; times: readonly number[] } | null
  /** For Reels: the chain step on the reels now, over the strips; null while they turn. */
  step: ReelStep | null
  animate: boolean
  /** For Reels: how long a step's burst and fall take. */
  stepTimes: { burst: number; fall: number }
  lit: [number, number][]
  /** Indexes into SLOT_LINES, drawn over the window. */
  lines: number[]
  /** The Win figure: null until a step of the round has won, then kept until the next press. */
  win: number | null
  banner: WinBanner | null
  /** "Free spin 3 of 8" while free spins play. */
  free: { spin: number; of: number } | null
  /** The multiplier on the cabinet: the paid spin's step multiplier, or the free round's climbing one. */
  times: number | null
  /** The meter's points while the round shows them arriving; null when the page shows the meter it has. */
  meter: number | null
  /** Whether "Skip to the total" is offered. */
  skip: boolean
  /** For Reels: a new number stops the turning reels at once. */
  stopNow: number
  /** Where each machine's reels last rested, and the step they ended on, for coming back to it. */
  ends: Partial<Record<SlotMachineKey, { stops: SlotStops; step: ReelStep | null }>>
}

const IDLE: RoundShow = {
  machine: null,
  reel: null,
  step: null,
  animate: false,
  stepTimes: STEP_SECONDS,
  lit: [],
  lines: [],
  win: null,
  banner: null,
  free: null,
  times: null,
  meter: null,
  skip: false,
  stopNow: 0,
  ends: {},
}

type Round = {
  machine: SlotMachine
  spin: SlotSpinView
  spins: RoundSpin[]
  quick: boolean
  key: number
  /** The spin on the reels: 0 is the paid one. */
  at: number
  /** 'jump' is a round shown at its end at once; 'over' one that has been shown. */
  phase: 'turning' | 'chain' | 'between' | 'jump' | 'over'
  /** The step of the spin on the reels, or on its way to them. */
  step: number
  /** A step's tiles are on their way: its lines wait for them to land. */
  landing: boolean
  /** The free spins told so far: the award, and every retrigger shown. */
  planned: number
  /** The free round's multiplier for its next winning step. */
  freeTimes: number
  /** The meter's points as shown. */
  meter: number
  scatterOnReel: readonly boolean[]
  /** The reel that showed the second scatter: the reels after it turn in suspense. -1 for none. */
  suspenseFrom: number
  scatters: number
  turning: boolean
  suspense: boolean
  stoppedEarly: boolean
  /** What a press of Spin does now: it ends what is showing. */
  press: (() => void) | null
}

const lineIds = (step: ShownStep) => step.lines.map((win) => win.line)
const won = (step: ShownStep) => step.lines.length > 0
/** A step's winning tiles stay lit only when nothing falls after them: a chain stopped at its longest. */
const restingLit = (step: ShownStep) => (won(step) ? wonTiles(step) : [])
/** The meter points the paid spin gives: its last window's scatters, unless they won free spins. */
const pointsOf = (r: Round) => (r.spins[0].added === 0 ? r.spins[0].scatters : 0)

/**
 * The show of a round on the slots page. `start` it with the answer to a spin; `onDone` runs once the whole round
 * has been shown, however it ended (by itself, by a press, by Skip, or at once with reduce motion), and never after
 * unmount.
 */
export function useSlotRound(sounds: SlotSounds, onDone: () => void) {
  const [show, setShow] = useState<RoundShow>(IDLE)
  const [clock] = useState(createClock)
  const round = useRef<Round | null>(null)
  const alive = useRef(false)
  const keys = useRef(0)
  const stops = useRef(0)
  const done = useRef(onDone)
  useLayoutEffect(() => {
    done.current = onDone
  })
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      clock.clear()
      round.current = null
    }
  }, [clock])

  const change = (next: (current: RoundShow) => RoundShow) => {
    if (alive.current) setShow(next)
  }
  const update = (patch: Partial<RoundShow>) => change((current) => ({ ...current, ...patch }))
  const scale = (r: Round) => (r.quick ? 0.5 : 1)
  /** A step of the round for Reels. Every key is new for the page's life: the round, the spin, the step, and how it is sent. */
  const reelStep = (r: Round, at: number, j: number, how = ''): ReelStep => {
    const { grid, drop, burst } = r.spins[at].steps[j]
    return { grid, drop, burst, key: `${r.key}-${r.spin.id}-${at}-${j}${how}` }
  }

  function quietSuspense(r: Round) {
    if (!r.suspense) return
    r.suspense = false
    sounds.suspense(false)
  }

  function quietReels(r: Round) {
    quietSuspense(r)
    if (!r.turning) return
    r.turning = false
    sounds.spinning(false)
  }

  function turn(r: Round, at: number) {
    const spin = r.spins[at]
    // Only the paid spin's scatters are waited for: a free spin's land like any symbol, and a retrigger they make is
    // told once its chain has ended.
    const scatterOnReel = at === 0 ? slotWindow(r.machine, spin.stops).map((rows) => rows.includes(SLOT_SCATTER)) : NO_SCATTERS
    const suspense = suspenseReels(scatterOnReel)
    Object.assign(r, {
      at,
      phase: 'turning',
      step: 0,
      landing: false,
      scatterOnReel,
      suspenseFrom: suspense.length > 0 ? suspense[0] - 1 : -1,
      scatters: 0,
      turning: true,
      suspense: false,
      stoppedEarly: false,
    })
    r.press = () => {
      // Once is enough: the reels settle on their stops and say so.
      r.press = null
      r.stoppedEarly = true
      quietSuspense(r)
      update({ stopNow: ++stops.current })
    }
    update({
      machine: r.machine.key,
      reel: { stops: spin.stops, key: `${r.key}-${at}`, times: reelTimes(scatterOnReel, r.quick) },
      step: null,
      animate: true,
      lit: [],
      lines: [],
      free: at > 0 ? { spin: at, of: r.planned } : null,
      // A free spin turns under the multiplier its next win will pay at; the paid spin's comes with its first win.
      times: at > 0 ? r.freeTimes : null,
    })
    sounds.spinning(true)
  }

  function onReelStopped(reel: number) {
    const r = round.current
    if (!r || r.phase !== 'turning') return
    if (r.scatterOnReel[reel]) sounds.play('scatter', r.scatters++)
    else sounds.play('reelStop')
    // Reels stopped at once all land together: nothing is left to wait for.
    if (reel === r.suspenseFrom && !r.stoppedEarly) {
      r.suspense = true
      sounds.suspense(true)
    }
    if (reel === SLOT_REELS - 1) quietSuspense(r)
  }

  function onStopped() {
    const r = round.current
    if (!r) return
    if (r.phase === 'jump') return jumpEnd(r)
    if (r.phase !== 'turning') return
    quietReels(r)
    r.phase = 'chain'
    r.press = null
    // Step 1 is the window the strips stopped on: Reels draws it in place and says it has landed.
    sendStep(r, 0)
  }

  /** Puts step `j` of the spin on the reels: the tiles the step before won burst, and its own fall in. */
  function sendStep(r: Round, j: number) {
    r.step = j
    r.landing = true
    r.press = () => chainEnd(r)
    update({ step: reelStep(r, r.at, j), animate: true, lit: [], lines: [] })
    // The burst is the step before's: its sound comes with its tiles going.
    if (j > 0) sounds.play('burst', j - 1)
  }

  function onStepLanded() {
    const r = round.current
    if (!r || r.phase !== 'chain' || !r.landing) return
    r.landing = false
    showStep(r, r.step)
  }

  /** The step on the reels: its winning lines one at a time, then all together while the Win figure counts up to the round so far. */
  function showStep(r: Round, j: number) {
    const spin = r.spins[r.at]
    const step = spin.steps[j]
    // The free round's multiplier is shown all through it; the paid spin's only with a win.
    if (r.at > 0 || won(step)) update({ times: step.times })
    // A step that wins nothing ends the chain.
    if (!won(step)) return chainEnded(r)
    const all = lineIds(step)
    // A step is cheered only once the round has won its stake back: never for less, and never for what is still to come.
    const chime = step.total >= r.spin.stake
    const each = Math.min(LINE_SECONDS, LINES_MAX / all.length) * scale(r)
    const drawLine = (k: number) => {
      update({ lines: [all[k]] })
      if (chime) sounds.play('lineWin', k)
    }
    update({ lit: wonTiles(step) })
    drawLine(0)
    for (let k = 1; k < all.length; k++) clock.after(k * each, () => drawLine(k))
    clock.after(all.length * each, () => {
      update({ lines: all })
      // A chain stopped at its longest keeps its last burst, but nothing falls after it.
      const next = () => (j === spin.steps.length - 1 ? chainEnded(r) : sendStep(r, j + 1))
      if (chime) return count(r, step.total - step.won, step.total, COUNT_SECONDS * scale(r), next)
      // Below the stake the figure does not count up, but the lines are still held together for as long.
      update({ win: step.total })
      clock.after(COUNT_SECONDS * scale(r), next)
    })
    r.press = () => chainEnd(r)
  }

  /** A press during a chain: its last step on the reels at once, with all its wins added, and the show goes on from there. */
  function chainEnd(r: Round) {
    clock.clear()
    r.landing = false
    const spin = r.spins[r.at]
    const j = spin.steps.length - 1
    const last = spin.steps[j]
    const lastWin = spin.steps.findLast(won)
    update({
      // Without motion Reels lands it at once, from whatever it was doing.
      step: reelStep(r, r.at, j, '-end'),
      animate: false,
      lit: restingLit(last),
      lines: lineIds(last),
      ...(spin.total > 0 ? { win: spin.total } : {}),
      times: r.at > 0 ? last.times : (lastWin?.times ?? null),
    })
    // A paid spin with nothing after it: the press ends the round, as it always has, and a pot it won is still heard.
    if (r.spins.length === 1 && pointsOf(r) === 0) return endNow(r)
    chainEnded(r)
  }

  /** The spin's chain has ended: the paid spin's meter points, a free spin's retrigger, or the next part of the round. */
  function chainEnded(r: Round) {
    r.phase = 'between'
    r.press = null
    const spin = r.spins[r.at]
    if (r.at === 0) return meterPoints(r)
    const lastWin = spin.steps.findLast(won)
    if (lastWin) r.freeTimes = Math.min(lastWin.times + 1, SLOT_FREE_MULTIPLIER_MAX)
    if (spin.added > 0) return retrigger(r, spin.added)
    afterSpin(r)
  }

  /** The paid spin's scatters go into the meter one point at a time, now that its chain has ended. */
  function meterPoints(r: Round) {
    const points = pointsOf(r)
    if (points === 0) return afterMeter(r)
    const target = r.spin.meterBefore + points
    const wait = METER_POINT_SECONDS * scale(r)
    const give = () => {
      r.meter++
      update({ meter: r.meter })
      sounds.play('meterPoint', r.meter)
      clock.after(wait, r.meter < target ? give : () => afterMeter(r))
    }
    r.meter = r.spin.meterBefore
    clock.after(wait, give)
    r.press = () => {
      clock.clear()
      r.meter = target
      update({ meter: r.meter })
      afterMeter(r)
    }
  }

  function afterMeter(r: Round) {
    r.press = null
    if (r.spin.meterFree.length > 0) return meterFull(r)
    if (r.spins.length > 1) return freeStart(r, r.spins[0].added)
    end(r)
  }

  function meterFull(r: Round) {
    const go = () => {
      clock.clear()
      // The meter keeps the points over its size.
      r.meter = Math.max(0, r.meter - r.machine.meterSize)
      update({ banner: null, meter: r.meter })
      freeStart(r, SLOT_METER_FREE)
    }
    update({ banner: { kind: 'meterFull' }, skip: true })
    sounds.play('meterFull')
    r.press = go
    clock.after(METER_FULL_SECONDS, go)
  }

  function freeStart(r: Round, spins: number) {
    r.planned = spins
    r.freeTimes = SLOT_FREE_START
    const go = () => {
      clock.clear()
      update({ banner: null })
      turn(r, 1)
    }
    update({ banner: { kind: 'freeStart', spins }, skip: true, times: r.freeTimes })
    sounds.play('freeStart')
    r.press = go
    clock.after(FREE_START_SECONDS, go)
  }

  /** A free spin whose last window showed three scatters or more: the spins it adds, told only now. */
  function retrigger(r: Round, added: number) {
    r.planned += added
    const go = () => {
      clock.clear()
      update({ banner: null })
      afterSpin(r)
    }
    update({ banner: { kind: 'retrigger', added }, free: { spin: r.at, of: r.planned } })
    sounds.play('retrigger')
    r.press = go
    clock.after(RETRIGGER_SECONDS, go)
  }

  function afterSpin(r: Round) {
    const last = r.spins.length - 1
    if (r.at < last) {
      const next = () => {
        clock.clear()
        turn(r, r.at + 1)
      }
      r.press = next
      clock.after(FREE_GAP_SECONDS, next)
      return
    }
    if (last > 0) return freeEnd(r)
    end(r)
  }

  function freeEnd(r: Round) {
    const won = r.spin.payout - r.spins[0].won
    // Skip is offered up to here: hidden any sooner, it would tell that no retrigger was coming.
    update({ banner: { kind: 'freeEnd', spins: r.spins.length - 1, won }, skip: false })
    // The banner says what the free spins won; its cadence is a cheer, so only for the stake or more.
    if (won >= r.spin.stake) sounds.play('freeEnd')
    // A press ends the round here: all that would follow is a cheer for the total this banner already gives.
    r.press = () => endNow(r)
    clock.after(FREE_END_SECONDS, () => {
      update({ banner: null })
      end(r)
    })
  }

  /** The round's end, as loud as its win against the stake. A win below the stake, pots too, gets one soft tick and no more. */
  function end(r: Round) {
    const pot = potSound(r.spin)
    if (pot) {
      sounds.play(pot)
      return finish(r)
    }
    const tier = endTier(r.spin)
    if (tier === 'none') return finish(r)
    sounds.play(TIER_SOUNDS[tier])
    if (tier === 'small') return finish(r)
    if (tier !== 'win') update({ banner: { kind: tier } })
    r.press = () => {
      // The cheer is cut short with the show.
      sounds.stop()
      finish(r)
    }
    // The steps have already counted the figure up to the round's total: the end holds it.
    clock.after(CELEBRATION_SECONDS[tier], () => finish(r))
  }

  /** The Win figure from `from` to `to` over `seconds`, ticking while it moves. */
  function count(r: Round, from: number, to: number, seconds: number, then: () => void) {
    const began = performance.now()
    let drawn = -Infinity
    let ticked = -Infinity
    let shown = from
    let tickedAt = from
    update({ win: from })
    const step = () => {
      if (round.current !== r) return
      const t = (performance.now() - began) / 1000
      if (seconds <= 0 || t >= seconds) {
        update({ win: to })
        return then()
      }
      const value = Math.floor(from + ((to - from) * t) / seconds)
      if (value !== shown && t - drawn >= 1 / DRAWS_PER_SECOND) {
        shown = value
        drawn = t
        update({ win: value })
      }
      if (value !== tickedAt && t - ticked >= 1 / TICKS_PER_SECOND) {
        tickedAt = value
        ticked = t
        sounds.play('count')
      }
      clock.after(0, step)
    }
    step()
  }

  /** Reduce motion: the round was put at its end at once, and it gets one sound. */
  function jumpEnd(r: Round) {
    const tier = endTier(r.spin)
    const pot = potSound(r.spin)
    if (pot) sounds.play(pot)
    else if (tier !== 'none') sounds.play(TIER_SOUNDS[tier])
    finish(r)
  }

  /** The only way a round ends: `onDone` runs here, once. */
  function finish(r: Round) {
    if (round.current !== r) return
    clock.clear()
    quietReels(r)
    r.phase = 'over'
    r.press = null
    r.landing = false
    round.current = null
    const last = r.spins[r.spins.length - 1]
    const lastStep = last.steps[last.steps.length - 1]
    change((current) => ({
      ...current,
      banner: null,
      free: null,
      skip: false,
      times: null,
      meter: null,
      lit: restingLit(lastStep),
      lines: lineIds(lastStep),
      win: r.spin.payout > 0 ? r.spin.payout : null,
      ends: { ...current.ends, [r.machine.key]: { stops: last.stops, step: current.step } },
    }))
    if (alive.current) done.current()
  }

  /** Shows the round that just came back, from its paid spin; with `motion` off, at its end at once. */
  function start(machine: SlotMachine, spin: SlotSpinView, { quick, motion }: { quick: boolean; motion: boolean }) {
    if (!alive.current) return
    clock.clear()
    const spins = roundSpins(machine, spin)
    const r: Round = {
      machine,
      spin,
      spins,
      quick,
      key: ++keys.current,
      at: 0,
      phase: 'turning',
      step: 0,
      landing: false,
      planned: 0,
      freeTimes: SLOT_FREE_START,
      meter: spin.meterBefore,
      scatterOnReel: NO_SCATTERS,
      suspenseFrom: -1,
      scatters: 0,
      turning: false,
      suspense: false,
      stoppedEarly: false,
      press: null,
    }
    round.current = r
    const scaled = quick ? 0.5 : 1
    update({ stepTimes: { burst: STEP_SECONDS.burst * scaled, fall: STEP_SECONDS.fall * scaled } })
    if (motion) return turn(r, 0)
    // The reels jump to the last spin's last step and tell they have stopped; the end is sounded then.
    const at = spins.length - 1
    const last = spins[at]
    const lastStep = last.steps[last.steps.length - 1]
    r.phase = 'jump'
    r.at = at
    update({
      machine: machine.key,
      reel: { stops: last.stops, key: `${r.key}-${at}`, times: reelTimes(NO_SCATTERS, quick) },
      step: reelStep(r, at, last.steps.length - 1, '-jump'),
      animate: false,
      lit: restingLit(lastStep),
      lines: lineIds(lastStep),
      win: spin.payout > 0 ? spin.payout : null,
      banner: null,
      free: null,
      times: null,
      meter: null,
      skip: false,
    })
  }

  /** A press of Spin, or the space bar, while a round shows: it stops the reels, or ends what is showing. */
  function press() {
    round.current?.press?.()
  }

  /** "Skip to the total": the reels on the last free spin's last step and the round over, at once. */
  function skip() {
    const r = round.current
    if (!r || r.phase === 'jump') return
    clock.clear()
    quietReels(r)
    const at = r.spins.length - 1
    const last = r.spins[at]
    // A new key without motion puts the reels straight on the last spin, whatever they were doing.
    update({
      reel: { stops: last.stops, key: `${r.key}-skip`, times: reelTimes(NO_SCATTERS, r.quick) },
      step: reelStep(r, at, last.steps.length - 1, '-skip'),
      animate: false,
    })
    endNow(r)
  }

  /** The round over without its cheer. A jackpot of the stake or more is still heard: it is above every other moment. Pots below the stake get the small win's tick. */
  function endNow(r: Round) {
    const pot = potSound(r.spin)
    if (pot) sounds.play(pot)
    else if (r.spin.jackpot > 0) sounds.play(TIER_SOUNDS.small)
    finish(r)
  }

  /** Puts away what the last round left on the reels: a new press, or another machine. */
  function clear() {
    clock.clear()
    if (round.current) quietReels(round.current)
    round.current = null
    update({ lit: [], lines: [], win: null, banner: null, free: null, times: null, meter: null, skip: false })
  }

  return { show, start, press, skip, clear, onReelStopped, onStopped, onStepLanded }
}
