// The slots' sound, made in the browser with Web Audio: oscillators and short noise bursts, no files. Every
// sound has its own small recipe below, so one can be retuned without reading the others.

export type SlotSound =
  | 'press' | 'reelStop' | 'scatter' | 'lineWin' | 'smallWin' | 'win' | 'bigWin' | 'hugeWin'
  | 'count' | 'freeStart' | 'freeEnd' | 'jackpot' | 'refused'

export type SlotSounds = {
  /**
   * Does nothing until unlock() has run, while muted, without a sound generator, or while the generator is not
   * running (a hidden tab, a phone call), so nothing piles up to sound all at once later. `step` raises the pitch
   * (the nth scatter, the nth line).
   */
  play(sound: SlotSound, step?: number): void
  /** The turning reels: a loop that runs while on. */
  spinning(on: boolean): void
  /** The rising sound while free spins are still possible. */
  suspense(on: boolean): void
  /** Call from the player's first press. Safe to call on every press. */
  unlock(): void
  readonly muted: boolean
  /** Remembered in the browser under 'slots.sound' ('off' or 'on'). Muting stops both loops, and silences what is playing, at once. */
  setMuted(muted: boolean): void
  /** The page went out of sight, or came back: the sound pauses and goes on with the show, which waits too. */
  setHidden(hidden: boolean): void
  /** Stops both loops and anything scheduled. For unmount and for leaving the page. */
  stop(): void
}

const STORAGE_KEY = 'slots.sound'
/** Modest, so a jackpot never startles. */
const MASTER_GAIN = 0.25

/** The generator the browser has, if any. Only looked at when the player first presses. */
function browserContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
  const Ctor = w.AudioContext ?? w.webkitAudioContext
  return Ctor ? new Ctor() : null
}

function remembersOff(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'off'
  } catch {
    return false
  }
}

function remember(muted: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, muted ? 'off' : 'on')
  } catch {
    // Storage is blocked: the switch still holds for this visit.
  }
}

/** Semitones of a major scale, so climbing steps sound like a tune and not a siren. */
const SCALE = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16]
/** Frequency ratio for the nth step up the scale; the last step repeats. */
function climb(step: number): number {
  const index = Math.max(0, Math.min(SCALE.length - 1, Math.floor(step)))
  return 2 ** (SCALE[index] / 12)
}

/** Note frequencies (Hz) used by the phrases. */
const C5 = 523.25
const E5 = 659.25
const G5 = 783.99
const C6 = 1046.5
const E6 = 1318.5
const G6 = 1568

/** What a recipe draws with: tones and noise bursts placed `at` seconds from now on the audio clock. */
type Voice = {
  tone(freq: number, at: number, length: number, opts?: { type?: OscillatorType; peak?: number; to?: number }): void
  noise(at: number, length: number, opts?: { peak?: number; freq?: number }): void
}

type Recipe = (v: Voice, step: number) => void

// Each recipe lists its notes. Times are seconds, peaks are 0 to 1 before the master gain.

const press: Recipe = (v) => v.noise(0, 0.03, { peak: 0.5, freq: 3000 })

const reelStop: Recipe = (v) => {
  v.tone(110, 0, 0.14, { type: 'sine', peak: 0.7, to: 55 })
  v.noise(0, 0.05, { peak: 0.3, freq: 500 })
}

const scatter: Recipe = (v, step) => {
  const base = C6 * climb(step)
  v.tone(base, 0, 0.35, { type: 'sine', peak: 0.45 })
  v.tone(base * 2, 0, 0.2, { type: 'sine', peak: 0.15 })
}

const lineWin: Recipe = (v, step) => {
  const base = C5 * climb(step)
  v.tone(base, 0, 0.22, { type: 'triangle', peak: 0.4 })
  v.tone(base * 1.5, 0.05, 0.2, { type: 'sine', peak: 0.2 })
}

/** A win under the stake: one soft tick, not a celebration. */
const smallWin: Recipe = (v) => v.tone(880, 0, 0.05, { type: 'sine', peak: 0.25 })

