import { SLOT_REELS, SLOT_SCATTER, slotWindow } from '@4story-portal/shared'
import type { SlotMachine, SlotMachineKey, SlotSpinView, SlotStops } from '@4story-portal/shared'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { roundSpins, winTier, wonTiles } from './slot-round'
import type { RoundSpin, WinTier } from './slot-round'
import { createSlotSounds } from './slot-sounds'
import type { SlotSound, SlotSounds } from './slot-sounds'
import { reelTimes, suspenseReels } from './slots'

// The show of one round: the paid spin's reels and lines, any free spins one after another, then the end. The
// server played the whole round before anything moved; this only decides when each part of it is shown and heard,
// and never shows or sounds a spin before its reels have stopped.

/** Each winning line drawn by itself, in seconds; quick spin halves it. However many lines, they take at most LINES_MAX. */
const LINE_SECONDS = 0.6
const LINES_MAX = 2.4
/** The Win figure counting up a free spin's win, or the paid spin's when free spins follow; quick spin halves it. */
const COUNT_SECONDS = 0.6
/** "8 free spins. Every win is doubled." */
const FREE_START_SECONDS = 2
/** From one free spin's lines to the next free spin. */
const FREE_GAP_SECONDS = 0.4
/** "8 free spins won 3 Gold." */
const FREE_END_SECONDS = 2
/** The end of a round that paid the stake or more: its sound, and the Win figure counting up, for this long. */
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

export type WinBanner = { kind: 'freeStart'; spins: number } | { kind: 'freeEnd'; spins: number; won: number } | { kind: 'big' | 'huge' }

export type RoundShow = {
  /** The machine the reels' spin, lines and figure belong to. */
  machine: SlotMachineKey | null
  /** For Reels: the spin on the reels now. */
  reel: { stops: SlotStops; key: string; times: readonly number[] } | null
  animate: boolean
  lit: [number, number][]
  /** Indexes into SLOT_LINES, drawn over the window. */
  lines: number[]
  /** The Win figure: null until a spin of the round has won, then kept until the next press. */
  win: number | null
  banner: WinBanner | null
  /** "Free spin 3 of 8" while free spins play. */
  free: { spin: number; of: number } | null
  /** Whether "Skip to the total" is offered. */
  skip: boolean
  /** For Reels: a new number stops the turning reels at once. */
  stopNow: number
  /** Where each machine's reels last rested, for coming back to it. */
  ends: Partial<Record<SlotMachineKey, SlotStops>>
}

const IDLE: RoundShow = { machine: null, reel: null, animate: false, lit: [], lines: [], win: null, banner: null, free: null, skip: false, stopNow: 0, ends: {} }

