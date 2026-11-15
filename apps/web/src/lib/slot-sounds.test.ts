import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSlotSounds } from './slot-sounds'
import type { SlotSound } from './slot-sounds'

// A stand-in for the browser's sound generator that only records what was asked of it.
type Param = {
  value: number
  setValueAtTime: () => Param
  linearRampToValueAtTime: () => Param
  exponentialRampToValueAtTime: () => Param
  cancelScheduledValues: () => Param
}
function param(): Param {
  const p: Param = {
    value: 0,
    setValueAtTime: () => p,
    linearRampToValueAtTime: () => p,
    exponentialRampToValueAtTime: () => p,
    cancelScheduledValues: () => p,
  }
  return p
}

type FakeNode = {
  frequency: Param
  gain: Param
  Q: Param
  type: string
  loop: boolean
  buffer: unknown
  onended: (() => void) | null
  started: number
  stopped: number
  connect: (to: unknown) => unknown
  disconnect: () => void
  start: () => void
  stop: (when?: number) => void
  end: () => void
}

function fakeContext(opts: { resume?: () => Promise<void>; state?: string } = {}) {
  const started: FakeNode[] = []
  const nodes: FakeNode[] = []
  const calls = { resume: 0 }
  function node(): FakeNode {
    const n: FakeNode = {
      frequency: param(),
      gain: param(),
      Q: param(),
      type: '',
      loop: false,
      buffer: null,
      onended: null,
      started: 0,
      stopped: 0,
      connect: (to) => to,
      disconnect: () => undefined,
      start: () => {
        n.started += 1
        started.push(n)
      },
      // A stop with no time, or at the end of a loop's 0.1 s fade, cuts a sound short; a sound's own scheduled end does not.
      stop: (when?: number) => {
        if (when === undefined || when === 0.1) n.stopped += 1
      },
      end: () => n.onended?.(),
    }
    nodes.push(n)
    return n
  }
  const context = {
    currentTime: 0,
    sampleRate: 8000,
    state: opts.state ?? 'running',
    destination: {},
    createOscillator: node,
    createBufferSource: node,
    createGain: node,
    createBiquadFilter: node,
    createBuffer: (_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) }),
    resume: () => {
      calls.resume += 1
      return opts.resume ? opts.resume() : Promise.resolve()
    },
  }
  return { context: context as unknown as AudioContext, started, nodes, calls }
}

