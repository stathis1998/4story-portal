import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSlotSounds } from './slot-sounds'
import type { SlotSound } from './slot-sounds'

// A stand-in for the browser's sound generator that only records what was asked of it.
type Param = {
  value: number
  setValueAtTime: (value: number) => Param
  linearRampToValueAtTime: () => Param
  exponentialRampToValueAtTime: () => Param
  cancelScheduledValues: () => Param
}
function param(): Param {
  const p: Param = {
    value: 0,
    setValueAtTime: (value) => {
      p.value = value
      return p
    },
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

function fakeContext(opts: { resume?: () => Promise<void>; suspend?: () => Promise<void>; state?: string } = {}) {
  const started: FakeNode[] = []
  const nodes: FakeNode[] = []
  const calls = { resume: 0, suspend: 0 }
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
    // Like the browser's: the state changes once the promise has settled, and only if it succeeded.
    resume: () => {
      calls.resume += 1
      return (opts.resume ? opts.resume() : Promise.resolve()).then(() => {
        context.state = 'running'
      })
    },
    suspend: () => {
      calls.suspend += 1
      return (opts.suspend ? opts.suspend() : Promise.resolve()).then(() => {
        context.state = 'suspended'
      })
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

  it('cuts what is playing when muted, and lets it be heard again when unmuted', () => {
    const fake = fakeContext()
    const sounds = createSlotSounds(() => fake.context)
    sounds.unlock()
    // The first gain made is the master, everything goes through it.
    const master = fake.nodes[0]
    expect(master.gain.value).toBe(0.25)
    sounds.play('bigWin')
    sounds.setMuted(true)
    expect(master.gain.value).toBe(0)
    sounds.setMuted(false)
    expect(master.gain.value).toBe(0.25)
  })

  it('starts muted at no volume when the switch was off', () => {
    localStorage.setItem('slots.sound', 'off')
    const fake = fakeContext()
    createSlotSounds(() => fake.context).unlock()
    expect(fake.nodes[0].gain.value).toBe(0)
  })

  it('unmuting starts again a loop the page still wants', () => {
    const fake = fakeContext()
    const sounds = createSlotSounds(() => fake.context)
    sounds.unlock()
    sounds.spinning(true)
    sounds.setMuted(true)
    const before = fake.started.length
    sounds.setMuted(false)
    const restarted = fake.started.slice(before)
    expect(restarted.filter((n) => n.loop && n.stopped === 0)).toHaveLength(1)
  })

  it('a loop turned on before the first press starts at unlock()', () => {
    const fake = fakeContext()
    const sounds = createSlotSounds(() => fake.context)
    sounds.spinning(true)
    expect(fake.started).toHaveLength(0)
    sounds.unlock()
    expect(fake.started.filter((n) => n.loop && n.stopped === 0)).toHaveLength(1)
  })

  describe('in a hidden tab', () => {
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

    it('suspends the context when hidden and resumes it when visible', async () => {
      const fake = fakeContext()
      const sounds = createSlotSounds(() => fake.context)
      sounds.unlock()
      sounds.spinning(true)
      const loop = fake.started.find((n) => n.loop)!

      sounds.setHidden(true)
      expect(fake.calls.suspend).toBe(1)
      await settle()
      expect(fake.context.state).toBe('suspended')
      // The loop is paused with the context, not ended: it goes on when the player comes back.
      expect(loop.stopped).toBe(0)

      sounds.setHidden(false)
      expect(fake.calls.resume).toBe(1)
      await settle()
      expect(fake.context.state).toBe('running')
      expect(fake.started.filter((n) => n.loop)).toEqual([loop])
    })

    it('does nothing before the first press', () => {
      const make = vi.fn(() => fakeContext().context)
      const sounds = createSlotSounds(make)
      expect(() => {
        sounds.setHidden(true)
        sounds.setHidden(false)
      }).not.toThrow()
      expect(make).not.toHaveBeenCalled()
    })

    it('starts no sound and no loop on a suspended context, so nothing piles up for its return', async () => {
      const fake = fakeContext()
      const sounds = createSlotSounds(() => fake.context)
      sounds.unlock()
      sounds.setHidden(true)
      await settle()
      for (const name of ALL) sounds.play(name)
      sounds.spinning(true)
      sounds.suspense(true)
      expect(fake.started).toHaveLength(0)

      // Back in view, the loops the page still wants start.
      sounds.setHidden(false)
      await settle()
      expect(fake.started.filter((n) => n.stopped === 0).length).toBe(2)
    })

    it('starts no sound on a context the browser suspended by itself', () => {
      const fake = fakeContext()
      const sounds = createSlotSounds(() => fake.context)
      sounds.unlock()
      ;(fake.context as { state: string }).state = 'interrupted'
      sounds.play('win')
      sounds.spinning(true)
      expect(fake.started).toHaveLength(0)
    })

    it('plays on a suspended context while the resume the press started is pending, and not once it failed', async () => {
      const fake = fakeContext({ state: 'suspended', resume: () => Promise.reject(new Error('blocked')) })
      const sounds = createSlotSounds(() => fake.context)
      sounds.unlock()
      sounds.play('press')
      expect(fake.started.length).toBeGreaterThan(0)
      await settle()
      const count = fake.started.length
      sounds.play('press')
      expect(fake.started).toHaveLength(count)
    })

    it('does not throw or leave an unhandled rejection when suspend or resume is refused', async () => {
      const fake = fakeContext({ suspend: () => Promise.reject(new Error('no')), resume: () => Promise.reject(new Error('no')) })
      const sounds = createSlotSounds(() => fake.context)
      sounds.unlock()
      expect(() => {
        sounds.setHidden(true)
        sounds.setHidden(false)
      }).not.toThrow()
      await settle()

      const throwing = fakeContext()
      const other = createSlotSounds(() => throwing.context)
      other.unlock()
      Object.assign(throwing.context, {
        suspend: () => {
          throw new Error('no')
        },
        resume: () => {
          throw new Error('no')
        },
      })
      expect(() => {
        other.setHidden(true)
        other.setHidden(false)
      }).not.toThrow()
      await settle()
      // An unhandled rejection would fail the whole run.
    })
  })
})