type Round = {
  machine: SlotMachine
  spin: SlotSpinView
  spins: RoundSpin[]
  quick: boolean
  key: number
  /** The spin on the reels: 0 is the paid one. */
  at: number
  /** 'jump' is a round shown at its end at once; 'over' one that has been shown. */
  phase: 'turning' | 'showing' | 'jump' | 'over'
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

const lineIds = (spin: RoundSpin) => spin.outcome.lines.map((win) => win.line)

/**
 * The show of a round on the slots page. `start` it with the answer to a spin; `onDone` runs once the whole round
 * has been shown (or skipped), and never after unmount.
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
  // A spin is cheered only once the round has won its stake back: never for less, and never for what is still to come.
  const cheered = (r: Round, spin: RoundSpin) => spin.total >= r.spin.stake

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
    // Scatters give nothing in a free spin: nothing is waited for, and they land like any symbol.
    const scatterOnReel = at === 0 ? slotWindow(r.machine, spin.stops).map((rows) => rows.includes(SLOT_SCATTER)) : NO_SCATTERS
    const suspense = suspenseReels(scatterOnReel)
    Object.assign(r, {
      at,
      phase: 'turning',
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
      animate: true,
      lit: [],
      lines: [],
      free: at > 0 ? { spin: at, of: r.spins.length - 1 } : null,
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
    r.phase = 'showing'
    r.press = null
    // Skip is offered for the free spins still to come.
    if (r.at > 0 && r.at === r.spins.length - 1) update({ skip: false })
    showLines(r)
  }

  /** The spin's winning lines one at a time, then all together while the Win figure counts up to the round so far. */
  function showLines(r: Round) {
    const spin = r.spins[r.at]
    const wins = spin.outcome.lines
    if (wins.length === 0) return afterLines(r)
    const all = lineIds(spin)
    const chime = cheered(r, spin)
    // A paid spin with nothing after it goes straight to the end of the round, where the figure counts.
    const ending = r.spins.length === 1
    const each = Math.min(LINE_SECONDS * scale(r), LINES_MAX / wins.length)
    const drawLine = (j: number) => {
      update({ lines: [all[j]] })
      if (chime) sounds.play('lineWin', j)
    }
    update({ lit: wonTiles(spin.outcome) })
    drawLine(0)
    for (let j = 1; j < wins.length; j++) clock.after(j * each, () => drawLine(j))
    clock.after(wins.length * each, () => {
      update({ lines: all })
      if (ending) end(r)
      else count(r, spin.total - spin.won, spin.total, chime ? COUNT_SECONDS * scale(r) : 0, () => afterLines(r))
    })
    r.press = () => {
      clock.clear()
      if (ending) return finish(r)
      update({ lines: all, win: spin.total })
      afterLines(r)
    }
  }

  function afterLines(r: Round) {
    const free = r.spins.length - 1
    if (r.at === 0 && free > 0) return freeStart(r)
    if (r.at < free) {
      const next = () => {
        clock.clear()
        turn(r, r.at + 1)
      }
      r.press = next
      clock.after(FREE_GAP_SECONDS, next)
      return
    }
    if (free > 0) return freeEnd(r)
    end(r)
  }

  function freeStart(r: Round) {
    const go = () => {
      clock.clear()
      update({ banner: null })
      turn(r, 1)
    }
    update({ banner: { kind: 'freeStart', spins: r.spins.length - 1 }, skip: true })
    sounds.play('freeStart')
    r.press = go
    clock.after(FREE_START_SECONDS, go)
  }

  function freeEnd(r: Round) {
    const won = r.spin.payout - r.spins[0].won
    update({ banner: { kind: 'freeEnd', spins: r.spins.length - 1, won } })
    // The banner says what the free spins won; its cadence is a cheer, so only for the stake or more.
    if (won >= r.spin.stake) sounds.play('freeEnd')
    // A press ends the round here: all that would follow is a cheer for the total this banner already gives.
    r.press = () => endNow(r)
    clock.after(FREE_END_SECONDS, () => {
      update({ banner: null })
      end(r)
    })
  }

  /** The round's end, as loud as its win against the stake. A win below the stake gets one soft tick and no more. */
  function end(r: Round) {
    const { payout, stake, jackpot } = r.spin
    if (jackpot > 0) {
      sounds.play('jackpot')
      return finish(r)
    }
    const tier = winTier(payout, stake)
    if (tier === 'none') return finish(r)
    sounds.play(TIER_SOUNDS[tier])
    if (tier === 'small') return finish(r)
    if (tier !== 'win') update({ banner: { kind: tier } })
    r.press = () => {
      // The cheer is cut short with the show.
      sounds.stop()
      finish(r)
    }
    // After free spins the figure is already the round's total: the end holds it.
    count(r, r.spins.length > 1 ? payout : 0, payout, CELEBRATION_SECONDS[tier], () => finish(r))
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
    const { payout, stake, jackpot } = r.spin
    const tier = winTier(payout, stake)
    if (jackpot > 0) sounds.play('jackpot')
    else if (tier !== 'none') sounds.play(TIER_SOUNDS[tier])
    finish(r)
  }

  function finish(r: Round) {
    if (round.current !== r) return
    clock.clear()
    quietReels(r)
    r.phase = 'over'
    r.press = null
    round.current = null
    const last = r.spins[r.spins.length - 1]
    change((current) => ({
      ...current,
      banner: null,
      free: null,
      skip: false,
      lit: wonTiles(last.outcome),
      lines: lineIds(last),
      win: r.spin.payout > 0 ? r.spin.payout : null,
      ends: { ...current.ends, [r.machine.key]: last.stops },
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
      scatterOnReel: NO_SCATTERS,
      suspenseFrom: -1,
      scatters: 0,
      turning: false,
      suspense: false,
      stoppedEarly: false,
      press: null,
    }
    round.current = r
    if (motion) return turn(r, 0)
    // The reels jump to the last spin and tell they have stopped; the end is sounded then.
    const at = spins.length - 1
    const last = spins[at]
    r.phase = 'jump'
    r.at = at
    update({
      machine: machine.key,
      reel: { stops: last.stops, key: `${r.key}-${at}`, times: reelTimes(NO_SCATTERS, quick) },
      animate: false,
      lit: wonTiles(last.outcome),
      lines: lineIds(last),
      win: spin.payout > 0 ? spin.payout : null,
      banner: null,
      free: null,
      skip: false,
    })
  }

  /** A press of Spin, or the space bar, while a round shows: it stops the reels, or ends what is showing. */
  function press(): boolean {
    const r = round.current
    r?.press?.()
    // True when this press ended the round.
    return r !== null && round.current !== r
  }

  /** "Skip to the total": the reels on the last free spin and the round over, at once. */
  function skip() {
    const r = round.current
    if (!r || r.phase === 'jump') return
    clock.clear()
    quietReels(r)
    const at = r.spins.length - 1
    // A new key without motion puts the reels straight on the last spin, whatever they were doing.
    update({ reel: { stops: r.spins[at].stops, key: `${r.key}-skip`, times: reelTimes(NO_SCATTERS, r.quick) }, animate: false })
    endNow(r)
  }

  /** The round over without its cheer. A jackpot is still heard: it is above every other moment. */
  function endNow(r: Round) {
    if (r.spin.jackpot > 0) sounds.play('jackpot')
    finish(r)
  }

  /** Puts away what the last round left on the reels: a new press, or another machine. */
  function clear() {
    clock.clear()
    if (round.current) quietReels(round.current)
    round.current = null
    update({ lit: [], lines: [], win: null, banner: null, free: null, skip: false })
  }

  return { show, start, press, skip, clear, onReelStopped, onStopped }
}
