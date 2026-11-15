import { SLOT_MACHINES, SLOT_REEL_STOPS, slotChain, slotWindow } from '@4story-portal/shared'
import type { SlotStep, SlotStops } from '@4story-portal/shared'
import { act, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { reelTimes } from '../../lib/slots'
import { stopsWhere } from '../../test/slot-fixture'
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

/** The symbol index a tile shows, read from its icon's file. */
const symbolOf = (tile: Element) => {
  const src = tile.querySelector('img')!.getAttribute('src')!
  return machine.symbols.findIndex((symbol) => src === `/game-icons/${symbol.sprite}.png`)
}

/** The three tiles of a reel's step grid, top first. */
const stepTiles = (reel: number) => [...screen.getByTestId(`step-${reel}`).children] as HTMLElement[]

/** The symbol index in each tile of the step grid: [reel][row]. */
const stepShown = () => [0, 1, 2, 3, 4].map((reel) => stepTiles(reel).map(symbolOf))

/** How many rows above its place a tile is drawn: 0 when it is not moved. */
const rowsAbove = (tile: HTMLElement) => -Number(/translateY\((-?[\d.e+-]+)%\)/.exec(tile.style.transform)?.[1] ?? 0) / 100

/** The first stops whose cascade runs three steps or more, so step 2 bursts what step 1 won and step 3 what step 2 won. */
const CHAIN = stopsWhere(machine, (_, stops) => slotChain(machine, stops).steps.length >= 3)
const STEPS = slotChain(machine, CHAIN).steps
const stepOf = (i: number, key = `s${i + 1}`) => {
  const { grid, drop, burst }: SlotStep = STEPS[i]
  return { step: { grid, drop, burst, key } }
}

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
    onStepLanded: () => told.push(`landed ${base.step?.key}`),
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
    vi.restoreAllMocks()
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

describe('a cascade step on the reels', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  /** The reels at rest on CHAIN, as the page has them when the paid spin has stopped. */
  const stopped = (props: Partial<ComponentProps<typeof Reels>> = {}) => setup({ ...spinTo(CHAIN), ...props })

  it('draws step 1 in place of the strips at once, tile for tile where the strips were, and tells it landed', () => {
    animate()
    const { told, update } = stopped()
    const before = shown()
    const tileClass = tileAt(0, 0).className
    update(stepOf(0))
    expect(told).toEqual(['landed s1'])
    expect(STEPS[0].grid).toEqual(before)
    expect(stepShown()).toEqual(before)
    for (let reel = 0; reel < 5; reel++) {
      expect(strip(reel).element).not.toBeVisible()
      expect(screen.getByTestId(`step-${reel}`)).toBeVisible()
      // In the same window as the strip, at its top, with tiles of the same size, none of them moved.
      expect(screen.getByTestId(`step-${reel}`).parentElement).toBe(strip(reel).element.parentElement!.parentElement)
      for (const tile of stepTiles(reel)) {
        expect(tile.className).toBe(tileClass)
        expect(tile.style.transform).toBe('')
      }
    }
    expect(screen.queryByTestId('burst-0')).toBeNull()
    const names = STEPS[0].grid.map((rows) => rows.map((s) => machine.symbols[s].name))
    const row = (r: number) => names.map((rows) => rows[r]).join(', ')
    expect(screen.getByRole('img')).toHaveAccessibleName(`Reels: top row ${row(0)}; middle row ${row(1)}; bottom row ${row(2)}`)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('bursts the tiles the step before won, then drops each tile from its drop rows to its place', () => {
    animate()
    const { told, update } = stopped()
    update(stepOf(0))
    update(stepOf(1))
    const { drop } = STEPS[1]
    const burst = STEPS[0].burst
    const isBurst = (reel: number, row: number) => burst.some(([r, w]) => r === reel && w === row)
    const burstTile = (reel: number, row: number) => screen.getByTestId(`burst-${reel}`).children[row] as HTMLElement
    expect(screen.getByRole('img')).toHaveAccessibleName('Reels, tiles falling')

    // The burst: step 1's grid, its winning tiles fading and shrinking, the new grid waiting above its places.
    for (let reel = 0; reel < 5; reel++) {
      expect(screen.getByTestId(`burst-${reel}`)).toBeVisible()
      expect(screen.getByTestId(`step-${reel}`)).not.toBeVisible()
      expect([...screen.getByTestId(`burst-${reel}`).children].map(symbolOf)).toEqual(STEPS[0].grid[reel])
      stepTiles(reel).forEach((tile, row) => expect(rowsAbove(tile)).toBeCloseTo(drop[reel][row], 6))
    }
    advance(16 + 150)
    for (let reel = 0; reel < 5; reel++) {
      for (let row = 0; row < 3; row++) {
        const opacity = burstTile(reel, row).style.opacity
        if (isBurst(reel, row)) {
          expect(Number(opacity)).toBeGreaterThan(0)
          expect(Number(opacity)).toBeLessThan(1)
          expect(burstTile(reel, row).style.transform).toMatch(/^scale\(0\.\d+\)$/)
        } else expect(opacity).toBe('')
      }
    }

    // The fall: the new grid, every tile that moves still above its place, each falling as far as it has to.
    advance(250)
    expect(told).toEqual(['landed s1'])
    expect(drop.flat().some((rows) => rows > 0)).toBe(true)
    for (let reel = 0; reel < 5; reel++) {
      expect(screen.getByTestId(`burst-${reel}`)).not.toBeVisible()
      expect(screen.getByTestId(`step-${reel}`)).toBeVisible()
      stepTiles(reel).forEach((tile, row) => {
        if (drop[reel][row] === 0) expect(tile.style.transform).toBe('')
        else {
          expect(rowsAbove(tile)).toBeGreaterThan(0)
          expect(rowsAbove(tile)).toBeLessThan(drop[reel][row])
        }
      })
    }

    // Landed, after the burst and the fall (0.3 + 0.35 s): every tile on its place, the burst gone.
    advance(300)
    expect(told).toEqual(['landed s1', 'landed s2'])
    expect(stepShown()).toEqual(STEPS[1].grid)
    for (let reel = 0; reel < 5; reel++) for (const tile of stepTiles(reel)) expect(tile.style.transform).toBe('')
    expect(screen.queryByTestId('burst-0')).toBeNull()
    expect(screen.getByRole('img')).toHaveAccessibleName(/^Reels: top row /)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('tells each step landed once, after its burst and fall, and never twice for the same key', () => {
    animate()
    const { told, update } = stopped()
    update(stepOf(0))
    update(stepOf(1))
    // The first frame starts the clock; 0.65 s later it lands.
    advance(16 + 630)
    expect(told).toEqual(['landed s1'])
    advance(40)
    expect(told).toEqual(['landed s1', 'landed s2'])
    // The same step drawn again starts nothing.
    update(stepOf(1))
    update({ lit: [[0, 1]] })
    advance(2000)
    expect(told).toEqual(['landed s1', 'landed s2'])
    expect(vi.getTimerCount()).toBe(0)

    // Quick spin's halved times.
    update({ ...stepOf(2), stepTimes: { burst: 0.15, fall: 0.175 } })
    advance(16 + 300)
    expect(told).toHaveLength(2)
    advance(40)
    expect(told).toEqual(['landed s1', 'landed s2', 'landed s3'])
  })

  it('tells each step landed once under React development mode, which runs effects twice', () => {
    animate()
    const told: string[] = []
    const props = (change: Partial<ComponentProps<typeof Reels>>): ComponentProps<typeof Reels> => ({
      machine,
      rest: machine.rest,
      ...spinTo(CHAIN),
      animate: true,
      lit: [],
      stopNow: 0,
      onReelStopped: () => {},
      onStopped: () => {},
      onStepLanded: () => told.push('landed'),
      ...change,
    })
    const view = render(<Reels {...props(stepOf(0))} />, { reactStrictMode: true })
    expect(told).toEqual([])
    view.rerender(<Reels {...props(stepOf(1))} />)
    advance(1000)
    view.rerender(<Reels {...props(stepOf(2))} />)
    advance(1000)
    expect(told).toEqual(['landed', 'landed'])
    expect(stepShown()).toEqual(STEPS[2].grid)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('never tells a step landed after unmount, and leaves no frame', () => {
    animate()
    const errors = vi.spyOn(console, 'error')
    const { told, update, view } = stopped()
    update(stepOf(0))
    update(stepOf(1))
    advance(400)
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(5000)
    expect(told).toEqual(['landed s1'])
    expect(errors).not.toHaveBeenCalled()
  })

  it('lands a step at once without animation', () => {
    const { told, update } = stopped({ animate: false })
    update(stepOf(0))
    update(stepOf(1))
    expect(told).toEqual(['landed s1', 'landed s2'])
    expect(stepShown()).toEqual(STEPS[1].grid)
    for (let reel = 0; reel < 5; reel++) for (const tile of stepTiles(reel)) expect(tile.style.transform).toBe('')
    expect(screen.queryByTestId('burst-0')).toBeNull()
  })

  it('shows a step it is first drawn with as landed, and tells nothing', () => {
    const { told } = stopped(stepOf(1))
    expect(stepShown()).toEqual(STEPS[1].grid)
    expect(screen.queryByTestId('burst-0')).toBeNull()
    expect(told).toEqual([])
  })

  it('lights the tiles it is given on a step only once it has landed, and draws what it is given over it', () => {
    animate()
    const lit = [[0, 0], [2, 1], [4, 2]] as const
    const { update } = stopped({ lit, children: <p>Over the reels</p> })
    const litAt = () => lit.map(([reel, row]) => stepTiles(reel)[row].dataset.won)
    update(stepOf(0))
    expect(litAt()).toEqual(['true', 'true', 'true'])
    // The strips under it are not lit.
    expect(litTiles()).toHaveLength(0)
    update(stepOf(1))
    expect(litAt()).toEqual([undefined, undefined, undefined])
    advance(1000)
    expect(litAt()).toEqual(['true', 'true', 'true'])
    expect(screen.getByText('Over the reels')).toBeInTheDocument()
    update({ lit: [] })
    expect(litAt()).toEqual([undefined, undefined, undefined])
  })

  it('goes back to the strips for the next spin, from the stops the page passes', () => {
    animate()
    const { told, update } = stopped()
    update(stepOf(0))
    update(stepOf(1))
    advance(1000)
    told.length = 0
    update({ step: null, ...spinTo(TO, 'b') })
    expect(screen.queryByTestId('step-0')).toBeNull()
    for (let reel = 0; reel < 5; reel++) expect(strip(reel).element).toBeVisible()
    advance(4000)
    expect(told).toEqual(['reel 0', 'reel 1', 'reel 2', 'reel 3', 'reel 4', 'stopped'])
    expect(shown()).toEqual(slotWindow(machine, TO))

    // The next chain's step 1 lands at once again: nothing from the last chain bursts.
    update(stepOf(0, 'b1'))
    expect(told.at(-1)).toBe('landed b1')
    expect(screen.queryByTestId('burst-0')).toBeNull()
  })
})

describe('the cabinet line colour', () => {
  it('is a colour for every machine', () => {
    for (const { key } of SLOT_MACHINES) expect(cabinetLine(key)).toMatch(/^#[0-9a-f]{6}$/i)
  })
})
