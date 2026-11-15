import { SLOT_MACHINES, SLOT_REEL_STOPS, slotWindow } from '@4story-portal/shared'
import type { SlotStops } from '@4story-portal/shared'
import { act, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { reelTimes } from '../../lib/slots'
import { cabinetLine, Reels } from './Reels'

const machine = SLOT_MACHINES[0]
const TO: SlotStops = [5, 0, 20, 31, 2]
const TIMES = reelTimes([false, false, false, false, false], false)

/** A reel's strip of tiles, and how far it is moved down, in rows: tile n sits at row offset + n. */
function strip(reel: number) {
  const element = screen.getByTestId(`reel-${reel}`)
  const percent = Number(/translateY\((-?[\d.e+-]+)%\)/.exec(element.style.transform)?.[1])
  return { element, offset: (percent / 100) * element.children.length }
}

/** The tile drawn in `row` (0 top, 1 middle, 2 bottom) of a reel. */
function tileAt(reel: number, row: number): HTMLElement {
  const { element, offset } = strip(reel)
  const index = row - offset
  // At rest the strip sits on whole rows.
  expect(index).toBeCloseTo(Math.round(index), 6)
  return element.children[Math.round(index)] as HTMLElement
}

/** The symbol index drawn in each row of each reel, read from the icons' files: [reel][row], as slotWindow gives it. */
const shown = () =>
  [0, 1, 2, 3, 4].map((reel) =>
    [0, 1, 2].map((row) => {
      const src = tileAt(reel, row).querySelector('img')!.getAttribute('src')!
      return machine.symbols.findIndex((symbol) => src === `/game-icons/${symbol.sprite}.png`)
    }),
  )

const litTiles = () =>
  [0, 1, 2, 3, 4].flatMap((reel) => [...strip(reel).element.children].filter((tile) => (tile as HTMLElement).dataset.won))

/** A clock the test moves by hand, for the animation frames. */
function animate() {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
}

/** The reels with every prop a test does not set, and a log of what they told. */
function setup(props: Partial<ComponentProps<typeof Reels>> = {}) {
  const told: string[] = []
  const base: ComponentProps<typeof Reels> = {
    machine,
    rest: machine.rest,
    spin: null,
    animate: true,
    lit: [],
    stopNow: 0,
    onReelStopped: (reel) => told.push(`reel ${reel}`),
    onStopped: () => told.push('stopped'),
    ...props,
  }
  const view = render(<Reels {...base} />)
  const update = (change: Partial<ComponentProps<typeof Reels>>) => {
    Object.assign(base, change)
    view.rerender(<Reels {...base} />)
  }
  return { told, update, view }
}

const spinTo = (stops: SlotStops, key = 'a', times: readonly number[] = TIMES) => ({ spin: { stops, key, times } })
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms))