const win: Recipe = (v) => {
  v.tone(C5, 0, 0.16, { type: 'triangle', peak: 0.4 })
  v.tone(E5, 0.1, 0.16, { type: 'triangle', peak: 0.4 })
  v.tone(G5, 0.2, 0.3, { type: 'triangle', peak: 0.4 })
}

/** Called many times in a row while the Win figure counts: one very short blip. */
const count: Recipe = (v) => v.tone(1200, 0, 0.02, { type: 'square', peak: 0.12 })

const bigWin: Recipe = (v) => {
  const notes = [C5, E5, G5, C6, G5, C6, E6]
  notes.forEach((f, i) => {
    v.tone(f, i * 0.14, 0.3, { type: 'sawtooth', peak: 0.22 })
    v.tone(f * 2, i * 0.14, 0.2, { type: 'sine', peak: 0.12 })
  })
  v.tone(C6, 1, 0.9, { type: 'triangle', peak: 0.3 })
  v.tone(E6, 1, 0.9, { type: 'triangle', peak: 0.25 })
  v.tone(G6, 1, 0.9, { type: 'triangle', peak: 0.2 })
}

/** Bigger than bigWin: more notes, a drum under them, and a long chord. */
const hugeWin: Recipe = (v) => {
  const notes = [C5, E5, G5, C6, E6, G6, E6, G6, C6 * 2]
  notes.forEach((f, i) => {
    v.tone(f, i * 0.11, 0.3, { type: 'sawtooth', peak: 0.22 })
    v.tone(f * 2, i * 0.11, 0.2, { type: 'sine', peak: 0.12 })
    if (i % 2 === 0) v.tone(80, i * 0.11, 0.12, { type: 'sine', peak: 0.6, to: 45 })
  })
  for (const f of [C5, G5, C6, E6, G6]) v.tone(f, 1.05, 0.95, { type: 'triangle', peak: 0.22 })
  v.noise(1.05, 0.3, { peak: 0.25, freq: 6000 })
}

const freeStart: Recipe = (v) => {
  const notes = [G5, C6, E6, G6, E6, G6]
  notes.forEach((f, i) => v.tone(f, i * 0.12, 0.28, { type: 'triangle', peak: 0.35 }))
  v.tone(C6, 0.75, 0.9, { type: 'sine', peak: 0.3 })
  v.tone(G6, 0.75, 0.9, { type: 'sine', peak: 0.2 })
}

const freeEnd: Recipe = (v) => {
  v.tone(G5, 0, 0.2, { type: 'triangle', peak: 0.35 })
  v.tone(E5, 0.15, 0.2, { type: 'triangle', peak: 0.35 })
  v.tone(C5, 0.3, 0.5, { type: 'triangle', peak: 0.4 })
}

/** The biggest sound of all: a rising run, a long bright chord and a shimmer. */
const jackpot: Recipe = (v) => {
  for (let i = 0; i < 12; i += 1) {
    v.tone(C5 * 2 ** (SCALE[i % SCALE.length] / 12) * (i >= 7 ? 2 : 1), i * 0.07, 0.22, { type: 'sawtooth', peak: 0.2 })
  }
  for (const f of [C5, E5, G5, C6, E6, G6]) v.tone(f, 0.9, 1.1, { type: 'triangle', peak: 0.2 })
  v.tone(65, 0.9, 0.6, { type: 'sine', peak: 0.7, to: 40 })
  for (let i = 0; i < 8; i += 1) v.tone(E6 * 2, 1 + i * 0.1, 0.12, { type: 'sine', peak: 0.1 })
  v.noise(0.9, 0.4, { peak: 0.3, freq: 5000 })
}

/** A spin that was refused: dull, low and short. */
const refused: Recipe = (v) => {
  v.tone(130, 0, 0.2, { type: 'square', peak: 0.25, to: 90 })
  v.tone(98, 0.12, 0.25, { type: 'square', peak: 0.25, to: 70 })
}

const RECIPES: Record<SlotSound, Recipe> = {
  press, reelStop, scatter, lineWin, smallWin, win, bigWin, hugeWin, count, freeStart, freeEnd, jackpot, refused,
}