const ALL: SlotSound[] = ['press', 'reelStop', 'scatter', 'lineWin', 'smallWin', 'win', 'bigWin', 'hugeWin', 'count', 'freeStart', 'freeEnd', 'jackpot', 'refused']

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('slot sounds', () => {
  it('makes no sound and no context before the first press', () => {
    const make = vi.fn(() => fakeContext().context)
    const sounds = createSlotSounds(make)
    sounds.play('press')
    sounds.spinning(true)
    sounds.suspense(true)
    expect(make).not.toHaveBeenCalled()
  })

  it('plays after unlock', () => {
    const fake = fakeContext()
    const sounds = createSlotSounds(() => fake.context)
    sounds.unlock()
    sounds.play('reelStop')
    expect(fake.started.length).toBeGreaterThan(0)
  })

  it('creates one context however often it is unlocked', () => {
    const make = vi.fn(() => fakeContext().context)
    const sounds = createSlotSounds(make)
    sounds.unlock()
    sounds.unlock()
    sounds.unlock()
    expect(make).toHaveBeenCalledTimes(1)
  })

  it('resumes a suspended context on unlock', () => {
    const fake = fakeContext({ state: 'suspended' })
    createSlotSounds(() => fake.context).unlock()
    expect(fake.calls.resume).toBe(1)
  })

  it('plays nothing while muted, and remembers the switch', () => {
    const fake = fakeContext()
    const sounds = createSlotSounds(() => fake.context)
    sounds.unlock()
    sounds.setMuted(true)
    sounds.play('win')
    sounds.spinning(true)
    expect(sounds.muted).toBe(true)
    expect(fake.started).toHaveLength(0)
    expect(localStorage.getItem('slots.sound')).toBe('off')
    expect(createSlotSounds(() => fakeContext().context).muted).toBe(true)
    sounds.setMuted(false)
    expect(localStorage.getItem('slots.sound')).toBe('on')
    expect(createSlotSounds(() => fakeContext().context).muted).toBe(false)
  })

  it('starts with sound on when nothing is remembered', () => {
    expect(createSlotSounds(() => fakeContext().context).muted).toBe(false)
  })

  it('stops the turning loop when muted, on stop(), and when told off', () => {
    for (const end of ['mute', 'stop', 'off'] as const) {
      localStorage.clear()
      const fake = fakeContext()
      const sounds = createSlotSounds(() => fake.context)
      sounds.unlock()
      sounds.spinning(true)
      sounds.suspense(true)
      const looping = fake.started.filter((n) => n.stopped === 0)
      expect(looping.length).toBeGreaterThan(0)
      if (end === 'mute') sounds.setMuted(true)
      else if (end === 'stop') sounds.stop()
      else {
        sounds.spinning(false)
        sounds.suspense(false)
      }
      expect(looping.every((n) => n.stopped > 0)).toBe(true)
    }
  })

  it('keeps one turning loop however often it is turned on', () => {
    const fake = fakeContext()
    const sounds = createSlotSounds(() => fake.context)
    sounds.unlock()
    sounds.spinning(true)
    const count = fake.started.length
    sounds.spinning(true)
    expect(fake.started).toHaveLength(count)
  })

  it('stops what is still playing on stop(), and forgets nodes that ended', () => {
    const fake = fakeContext()
    const sounds = createSlotSounds(() => fake.context)
    sounds.unlock()
    sounds.play('jackpot')
    const ended = fake.started[0]
    ended.end()
    sounds.stop()
    expect(ended.stopped).toBe(0)
    expect(fake.started.slice(1).every((n) => n.stopped > 0)).toBe(true)
  })

  it('does nothing, without throwing, when there is no sound generator', () => {
    const sounds = createSlotSounds(() => null)
    expect(() => {
      sounds.unlock()
      for (const name of ALL) sounds.play(name, 2)
      sounds.spinning(true)
      sounds.suspense(true)
      sounds.spinning(false)
      sounds.setMuted(true)
      sounds.stop()
    }).not.toThrow()
  })

  it('finds no generator in a window without one', () => {
    const sounds = createSlotSounds()
    expect(() => {
      sounds.unlock()
      sounds.play('press')
    }).not.toThrow()
  })

  it('does nothing, without throwing, when the context throws or stays suspended', async () => {
    const broken = createSlotSounds(() => {
      throw new Error('no audio')
    })
    expect(() => {
      broken.unlock()
      broken.play('press')
      broken.spinning(true)
    }).not.toThrow()

    const fake = fakeContext({ state: 'suspended', resume: () => Promise.reject(new Error('blocked')) })
    const stuck = createSlotSounds(() => fake.context)
    expect(() => {
      stuck.unlock()
      stuck.play('press')
    }).not.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 10))
    // An unhandled rejection would fail the whole run.
  })

  it('still switches when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const sounds = createSlotSounds(() => fakeContext().context)
    expect(sounds.muted).toBe(false)
    expect(() => sounds.setMuted(true)).not.toThrow()
    expect(sounds.muted).toBe(true)
  })

  it('has a recipe for every sound', () => {
    for (const name of ALL) {
      const fake = fakeContext()
      const sounds = createSlotSounds(() => fake.context)
      sounds.unlock()
      sounds.play(name)
      expect(fake.started.length, name).toBeGreaterThan(0)
    }
  })

  it('keeps a small win to one tick', () => {
    const fake = fakeContext()
    const sounds = createSlotSounds(() => fake.context)
    sounds.unlock()
    sounds.play('smallWin')
    expect(fake.started).toHaveLength(1)
  })

  it('does not let finished sounds pile up', () => {
    const fake = fakeContext()
    const sounds = createSlotSounds(() => fake.context)
    sounds.unlock()
    for (let i = 0; i < 300; i += 1) {
      sounds.play('reelStop')
      for (const n of fake.started) n.end()
    }
    sounds.stop()
    // Everything had ended, so stop() has nothing left to stop.
    expect(fake.started.every((n) => n.stopped === 0)).toBe(true)
  })
})