describe('the reels', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the three real rows of each of the five reels at rest', () => {
    setup()
    expect(screen.getAllByTestId(/^reel-/)).toHaveLength(5)
    expect(shown()).toEqual(slotWindow(machine, machine.rest))
    for (let reel = 0; reel < 5; reel++) expect(strip(reel).element.children.length).toBeGreaterThan(SLOT_REEL_STOPS)
    expect(screen.getByRole('img', { name: 'Reels' })).toBeInTheDocument()
  })

  it('shows a spin it is first drawn with as already shown, and tells nothing', () => {
    const { told } = setup({ ...spinTo(TO) })
    expect(shown()).toEqual(slotWindow(machine, TO))
    const names = slotWindow(machine, TO).map((rows) => rows.map((s) => machine.symbols[s].name))
    const row = (r: number) => names.map((rows) => rows[r]).join(', ')
    expect(screen.getByRole('img')).toHaveAccessibleName(`Reels: top row ${row(0)}; middle row ${row(1)}; bottom row ${row(2)}`)
    expect(told).toEqual([])
  })

  it('tells each reel stopping in order, then the spin', () => {
    animate()
    const { told, update } = setup()
    update(spinTo(TO))
    expect(screen.getByRole('img')).toHaveAccessibleName('Reels, spinning')
    advance(TIMES[0] * 1000 - 50)
    expect(told).toEqual([])
    // Reel 1 has stopped, the others still turn, blurred.
    advance(100)
    expect(told).toEqual(['reel 0'])
    expect(strip(0).element.style.filter).toBe('')
    expect(strip(4).element.style.filter).toContain('slot-reel-blur')
    for (let reel = 1; reel < 5; reel++) {
      // Frames come every 16 ms, so each reel is told within a frame of its time.
      advance((TIMES[reel] - TIMES[reel - 1]) * 1000)
      expect(told).toContain(`reel ${reel}`)
      expect(told).not.toContain(`reel ${reel + 1}`)
    }
    expect(told).toEqual(['reel 0', 'reel 1', 'reel 2', 'reel 3', 'reel 4', 'stopped'])
    expect(shown()).toEqual(slotWindow(machine, TO))
    expect(vi.getTimerCount()).toBe(0)

    // The same spin again starts nothing; the next one starts from where these rest.
    update(spinTo(TO))
    advance(4000)
    expect(told).toHaveLength(6)
    const next: SlotStops = [9, 9, 9, 9, 9]
    update(spinTo(next, 'b'))
    advance(4000)
    expect(told.slice(6)).toEqual(['reel 0', 'reel 1', 'reel 2', 'reel 3', 'reel 4', 'stopped'])
    expect(shown()).toEqual(slotWindow(machine, next))
  })

  it('stops at once when stopNow changes mid-spin', () => {
    animate()
    const { told, update } = setup({ lit: [[2, 1]] })
    update(spinTo(TO))
    advance(600)
    update({ stopNow: 1 })
    expect(told).toEqual([])
    // Each reel is just past its stop, sharp, and drops back onto it: still moving, so nothing is told or lit.
    advance(16)
    for (let reel = 0; reel < 5; reel++) expect(strip(reel).element.style.filter).toBe('')
    advance(100)
    expect(told).toEqual([])
    expect(litTiles()).toHaveLength(0)
    // The settle (0.18 s) has ended: every reel is told, in order, with its tiles on its stops, then the spin.
    advance(100)
    expect(told).toEqual(['reel 0', 'reel 1', 'reel 2', 'reel 3', 'reel 4', 'stopped'])
    expect(shown()).toEqual(slotWindow(machine, TO))
    expect(litTiles()).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)

    // Pressed again, or after the spin, it does nothing.
    update({ stopNow: 2 })
    update({ stopNow: 3 })
    advance(4000)
    expect(told).toHaveLength(6)
    expect(shown()).toEqual(slotWindow(machine, TO))
  })

  it('stops only the reels still turning, and twice in a row is the same as once', () => {
    animate()
    const { told, update } = setup()
    update(spinTo(TO))
    advance(TIMES[1] * 1000 + 50)
    expect(told).toEqual(['reel 0', 'reel 1'])
    update({ stopNow: 1 })
    update({ stopNow: 2 })
    advance(116)
    expect(told).toEqual(['reel 0', 'reel 1'])
    // The two that had rested are not told again.
    advance(100)
    expect(told).toEqual(['reel 0', 'reel 1', 'reel 2', 'reel 3', 'reel 4', 'stopped'])
    expect(shown()).toEqual(slotWindow(machine, TO))
    advance(4000)
    expect(told).toHaveLength(6)
  })

  it('ignores stopNow before a spin and between spins', () => {
    animate()
    const { told, update } = setup({ stopNow: 5 })
    update({ stopNow: 6 })
    advance(100)
    update(spinTo(TO))
    // The spin turns its whole time: the earlier presses were not kept for it.
    advance(TIMES[0] * 1000 - 50)
    expect(told).toEqual([])
    advance(4000)
    expect(told).toEqual(['reel 0', 'reel 1', 'reel 2', 'reel 3', 'reel 4', 'stopped'])
    update({ stopNow: 7 })
    update(spinTo([1, 2, 3, 4, 5], 'b'))
    advance(TIMES[0] * 1000 - 50)
    expect(told).toHaveLength(6)
    advance(4000)
    expect(told).toHaveLength(12)
  })

  it('lights the tiles it is given only at rest', () => {
    animate()
    const lit = [[0, 0], [2, 1], [4, 2]] as const
    const { update } = setup({ lit })
    const litAt = () => lit.map(([reel, row]) => tileAt(reel, row).dataset.won)
    expect(litAt()).toEqual(['true', 'true', 'true'])
    expect(litTiles()).toHaveLength(3)

    update(spinTo(TO))
    advance(500)
    expect(litTiles()).toHaveLength(0)
    advance(4000)
    expect(litAt()).toEqual(['true', 'true', 'true'])
    expect(litTiles()).toHaveLength(3)
    update({ lit: [] })
    expect(litTiles()).toHaveLength(0)
  })

  it('jumps to the result without animation', () => {
    const { told, update } = setup({ animate: false })
    update(spinTo(TO))
    expect(told).toEqual(['reel 0', 'reel 1', 'reel 2', 'reel 3', 'reel 4', 'stopped'])
    expect(shown()).toEqual(slotWindow(machine, TO))
    for (let reel = 0; reel < 5; reel++) expect(strip(reel).element.style.filter).toBe('')
  })

  it('draws what it is given over the window', () => {
    setup({ children: <p>Over the reels</p> })
    expect(screen.getByText('Over the reels')).toBeInTheDocument()
  })

  it('never calls back after unmount', () => {
    animate()
    const errors = vi.spyOn(console, 'error')
    const { told, update, view } = setup()
    update(spinTo(TO))
    advance(TIMES[0] * 1000 + 50)
    expect(told).toEqual(['reel 0'])
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(5000)
    expect(told).toEqual(['reel 0'])

    // Nor while settling after a stop.
    const second = setup()
    second.update(spinTo(TO))
    advance(600)
    second.update({ stopNow: 1 })
    advance(16)
    expect(second.told).toEqual([])
    second.view.unmount()
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(5000)
    expect(second.told).toEqual([])
    expect(errors).not.toHaveBeenCalled()
  })
})

describe('the cabinet line colour', () => {
  it('is a colour for every machine', () => {
    for (const { key } of SLOT_MACHINES) expect(cabinetLine(key)).toMatch(/^#[0-9a-f]{6}$/i)
  })
})