/** A loop that can be ended: its source and the gain it fades through. */
type Loop = { source: AudioScheduledSourceNode; gain: GainNode }

export function createSlotSounds(make: () => AudioContext | null = browserContext): SlotSounds {
  let muted = remembersOff()
  let context: AudioContext | null = null
  let master: GainNode | null = null
  let noiseBuffer: AudioBuffer | null = null
  let tried = false
  // Everything started and not yet ended, so stop() can end it. Each node leaves when it ends.
  const playing = new Set<AudioScheduledSourceNode>()
  let turning: Loop | null = null
  let rising: Loop | null = null
  let wantTurning = false
  let wantRising = false
  // Set while a resume that unlock() started is pending: what the press asks for meanwhile plays once it is done.
  let unlocking = 0
  let resumes = 0

  function track(source: AudioScheduledSourceNode, ...others: AudioNode[]) {
    playing.add(source)
    source.onended = () => {
      playing.delete(source)
      try {
        source.disconnect()
        for (const node of others) node.disconnect()
      } catch {
        // Already disconnected.
      }
    }
  }

  function makeNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const length = Math.max(1, Math.floor(ctx.sampleRate * 0.5))
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1
    return buffer
  }

  function voice(ctx: AudioContext, out: AudioNode): Voice {
    return {
      tone(freq, at, length, opts = {}) {
        const t = ctx.currentTime + at
        const osc = ctx.createOscillator()
        const env = ctx.createGain()
        osc.type = opts.type ?? 'sine'
        osc.frequency.setValueAtTime(freq, t)
        if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, t + length)
        env.gain.setValueAtTime(0.0001, t)
        env.gain.linearRampToValueAtTime(opts.peak ?? 0.3, t + 0.006)
        env.gain.exponentialRampToValueAtTime(0.0001, t + length)
        osc.connect(env)
        env.connect(out)
        track(osc, env)
        osc.start(t)
        osc.stop(t + length + 0.02)
      },
      noise(at, length, opts = {}) {
        if (!noiseBuffer) return
        const t = ctx.currentTime + at
        const src = ctx.createBufferSource()
        const filter = ctx.createBiquadFilter()
        const env = ctx.createGain()
        src.buffer = noiseBuffer
        filter.type = 'lowpass'
        filter.frequency.setValueAtTime(opts.freq ?? 2000, t)
        env.gain.setValueAtTime(opts.peak ?? 0.3, t)
        env.gain.exponentialRampToValueAtTime(0.0001, t + length)
        src.connect(filter)
        filter.connect(env)
        env.connect(out)
        track(src, filter, env)
        src.start(t)
        src.stop(t + length + 0.02)
      },
    }
  }

  /** The turning reels: a quiet, low, slow tick, from a short generated buffer that loops. */
  function startTurning(ctx: AudioContext, out: AudioNode): Loop | null {
    const length = Math.floor(ctx.sampleRate * 0.36)
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (const at of [0, 0.18]) {
      const from = Math.floor(at * ctx.sampleRate)
      const tick = Math.floor(0.03 * ctx.sampleRate)
      for (let i = 0; i < tick && from + i < length; i += 1) data[from + i] = (Math.random() * 2 - 1) * (1 - i / tick)
    }
    const source = ctx.createBufferSource()
    const filter = ctx.createBiquadFilter()
    const gain = ctx.createGain()
    source.buffer = buffer
    source.loop = true
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(700, ctx.currentTime)
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.linearRampToValueAtTime(0.35, ctx.currentTime + 0.1)
    source.connect(filter)
    filter.connect(gain)
    gain.connect(out)
    track(source, filter, gain)
    source.start()
    return { source, gain }
  }

  /** The rising tone: it climbs for a few seconds and then holds. */
  function startRising(ctx: AudioContext, out: AudioNode): Loop | null {
    const source = ctx.createOscillator()
    const gain = ctx.createGain()
    const t = ctx.currentTime
    source.type = 'triangle'
    source.frequency.setValueAtTime(260, t)
    source.frequency.exponentialRampToValueAtTime(1040, t + 4)
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.linearRampToValueAtTime(0.2, t + 0.3)
    source.connect(gain)
    gain.connect(out)
    track(source, gain)
    source.start(t)
    return { source, gain }
  }

  function endLoop(loop: Loop | null) {
    if (!loop || !context) return
    try {
      const t = context.currentTime
      loop.gain.gain.cancelScheduledValues(t)
      loop.gain.gain.setValueAtTime(loop.gain.gain.value, t)
      loop.gain.gain.linearRampToValueAtTime(0.0001, t + 0.08)
      loop.source.stop(t + 0.1)
    } catch {
      // Already ended.
    }
  }

  function endTurning() {
    endLoop(turning)
    turning = null
  }
  function endRising() {
    endLoop(rising)
    rising = null
  }

  /** The context, once the player has pressed and while it runs. Null while locked, paused, or without a generator. */
  function ready(): { ctx: AudioContext; out: AudioNode } | null {
    if (!context || !master) return null
    return context.state === 'running' || unlocking !== 0 ? { ctx: context, out: master } : null
  }

  function refreshLoopsQuietly() {
    try {
      refreshLoops()
    } catch {
      // A broken generator stays silent.
    }
  }

  /** The master volume: none while muted. */
  function setVolume() {
    if (!context || !master) return
    try {
      master.gain.cancelScheduledValues(context.currentTime)
      master.gain.setValueAtTime(muted ? 0 : MASTER_GAIN, context.currentTime)
    } catch {
      // Silent.
    }
  }

  function refreshLoops() {
    const r = ready()
    if (!r || muted) return
    if (wantTurning && !turning) turning = startTurning(r.ctx, r.out)
    if (wantRising && !rising) rising = startRising(r.ctx, r.out)
  }

  return {
    get muted() {
      return muted
    },
    unlock() {
      if (!tried) {
        tried = true
        try {
          const ctx = make()
          if (ctx) {
            const out = ctx.createGain()
            out.gain.setValueAtTime(muted ? 0 : MASTER_GAIN, ctx.currentTime)
            out.connect(ctx.destination)
            noiseBuffer = makeNoiseBuffer(ctx)
            master = out
            context = ctx
          }
        } catch {
          context = null
          master = null
        }
      }
      if (context && context.state === 'suspended') {
        const mine = ++resumes
        const settled = () => {
          if (unlocking === mine) unlocking = 0
        }
        try {
          unlocking = mine
          // A browser may refuse; the next press tries again.
          context.resume().then(settled, settled)
        } catch {
          settled()
        }
      }
      refreshLoopsQuietly()
    },
    play(sound, step = 0) {
      const r = ready()
      if (!r || muted) return
      try {
        RECIPES[sound](voice(r.ctx, r.out), step)
      } catch {
        // A broken generator stays silent.
      }
    },
    spinning(on) {
      wantTurning = on
      if (!on) return endTurning()
      refreshLoopsQuietly()
    },
    suspense(on) {
      wantRising = on
      if (!on) return endRising()
      refreshLoopsQuietly()
    },
    setMuted(value) {
      muted = value
      remember(value)
      // A cheer already playing is cut at once too.
      setVolume()
      if (value) {
        endTurning()
        endRising()
      } else refreshLoopsQuietly()
    },
    setHidden(hidden) {
      const ctx = context
      if (!ctx) return
      try {
        if (hidden) {
          // Hidden wins over a press's resume still on its way.
          unlocking = 0
          ctx.suspend().catch(() => undefined)
        } else {
          // A loop the show asked for while the sound was paused starts once it runs again.
          ctx.resume().then(refreshLoopsQuietly, () => undefined)
        }
      } catch {
        // A browser that refuses keeps the sound as it was.
      }
    },
    stop() {
      wantTurning = false
      wantRising = false
      endTurning()
      endRising()
      for (const source of [...playing]) {
        try {
          source.stop()
        } catch {
          // Already ended.
        }
      }
      playing.clear()
    },
  }
}
