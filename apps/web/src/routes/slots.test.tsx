import { SLOT_MACHINES, SLOT_SCATTER, silverText, slotJackpotShare, slotRoundPayout, slotWindow } from '@4story-portal/shared'
import type {
  SlotJackpot,
  SlotMachine,
  SlotMachineState,
  SlotSpinResult,
  SlotSpinView,
  SlotStakes,
  SlotsState,
  SlotStops,
  Wallet,
  WalletCharacter,
} from '@4story-portal/shared'
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { REEL_BLURS } from '../lib/reel-blur'
import { roundLine, roundListLine, roundSpins, winTier, wonTiles } from '../lib/slot-round'
import type { SlotSounds } from '../lib/slot-sounds'
import { reelTimes, slotsQueryOptions } from '../lib/slots'
import { setSlotSoundsForTest } from '../lib/use-slot-round'
import { json, mockApi, sentBodies } from '../test/mock-api'
import { renderRoute } from '../test/render-route'
import { stopsWhere } from '../test/slot-fixture'

const me = { userId: 2, username: 'plain', isGm: false }
const shelf = SLOT_MACHINES[0]

/** Mounara starts with 5 Gold 250 Silver. */
const BEFORE = 5250
const mounara: WalletCharacter = {
  id: 7,
  name: 'Mounara',
  level: 60,
  className: 'Archer',
  online: false,
  wallet: { gold: 5, silver: 250, copper: 0 },
}
const busy: WalletCharacter = { id: 8, name: 'Busy', level: 30, className: 'Knight', online: true, wallet: { gold: 2, silver: 0, copper: 0 } }
const moosey: WalletCharacter = { id: 5, name: 'Moosey', level: 45, className: 'Wizard', online: false, wallet: { gold: 0, silver: 900, copper: 0 } }

const machines = (change: Partial<Record<string, Partial<SlotMachineState>>> = {}): SlotMachineState[] =>
  SLOT_MACHINES.map((m) => ({ key: m.key, live: true, stakes: [...m.stakes] as SlotStakes, ...change[m.key] }))

const state = (overrides: Partial<SlotsState> = {}): SlotsState => ({
  live: true,
  machines: machines(),
  characters: [mounara, busy],
  mine: [],
  bigWins: [],
  jackpot: null,
  ...overrides,
})

// Spins on the real Tranus's Shelf, found from its strips, so the tests hold whatever the strips are.
const scatterReels = (stops: SlotStops) => slotWindow(shelf, stops).map((rows) => rows.includes(SLOT_SCATTER))
const sameReels = (a: boolean[], b: boolean[]) => a.every((x, i) => x === b[i])
/** No line and no scatter. */
const BLANK = stopsWhere(shelf, (o) => o.multiple === 0 && o.scatters === 0)
/** Less than the stake. */
const SMALL = stopsWhere(shelf, (o) => o.multiple > 0 && o.multiple < 20 && o.scatters === 0)
/** Three lines or more, paying the stake up to ten times it. */
const LINES = stopsWhere(shelf, (o) => o.lines.length >= 3 && o.multiple >= 20 && o.multiple < 200 && o.freeSpins === 0)
/** Ten to fifty times the stake. */
const BIG = stopsWhere(shelf, (o) => o.multiple >= 200 && o.multiple < 1000 && o.freeSpins === 0)
/** Fifty times the stake or more. */
const HUGE = stopsWhere(shelf, (o) => o.multiple >= 1000 && o.freeSpins === 0)
/** Three scatters and no line: 8 free spins. */
const EIGHT = stopsWhere(shelf, (o) => o.freeSpins === 8 && o.multiple === 0)
/** Scatters on reels 1 and 4, nothing else. */
const SCATTERS_1_4 = stopsWhere(shelf, (o, s) => o.multiple === 0 && sameReels(scatterReels(s), [true, false, false, true, false]))
/** Scatters on reels 1 and 2, nothing else: reels 3 to 5 turn in suspense. */
const SCATTERS_1_2 = stopsWhere(shelf, (o, s) => o.multiple === 0 && sameReels(scatterReels(s), [true, true, false, false, false]))
/** Eight free spins: two pay well, one a little, the rest nothing. */
const FREE = [LINES, BLANK, SMALL, BLANK, BLANK, BLANK, LINES, BLANK]
/** Eight free spins, and lines of its own that pay less than the stake. */
const EIGHT_SMALL = stopsWhere(shelf, (o) => o.freeSpins === 8 && o.multiple > 0 && o.multiple < 20)
/** Less than half the stake, so even doubled in a free spin it stays below it. */
const TINY = stopsWhere(shelf, (o) => o.multiple > 0 && o.multiple < 10 && o.freeSpins === 0)

let ids = 100
/** A round on Tranus's Shelf by Mounara, paying what its stops pay. */
const roundOf = (stops: SlotStops, overrides: Partial<SlotSpinView> = {}): SlotSpinView => {
  const free = overrides.free ?? []
  const stake = overrides.stake ?? 20
  return {
    id: ids++,
    at: '2026-11-14T10:05:00.000Z',
    character: 'Mounara',
    machine: 'shelf',
    stops,
    free,
    stake,
    payout: slotRoundPayout(shelf, { stops, free }, stake),
    jackpot: 0,
    ...overrides,
  }
}

const silverWallet = (silver: number): Wallet => ({ gold: Math.floor(silver / 1000), silver: silver % 1000, copper: 0 })
const walletAfter = (spin: SlotSpinView) => silverWallet(BEFORE - spin.stake + spin.payout + spin.jackpot)
/** Mounara's wallet as the page reads it out once the round has been shown. */
const walletText = (spin: SlotSpinView) => silverText(BEFORE - spin.stake + spin.payout + spin.jackpot)

/** What the API answers for a round by Mounara. */
const result = (spin: SlotSpinView, overrides: Partial<SlotsState> = {}): SlotSpinResult => ({
  spin,
  wallet: walletAfter(spin),
  state: state({ characters: [{ ...mounara, wallet: walletAfter(spin) }, busy], mine: [spin], ...overrides }),
})

const lineOf = (spin: SlotSpinView) => roundLine(spin, roundSpins(shelf, spin))
const ROWS = ['top', 'middle', 'bottom']
/** The reels' name at rest on `stops`. */
const reelsName = (stops: SlotStops, machine: SlotMachine = shelf) => {
  const window = slotWindow(machine, stops)
  return `Reels: ${ROWS.map((name, row) => `${name} row ${window.map((rows) => machine.symbols[rows[row]].name).join(', ')}`).join('; ')}`
}

const lost = result(roundOf(BLANK, { stake: 60 }))
const lines = result(roundOf(LINES, { stake: 60 }))

const pot: SlotJackpot = {
  live: true,
  pot: 31_420,
  cap: 50_000,
  floor: 5_000,
  last: { character: 'Moosey', amount: 27_310, at: '2026-11-12T09:00:00.000Z' },
}
/** A lost round at 60 Silver that made the whole pot drop for Mounara. */
const dropSpin = roundOf(BLANK, { stake: 60, jackpot: 50_002 })
const dropped: SlotJackpot = { ...pot, pot: 0, last: { character: 'Mounara', amount: 50_002, at: '2026-11-15T10:05:00.000Z' } }
const dropState = result(dropSpin, { jackpot: dropped })
const banner = () => screen.getByRole('region', { name: 'Jackpot' })
const pays = () => within(screen.getByRole('region', { name: 'What it pays' }))
const JACKPOT_LINE = 'With the jackpot, the slots pay back everything staked, over time.'

const open = (current: SlotsState = state(), extra: Parameters<typeof mockApi>[0] = {}) => {
  const fetchMock = mockApi({ 'GET /slots': () => json(200, current), ...extra })
  return { fetchMock, ...renderRoute('/slots', { me }) }
}

/** A server that answers each spin in turn, and afterwards serves the state that spin left. */
function server(...results: SlotSpinResult[]) {
  let current = state()
  let spins = 0
  return {
    'GET /slots': () => json(200, current),
    'POST /slots/spin': () => {
      const next = results[Math.min(spins++, results.length - 1)]
      current = next.state
      return json(200, next)
    },
  }
}

/** Lets a poll reach the page: React Query tells it a moment after the answer. */
async function poll(queryClient: ReturnType<typeof open>['queryClient']) {
  await act(() => queryClient.invalidateQueries({ queryKey: ['slots'] }))
  await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
}

const panel = () => screen.getByRole('tabpanel')
const status = () => within(panel()).getByRole('status')
const picker = () => screen.getByRole('combobox', { name: 'Playing with' })
/** Spin, which reads Stop while a round shows. */
const spinButton = () => within(panel()).getByRole('button', { name: /^(Spin|Stop)/ })
const loaded = () => screen.findByRole('button', { name: 'Spin' })
/** Spin back after a round: it has been shown to its end. */
const settled = loaded
const tab = (name: string) => screen.getByRole('tab', { name })
const tabNames = () => within(screen.getByRole('tablist', { name: 'Machine' })).getAllByRole('tab').map((t) => t.textContent)
const stake = (name: string) => screen.getByRole('radio', { name })
const stakeNames = () =>
  within(screen.getByRole('radiogroup', { name: 'Stake' }))
    .getAllByRole('radio')
    .map((radio) => radio.getAttribute('aria-label'))
const reels = () => screen.getByRole('img', { name: /^Reels/ })
const getGets = (fetchMock: ReturnType<typeof open>['fetchMock']) =>
  fetchMock.mock.calls.filter(([input, init]) => String(input) === '/api/slots' && !init?.method)
const quickSwitch = () => screen.getByRole('button', { name: 'Quick spin' })
const soundSwitch = () => screen.getByRole('button', { name: 'Sound' })
const skipButton = () => screen.queryByRole('button', { name: 'Skip to the total' })
const lastRounds = () => within(screen.getByRole('region', { name: 'Your last rounds' }))

/** The text a screen reader reads: icons and coin sprites read as their names. */
function spoken(element: Element): string {
  const parts: string[] = []
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) parts.push(node.textContent ?? '')
    else if (node instanceof HTMLImageElement) parts.push(` ${node.alt} `)
    else if (node instanceof Element && node.getAttribute('aria-hidden') !== 'true') node.childNodes.forEach(walk)
  }
  walk(element)
  return parts.join('').replace(/\s+/g, ' ').trim()
}
const wallet = () => spoken(within(panel()).getByText('Wallet').nextElementSibling!)
/** The Win figure, or null when none is shown. */
const winFigure = () => {
  const label = within(panel()).queryByText('Win', { selector: 'dt' })
  return label ? spoken(label.nextElementSibling!) : null
}

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

/** The symbol drawn in each row of each reel, read from the icons' files: [reel][row], as slotWindow gives it. */
const shownWindow = (machine: SlotMachine = shelf) =>
  [0, 1, 2, 3, 4].map((reel) =>
    [0, 1, 2].map((row) => {
      const src = tileAt(reel, row).querySelector('img')!.getAttribute('src')!
      return machine.symbols.findIndex((symbol) => src === `/game-icons/${symbol.sprite}.png`)
    }),
  )

/** The filter on a reel at full speed: the strongest of the page's vertical blurs. */
const STRONGEST = `#${REEL_BLURS[REEL_BLURS.length - 1].id}`
const allLit = () => screen.queryAllByTestId(/^reel-/).flatMap((reel) => [...reel.children].filter((tile) => (tile as HTMLElement).dataset.won))
/** The win lines drawn over the window. */
const drawnLines = () => reels().querySelectorAll('polyline').length

/** Turns the animation on, with a clock the test moves by hand. */
function animate() {
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
}

/** Moves the clock by `ms` at once: the reels' frames, but no part of the show that waits for the page to be drawn. */
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms))

/** Moves the clock in steps, drawing the page between them as a browser would: each spin of a round starts from a drawn page. */
function run(ms: number, each?: () => void) {
  for (let t = 0; t < ms; t += 100) {
    advance(Math.min(100, ms - t))
    each?.()
  }
}

/** Moves the clock until the round has been shown and Spin is back. */
function playOut(each?: () => void) {
  for (let t = 0; t < 120_000 && spinButton().textContent !== 'Spin'; t += 200) {
    advance(200)
    each?.()
  }
  expect(spinButton()).toHaveTextContent('Spin')
}

/** Every text `read` gives over a run, in order, each once. */
function seen(read: () => string | null) {
  const texts: string[] = []
  const look = () => {
    const text = read()
    if (text !== null && texts[texts.length - 1] !== text && !texts.includes(text)) texts.push(text)
  }
  return { texts, look }
}

/** jsdom has no scrollIntoView; a stub on every element records the calls, and the element each was made on. */
function stubScrollIntoView() {
  const scrolled = vi.fn()
  Object.defineProperty(Element.prototype, 'scrollIntoView', { value: scrolled, configurable: true, writable: true })
  return scrolled
}

/** A sound engine that records every call, in order. */
function fakeSounds(muted = false) {
  const calls: string[] = []
  const sounds: SlotSounds = {
    play: (sound, step) => calls.push(step === undefined ? sound : `${sound} ${step}`),
    spinning: (on) => calls.push(`spinning ${on}`),
    suspense: (on) => calls.push(`suspense ${on}`),
    unlock: () => calls.push('unlock'),
    get muted() {
      return muted
    },
    setMuted: (value) => {
      muted = value
      calls.push(`muted ${value}`)
    },
    stop: () => calls.push('stop'),
  }
  return { sounds, calls }
}

const reelSounds = (calls: string[]) => calls.filter((call) => call === 'reelStop' || call.startsWith('scatter'))
const WIN_SOUNDS = ['lineWin', 'win', 'bigWin', 'hugeWin', 'count']

describe('slots', () => {
  let calls: string[]

  beforeEach(() => {
    // Rounds are shown at once unless a test turns the animation on.
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const fake = fakeSounds()
    calls = fake.calls
    setSlotSoundsForTest(fake.sounds)
  })

  afterEach(() => {
    vi.useRealTimers()
    setSlotSoundsForTest(null)
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
  })

  it('shows three machines at rest and what the first one pays', async () => {
    open()
    await loaded()

    expect(screen.getByRole('heading', { name: 'Slots', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('Three machines, one pull at a time.')).toBeInTheDocument()
    expect(screen.getByText("This is real gambling with your character's money. Each machine shows what it pays back.")).toBeInTheDocument()
    // On a phone the tagline goes, and the sentence is shown under the machine, before everything below it.
    expect(screen.getByText('Three machines, one pull at a time.')).toHaveClass('hidden', 'sm:block')
    expect(screen.getByText("This is real gambling with your character's money. Each machine shows what it pays back.")).toHaveClass('order-1')
    for (const name of ['What it pays', 'Your last rounds', 'Big wins']) expect(screen.getByRole('region', { name }).closest('.order-2')).not.toBeNull()
    expect(tabNames()).toEqual(["Tranus's Shelf", 'The Armoury', "Dragon's Hoard"])
    expect(tab("Tranus's Shelf")).toHaveAttribute('aria-selected', 'true')
    expect(panel()).toHaveAccessibleName("Tranus's Shelf")
    expect(stakeNames()).toEqual(['20 Silver', '40 Silver', '60 Silver'])
    expect(stake('20 Silver')).toBeChecked()
    expect(spinButton()).toBeEnabled()
    expect(status()).toHaveTextContent('Pick a stake, then press Spin.')
    expect(winFigure()).toBeNull()
    expect(quickSwitch()).toHaveAttribute('aria-pressed', 'false')
    expect(soundSwitch()).toHaveAttribute('aria-pressed', 'true')

    // At rest on the machine's rest stops, with each strip's real neighbours above and below the middle row.
    expect(reels()).toHaveAccessibleName('Reels')
    expect(shownWindow()).toEqual(slotWindow(shelf, shelf.rest))
    expect(allLit()).toEqual([])
    expect(drawnLines()).toBe(0)

    // The pay table draws its own sentences.
    expect(pays().getAllByRole('row')[1]).toHaveTextContent(shelf.symbols[7].name)
    expect(pays().getByText(/^This machine pays back \d+\.\d% of what goes into it/)).toBeInTheDocument()
    expect(pays().getByText(/^The most one paid spin can win at these stakes is/)).toBeInTheDocument()
  })

  it('offers offline characters and marks one in the game', async () => {
    const { user } = open(state({ characters: [mounara, busy, moosey] }))
    await loaded()

    const options = within(picker()).getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual([
      'Mounara (level 60 Archer)',
      'Busy (in the game, log out to play)',
      'Moosey (level 45 Wizard)',
    ])
    expect(options[1]).toBeDisabled()
    expect(picker()).toHaveValue('7')
    expect(wallet()).toBe('5 Gold 250 Silver')

    await user.selectOptions(picker(), 'Moosey (level 45 Wizard)')
    expect(wallet()).toBe('900 Silver')
  })

  it("switches machine and shows that machine's stakes and payout table", async () => {
    const { user } = open()
    await loaded()
    const armoury = SLOT_MACHINES[1]

    await user.click(tab('The Armoury'))

    expect(tab('The Armoury')).toHaveAttribute('aria-selected', 'true')
    expect(panel()).toHaveAccessibleName('The Armoury')
    expect(stakeNames()).toEqual(['40 Silver', '60 Silver', '100 Silver'])
    expect(stake('40 Silver')).toBeChecked()
    expect(reels()).toHaveAccessibleName('Reels')
    expect(shownWindow(armoury)).toEqual(slotWindow(armoury, armoury.rest))
    // The money in the table follows the stake: the top prize for five is that many line stakes.
    const top = () => pays().getAllByRole('row')[1]
    expect(top()).toHaveTextContent(armoury.symbols[7].name)
    expect(top()).toHaveTextContent(silverText((armoury.pays[7][2] * 40) / 20))

    await user.click(stake('100 Silver'))
    expect(top()).toHaveTextContent(silverText((armoury.pays[7][2] * 100) / 20))

    await user.click(tab("Dragon's Hoard"))
    expect(stakeNames()).toEqual(['60 Silver', '100 Silver', '200 Silver'])
  })

  it('remembers the machine, the stake and the character', async () => {
    const { user } = open(state({ characters: [mounara, busy, moosey] }))
    await loaded()
    await user.click(tab('The Armoury'))
    await user.click(stake('100 Silver'))
    await user.selectOptions(picker(), 'Moosey (level 45 Wizard)')

    cleanup()
    const { user: again } = open(state({ characters: [mounara, busy, moosey] }))
    await loaded()

    expect(tab('The Armoury')).toHaveAttribute('aria-selected', 'true')
    expect(stake('100 Silver')).toBeChecked()
    expect(picker()).toHaveValue('5')
    // Each machine keeps its own stake.
    await again.click(tab("Tranus's Shelf"))
    expect(stake('20 Silver')).toBeChecked()
  })

  it('falls back to the first machine and lowest stake when the remembered ones do not exist', async () => {
    localStorage.setItem('slots.machine', 'retired')
    localStorage.setItem('slots.stake.shelf', '999')
    open()
    await loaded()

    expect(tab("Tranus's Shelf")).toHaveAttribute('aria-selected', 'true')
    expect(stake('20 Silver')).toBeChecked()
    expect(spinButton()).toBeEnabled()
  })

  it('a remembered stake of 25 becomes the lowest stake without a note', async () => {
    // A stake from the three-reel machines, which took 10, 25 and 50.
    localStorage.setItem('slots.stake.shelf', '25')
    open()
    await loaded()

    expect(stake('20 Silver')).toBeChecked()
    expect(status()).toHaveTextContent('Pick a stake, then press Spin.')
    expect(status()).not.toHaveTextContent('The stakes on this machine changed.')
    expect(localStorage.getItem('slots.stake.shelf')).toBe('20')
  })

  it('sends one spin with the machine and stake and shows the win only after the whole round', async () => {
    let spun = false
    const { user, fetchMock, queryClient } = open(state(), {
      'GET /slots': () => json(200, spun ? lines.state : state()),
      'POST /slots/spin': () => {
        spun = true
        return json(200, lines)
      },
    })
    await loaded()
    await user.click(stake('60 Silver'))
    animate()
    const times = reelTimes(scatterReels(LINES), false)
    const outcome = roundSpins(shelf, lines.spin)[0].outcome

    await user.click(spinButton())

    expect(await screen.findByRole('img', { name: 'Reels, spinning' })).toBeInTheDocument()
    expect(sentBodies(fetchMock, 'POST /slots/spin')).toEqual([{ characterId: 7, machine: 'shelf', stake: 60 }])
    expect(status()).toHaveTextContent('Good luck...')
    // A press now stops the reels: it never sends another spin.
    expect(spinButton()).toHaveTextContent('Stop')
    expect(spinButton()).toBeEnabled()
    // The stake has left the wallet; whatever was won only arrives when the round has been shown.
    expect(wallet()).toBe('5 Gold 190 Silver')
    expect(tab('The Armoury')).toBeDisabled()
    expect(tab("Tranus's Shelf")).toBeDisabled()
    expect(picker()).toBeDisabled()
    expect(stake('20 Silver')).toBeDisabled()
    // A poll that brings the new wallet in mid-spin does not give the result away.
    await poll(queryClient)
    expect(getGets(fetchMock)).toHaveLength(2)
    expect(wallet()).toBe('5 Gold 190 Silver')
    expect(lastRounds().queryAllByRole('listitem')).toHaveLength(0)

    // At full speed the reels are smeared along their run with the strongest blur, which is vertical only.
    advance(600)
    expect([0, 1, 2, 3, 4].map((reel) => strip(reel).element.style.filter)).toEqual(Array(5).fill(expect.stringContaining(STRONGEST)))
    const blur = document.querySelector(`${STRONGEST} feGaussianBlur`)
    expect(blur?.getAttribute('stdDeviation')).toMatch(/^0 [1-9]\d*$/)
    expect(document.querySelectorAll(STRONGEST)).toHaveLength(1)

    // The first reel has stopped, sharp; the others still turn and nothing is told yet.
    advance((times[0] + 0.05) * 1000 - 600)
    expect(strip(0).element.style.filter).toBe('')
    expect(strip(4).element.style.filter).toContain('slot-reel-blur')
    expect(reels()).toHaveAccessibleName('Reels, spinning')
    expect(reelSounds(calls)).toHaveLength(1)
    expect(allLit()).toEqual([])
    expect(drawnLines()).toBe(0)

    // All five have stopped: the winning tiles light and the first line is drawn. The money still waits.
    advance((times[4] - times[0]) * 1000)
    expect(reels()).toHaveAccessibleName(reelsName(LINES))
    expect(shownWindow()).toEqual(slotWindow(shelf, LINES))
    expect(allLit()).toHaveLength(wonTiles(outcome).length)
    expect(drawnLines()).toBe(1)
    expect(calls).toContain('lineWin 0')
    expect(wallet()).toBe('5 Gold 190 Silver')
    expect(status()).toHaveTextContent('Good luck...')

    playOut()

    expect(status()).toHaveTextContent(lineOf(lines.spin))
    expect(status()).toHaveTextContent(`${outcome.lines.length} lines won.`)
    expect(drawnLines()).toBe(outcome.lines.length)
    expect(allLit()).toHaveLength(wonTiles(outcome).length)
    expect(winFigure()).toBe(silverText(lines.spin.payout))
    expect(wallet()).toBe(walletText(lines.spin))
    expect(spinButton()).toHaveTextContent('Spin')
    expect(spinButton()).toBeEnabled()
    expect(tab('The Armoury')).toBeEnabled()
    expect(lastRounds().getAllByRole('listitem')[0]).toHaveTextContent(roundListLine(shelf, lines.spin))
    // The page reads the state again once the round is shown.
    await waitFor(() => expect(getGets(fetchMock)).toHaveLength(3))
  })

  it('says so when nothing was won', async () => {
    open(state(), server(lost))
    await loaded()
    fireEvent.click(stake('60 Silver'))

    fireEvent.click(spinButton())

    expect(await screen.findByRole('img', { name: reelsName(BLANK) })).toBeInTheDocument()
    await settled()
    expect(status()).toHaveTextContent('No win this time. You staked 60 Silver.')
    expect(shownWindow()).toEqual(slotWindow(shelf, BLANK))
    expect(allLit()).toEqual([])
    expect(drawnLines()).toBe(0)
    expect(winFigure()).toBeNull()
    expect(wallet()).toBe('5 Gold 190 Silver')
  })

  it('says how many lines won, and draws them', async () => {
    open(state(), server(lines))
    await loaded()
    fireEvent.click(stake('60 Silver'))

    fireEvent.click(spinButton())

    expect(await screen.findByRole('img', { name: reelsName(LINES) })).toBeInTheDocument()
    await settled()
    const outcome = roundSpins(shelf, lines.spin)[0].outcome
    expect(status()).toHaveTextContent(`${outcome.lines.length} lines won. You won ${silverText(lines.spin.payout)} on a stake of 60 Silver.`)
    // A win of the stake or more is told in bold.
    expect(within(status()).getByText(lineOf(lines.spin))).toHaveClass('font-bold')
    expect(allLit()).toHaveLength(wonTiles(outcome).length)
    expect(drawnLines()).toBe(outcome.lines.length)
    expect(winFigure()).toBe(silverText(lines.spin.payout))
    expect(wallet()).toBe(walletText(lines.spin))
  })

  it('sends one spin when Spin is pressed twice, and none while the round shows', async () => {
    const { user, fetchMock } = open(state(), { 'POST /slots/spin': () => json(200, lines) })
    await loaded()
    animate()

    fireEvent.click(spinButton())
    fireEvent.click(spinButton())
    await screen.findByRole('img', { name: 'Reels, spinning' })
    // Stops the reels; the space bar while they settle does nothing more.
    await user.click(spinButton())
    fireEvent.keyDown(document.body, { key: ' ' })
    expect(sentBodies(fetchMock, 'POST /slots/spin')).toHaveLength(1)

    // The lines are showing. A held key is not a press; a new press ends the show and sends nothing.
    run(1000)
    expect(spinButton()).toHaveTextContent('Stop')
    fireEvent.keyDown(document.body, { key: ' ', repeat: true })
    expect(spinButton()).toHaveTextContent('Stop')
    fireEvent.keyDown(document.body, { key: ' ' })
    expect(spinButton()).toHaveTextContent('Spin')
    expect(status()).toHaveTextContent(lineOf(lines.spin))
    expect(sentBodies(fetchMock, 'POST /slots/spin')).toHaveLength(1)
  })

  it('spins on the space bar, once for a held key', async () => {
    const { fetchMock } = open(state(), server(lost, lines))
    await loaded()

    fireEvent.keyDown(document.body, { key: ' ' })
    await screen.findByRole('img', { name: /^Reels: / })
    expect(sentBodies(fetchMock, 'POST /slots/spin')).toEqual([{ characterId: 7, machine: 'shelf', stake: 20 }])
    expect(await screen.findByRole('button', { name: 'Spin' })).toBeEnabled()

    // The key is still down: the browser repeats it, and that is not a new pull.
    fireEvent.keyDown(document.body, { key: ' ', repeat: true })
    expect(spinButton()).toHaveTextContent('Spin')
    expect(sentBodies(fetchMock, 'POST /slots/spin')).toHaveLength(1)

    fireEvent.keyDown(document.body, { key: ' ' })
    await screen.findByRole('img', { name: reelsName(LINES) })
    expect(sentBodies(fetchMock, 'POST /slots/spin')).toHaveLength(2)
  })

  it('does not spin on space in the character picker', async () => {
    const { fetchMock } = open(state({ characters: [mounara, moosey] }), server(lines))
    await loaded()

    fireEvent.keyDown(picker(), { key: ' ' })
    fireEvent.keyDown(stake('40 Silver'), { key: ' ' })
    fireEvent.keyDown(tab('The Armoury'), { key: ' ' })
    fireEvent.keyDown(quickSwitch(), { key: ' ' })

    expect(spinButton()).toHaveTextContent('Spin')
    expect(reels()).toHaveAccessibleName('Reels')
    expect(sentBodies(fetchMock, 'POST /slots/spin')).toEqual([])
  })

  it('keeps the old table while the spin is on its way', async () => {
    let answer: (response: Response) => void = () => {}
    let spun = false
    const { user, queryClient } = open(state(), {
      'GET /slots': () => json(200, spun ? lines.state : state()),
      // The server has bet and committed; its answer is still on the way.
      'POST /slots/spin': () => {
        spun = true
        return new Promise<Response>((resolve) => (answer = resolve))
      },
    })
    await loaded()
    await user.click(stake('60 Silver'))

    await user.click(spinButton())
    await screen.findByRole('button', { name: 'Spinning...' })
    expect(spinButton()).toBeDisabled()
    await poll(queryClient)

    // Only the stake is gone: the win the poll brought is not shown.
    expect(wallet()).toBe('5 Gold 190 Silver')
    expect(lastRounds().queryAllByRole('listitem')).toHaveLength(0)
    expect(status()).toHaveTextContent('Good luck...')
    expect(reels()).toHaveAccessibleName('Reels')
    expect(tab('The Armoury')).toBeDisabled()

    await act(async () => answer(json(200, lines)))

    expect(await screen.findByRole('img', { name: reelsName(LINES) })).toBeInTheDocument()
    expect(wallet()).toBe(walletText(lines.spin))
    expect(lastRounds().getAllByRole('listitem')).toHaveLength(1)
  })

  it('disables a stake the wallet cannot cover, and Spin when none is affordable', async () => {
    let current = state({ characters: [{ ...mounara, wallet: { gold: 0, silver: 50, copper: 0 } }] })
    const { queryClient } = open(current, { 'GET /slots': () => json(200, current) })
    await loaded()

    expect(stake('20 Silver')).toBeEnabled()
    expect(stake('40 Silver')).toBeEnabled()
    expect(stake('60 Silver')).toBeDisabled()
    expect(spinButton()).toBeEnabled()

    // Loose Bronze does not count.
    current = state({ characters: [{ ...mounara, wallet: { gold: 0, silver: 19, copper: 999 } }] })
    await poll(queryClient)

    expect(stake('20 Silver')).toBeDisabled()
    expect(stake('40 Silver')).toBeDisabled()
    expect(stake('60 Silver')).toBeDisabled()
    expect(spinButton()).toBeDisabled()
  })

  it('shows a refusal with its sound, reloads the stakes and picks the lowest when the chosen one is gone', async () => {
    let loads = 0
    const { user, fetchMock } = open(state(), {
      'GET /slots': () => json(200, ++loads === 1 ? state() : state({ machines: machines({ shelf: { stakes: [20, 60, 100] } }) })),
      'POST /slots/spin': () => json(422, { statusCode: 422, message: 'That stake is no longer offered on this machine' }),
    })
    await loaded()
    await user.click(stake('40 Silver'))

    await user.click(spinButton())

    expect(await screen.findByRole('alert')).toHaveTextContent('That stake is no longer offered on this machine')
    expect(calls).toEqual(['unlock', 'press', 'refused'])
    await waitFor(() => expect(stakeNames()).toEqual(['20 Silver', '60 Silver', '100 Silver']))
    expect(stake('20 Silver')).toBeChecked()
    expect(status()).toHaveTextContent('The stakes on this machine changed. Your stake is now 20 Silver.')
    expect(reels()).toHaveAccessibleName('Reels')
    expect(wallet()).toBe('5 Gold 250 Silver')
    expect(spinButton()).toBeEnabled()
    expect(sentBodies(fetchMock, 'POST /slots/spin')).toHaveLength(1)
  })

  it('keeps a chosen character that went into the game, and says so', async () => {
    let current = state({ characters: [mounara, busy, moosey] })
    const { user, queryClient, fetchMock } = open(current, {
      'GET /slots': () => json(200, current),
      'POST /slots/spin': () => json(200, lines),
    })
    await loaded()

    current = state({ characters: [{ ...mounara, online: true }, busy, moosey] })
    await poll(queryClient)

    expect(picker()).toHaveValue('7')
    expect(screen.getByRole('option', { name: 'Mounara (in the game, log out to play)' })).toBeDisabled()
    expect(spinButton()).toBeDisabled()
    expect(status()).toHaveTextContent('Log out of Mounara in the game to keep playing, or pick another character.')
    fireEvent.keyDown(document.body, { key: ' ' })

    await user.selectOptions(picker(), 'Moosey (level 45 Wizard)')
    expect(wallet()).toBe('900 Silver')
    expect(spinButton()).toBeEnabled()
    expect(sentBodies(fetchMock, 'POST /slots/spin')).toEqual([])
  })

  it('is closed until a GM opens the floor', async () => {
    const { fetchMock } = open(state({ live: false }))

    expect(await loaded()).toBeDisabled()
    expect(status()).toHaveTextContent('The slots are not open yet. Have a look at the machines: they open soon.')
    fireEvent.keyDown(document.body, { key: ' ' })
    expect(sentBodies(fetchMock, 'POST /slots/spin')).toEqual([])
    // The machines can still be looked at.
    expect(tab('The Armoury')).toBeEnabled()
    expect(screen.getByRole('region', { name: 'What it pays' })).toBeInTheDocument()
    expect(reels()).toHaveAccessibleName('Reels')
  })

  it('shows a closed machine as closed and lets another be played', async () => {
    localStorage.setItem('slots.machine', 'armoury')
    const { user } = open(state({ machines: machines({ armoury: { live: false } }) }), {
      'GET /slots': () => json(200, state({ machines: machines({ armoury: { live: false } }) })),
      'POST /slots/spin': () => json(200, lines),
    })
    await loaded()

    expect(tabNames()).toEqual(["Tranus's Shelf", 'The Armoury Closed', "Dragon's Hoard"])
    expect(tab('The Armoury Closed')).toHaveAttribute('aria-selected', 'true')
    expect(spinButton()).toBeDisabled()
    expect(status()).toHaveTextContent('This machine is closed. Try another one.')

    await user.click(tab("Tranus's Shelf"))
    expect(spinButton()).toBeEnabled()
    expect(status()).not.toHaveTextContent('This machine is closed.')

    await user.click(stake('60 Silver'))
    await user.click(spinButton())
    expect(await screen.findByRole('img', { name: /^Reels: / })).toBeInTheDocument()
    expect(status()).toHaveTextContent(lineOf(lines.spin))
  })

  it('still shows the result when the answer says the floor has closed', async () => {
    // The settings could not be read after the bet: the API fell back to a closed floor and no lists.
    const closed: SlotSpinResult = { ...lines, state: { ...lines.state, live: false, characters: [], mine: [] } }
    let loads = 0
    const { user } = open(state(), {
      // The page asks again, but meanwhile it must not lose the characters it had.
      'GET /slots': () => (++loads === 1 ? json(200, state()) : new Promise<Response>(() => {})),
      'POST /slots/spin': () => json(200, closed),
    })
    await loaded()
    await user.click(stake('60 Silver'))

    await user.click(spinButton())

    await screen.findByRole('img', { name: reelsName(LINES) })
    const line = lineOf(lines.spin)
    const note = 'The slots are not open yet. Have a look at the machines: they open soon.'
    expect(status()).toHaveTextContent(line)
    expect(status()).toHaveTextContent(note)
    expect(status().textContent!.indexOf(line)).toBeLessThan(status().textContent!.indexOf(note))
    expect(spinButton()).toBeDisabled()
    // The characters it had stay, with the wallet the round left, and the round is listed.
    expect(picker()).toHaveValue('7')
    expect(wallet()).toBe(walletText(lines.spin))
    expect(lastRounds().getAllByRole('listitem')).toHaveLength(1)
  })

  it('brings the reels into view when a spin starts', async () => {
    const scrolled = stubScrollIntoView()
    const { user } = open(state(), server(lines))
    await loaded()
    animate()

    await user.click(spinButton())

    const spinning = await screen.findByRole('img', { name: 'Reels, spinning' })
    expect(scrolled).toHaveBeenCalledTimes(1)
    // The cabinet down to the status line, so on a phone Spin and the result are in view with the reels.
    const shown = scrolled.mock.contexts[0] as Element
    expect(shown).toContainElement(spinning)
    expect(shown).toContainElement(screen.getByRole('radiogroup', { name: 'Stake' }))
    expect(shown).toContainElement(spinButton())
    expect(shown).toContainElement(status())
    expect(scrolled).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' })
    // On a phone the sticky header (48 px) would cover the top of the cabinet.
    expect(shown).toHaveClass('scroll-mt-14', 'md:scroll-mt-0')

    playOut()
    expect(reels()).toHaveAccessibleName(/^Reels: /)
    expect(scrolled).toHaveBeenCalledTimes(1)
  })

  it('keeps the machine while the round shows, even for an arrow key on its tab', async () => {
    const { user } = open(state(), server(lines))
    await loaded()
    await user.click(stake('60 Silver'))
    animate()
    await user.click(spinButton())
    await screen.findByRole('img', { name: 'Reels, spinning' })

    // Straight on the tab, as if it had kept the focus when it was turned off.
    fireEvent.keyDown(tab("Tranus's Shelf"), { key: 'ArrowRight' })
    fireEvent.keyDown(tab("Tranus's Shelf"), { key: 'ArrowLeft' })
    expect(tab("Tranus's Shelf")).toHaveAttribute('aria-selected', 'true')
    expect(panel()).toHaveAccessibleName("Tranus's Shelf")
    expect(localStorage.getItem('slots.machine')).toBeNull()

    playOut()
    expect(reels()).toHaveAccessibleName(reelsName(LINES))
    expect(status()).toHaveTextContent(lineOf(lines.spin))
  })

  it('does not bring back a stake the machine dropped once it is offered again', async () => {
    let current = state()
    const { user, queryClient } = open(current, { 'GET /slots': () => json(200, current) })
    await loaded()
    await user.click(stake('40 Silver'))

    current = state({ machines: machines({ shelf: { stakes: [20, 60, 100] } }) })
    await poll(queryClient)
    expect(stake('20 Silver')).toBeChecked()

    current = state()
    await poll(queryClient)
    expect(stakeNames()).toEqual(['20 Silver', '40 Silver', '60 Silver'])
    expect(stake('20 Silver')).toBeChecked()
    expect(stake('40 Silver')).not.toBeChecked()

    // Nor on the next visit.
    cleanup()
    open(state())
    await loaded()
    expect(stake('20 Silver')).toBeChecked()
  })

  describe('when a GM changes the stakes', () => {
    const PICK = 'The stakes on this machine changed. Pick a stake to keep playing.'

    it('waits for the player to pick one when every new stake is higher', async () => {
      let current = state()
      const { user, queryClient, fetchMock } = open(current, { 'GET /slots': () => json(200, current), 'POST /slots/spin': () => json(200, lost) })
      await loaded()
      expect(stake('20 Silver')).toBeChecked()

      current = state({ machines: machines({ shelf: { stakes: [100, 200, 400] } }) })
      await poll(queryClient)

      expect(stakeNames()).toEqual(['100 Silver', '200 Silver', '400 Silver'])
      for (const name of stakeNames()) expect(stake(name!)).not.toBeChecked()
      expect(spinButton()).toBeDisabled()
      expect(status()).toHaveTextContent(PICK)
      fireEvent.keyDown(document.body, { key: ' ' })
      expect(sentBodies(fetchMock, 'POST /slots/spin')).toEqual([])

      await user.click(stake('100 Silver'))
      expect(status()).not.toHaveTextContent('The stakes on this machine changed.')
      expect(spinButton()).toBeEnabled()
      await user.click(spinButton())
      await screen.findByRole('img', { name: /^Reels: / })
      expect(sentBodies(fetchMock, 'POST /slots/spin')).toEqual([{ characterId: 7, machine: 'shelf', stake: 100 }])
    })

    it('picks the new lowest, and says so, when it is no higher than the stake the player had', async () => {
      let current = state()
      const { user, queryClient } = open(current, { 'GET /slots': () => json(200, current) })
      await loaded()
      await user.click(stake('40 Silver'))

      current = state({ machines: machines({ shelf: { stakes: [20, 60, 100] } }) })
      await poll(queryClient)

      expect(stake('20 Silver')).toBeChecked()
      expect(spinButton()).toBeEnabled()
      expect(status()).toHaveTextContent('The stakes on this machine changed. Your stake is now 20 Silver.')

      // Switching machine puts the note away.
      await user.click(tab('The Armoury'))
      expect(status()).not.toHaveTextContent('The stakes on this machine changed.')
    })

    it('waits for a pick after a refusal when every new stake is higher', async () => {
      let loads = 0
      open(state(), {
        'GET /slots': () => json(200, ++loads === 1 ? state() : state({ machines: machines({ shelf: { stakes: [100, 200, 400] } }) })),
        'POST /slots/spin': () => json(422, { statusCode: 422, message: 'That stake is no longer offered on this machine' }),
      })
      await loaded()

      fireEvent.click(spinButton())

      expect(await screen.findByRole('alert')).toHaveTextContent('That stake is no longer offered on this machine')
      await waitFor(() => expect(stakeNames()).toEqual(['100 Silver', '200 Silver', '400 Silver']))
      expect(stake('100 Silver')).not.toBeChecked()
      expect(spinButton()).toBeDisabled()
      expect(status()).toHaveTextContent(PICK)
    })

    it('waits until the round has been shown, and the round keeps the stake it was sent with', async () => {
      let current = state()
      const moved = state({ machines: machines({ shelf: { stakes: [20, 40, 80] } }) })
      const { user, queryClient, fetchMock } = open(current, {
        'GET /slots': () => json(200, current),
        'POST /slots/spin': () => json(200, { ...lines, state: { ...lines.state, machines: moved.machines } }),
      })
      await loaded()
      await user.click(stake('60 Silver'))
      animate()
      await user.click(spinButton())
      await screen.findByRole('img', { name: 'Reels, spinning' })

      current = { ...moved, characters: lines.state.characters, mine: lines.state.mine }
      await poll(queryClient)
      expect(stakeNames()).toEqual(['20 Silver', '40 Silver', '60 Silver'])
      expect(stake('60 Silver')).toBeChecked()
      expect(status()).toHaveTextContent('Good luck...')

      playOut()

      expect(sentBodies(fetchMock, 'POST /slots/spin')).toEqual([{ characterId: 7, machine: 'shelf', stake: 60 }])
      expect(stake('20 Silver')).toBeChecked()
      const line = lineOf(lines.spin)
      const note = 'The stakes on this machine changed. Your stake is now 20 Silver.'
      expect(status()).toHaveTextContent(line)
      expect(status()).toHaveTextContent(note)
      expect(status().textContent!.indexOf(line)).toBeLessThan(status().textContent!.indexOf(note))
    })
  })

  it('spins on space right after a stake is clicked', async () => {
    const { user, fetchMock } = open(state(), server(lost))
    await loaded()
    await user.click(stake('40 Silver'))
    expect(stake('40 Silver')).toHaveFocus()

    await user.keyboard(' ')

    await screen.findByRole('img', { name: /^Reels: / })
    expect(sentBodies(fetchMock, 'POST /slots/spin')).toEqual([{ characterId: 7, machine: 'shelf', stake: 40 }])
  })

  it('takes the stake from the wallet at the press, and puts it back when the spin is refused', async () => {
    let answer: (response: Response) => void = () => {}
    const { user } = open(state(), {
      'POST /slots/spin': () => new Promise<Response>((resolve) => (answer = resolve)),
    })
    await loaded()
    await user.click(stake('60 Silver'))
    expect(wallet()).toBe('5 Gold 250 Silver')

    await user.click(spinButton())

    // Before the server has answered at all.
    await screen.findByRole('button', { name: 'Spinning...' })
    expect(wallet()).toBe('5 Gold 190 Silver')

    await act(async () => answer(json(422, { statusCode: 422, message: 'Not enough money in that wallet' })))

    expect(await screen.findByRole('alert')).toHaveTextContent('Not enough money in that wallet')
    expect(wallet()).toBe('5 Gold 250 Silver')
  })

  it('does not call the wallet short while the stake it just paid is in play', async () => {
    let answer: (response: Response) => void = () => {}
    const purse: Wallet = { gold: 0, silver: 70, copper: 0 }
    const { user } = open(state({ characters: [{ ...mounara, wallet: purse }] }), {
      'POST /slots/spin': () => new Promise<Response>((resolve) => (answer = resolve)),
    })
    await loaded()
    await user.click(stake('60 Silver'))

    await user.click(spinButton())
    await screen.findByRole('button', { name: 'Spinning...' })

    // 10 Silver is left, less than the stake, but that is the round in play, not a reason it cannot be played.
    expect(wallet()).toBe('10 Silver')
    expect(status()).toHaveTextContent('Good luck...')
    expect(status()).not.toHaveTextContent('Not enough money')

    await act(async () => answer(json(422, { statusCode: 422, message: 'Not enough money in that wallet' })))
    await screen.findByRole('alert')
  })

  it('says why Spin is off when the wallet is short of the stake', async () => {
    let current = state({ characters: [{ ...mounara, wallet: { gold: 0, silver: 70, copper: 0 } }] })
    const { user, queryClient } = open(current, { 'GET /slots': () => json(200, current) })
    await loaded()
    await user.click(stake('60 Silver'))
    expect(status()).not.toHaveTextContent('Not enough money')

    current = state({ characters: [{ ...mounara, wallet: { gold: 0, silver: 50, copper: 0 } }] })
    await poll(queryClient)

    expect(stake('60 Silver')).toBeChecked()
    expect(spinButton()).toBeDisabled()
    expect(status()).toHaveTextContent('Not enough money in that wallet for this stake.')
  })

  // A round with free spins runs a minute of clock, drawn step by step.
  describe('a round', { timeout: 30_000 }, () => {
    /** Eight free spins at 20 Silver: the paid spin wins nothing itself. */
    const freeSpin = () => roundOf(EIGHT, { free: FREE })

    it('holds the wallet and the pot until the whole round, free spins included, has been shown', async () => {
      const spin = freeSpin()
      const answer = result(spin, { jackpot: { ...pot, pot: 31_423 } })
      let spun = false
      const { user, queryClient } = open(state({ jackpot: pot }), {
        'GET /slots': () => json(200, spun ? answer.state : state({ jackpot: pot })),
        'POST /slots/spin': () => {
          spun = true
          return json(200, answer)
        },
      })
      await loaded()
      animate()

      await user.click(spinButton())
      await screen.findByRole('img', { name: 'Reels, spinning' })
      const held = () => {
        expect(wallet()).toBe('5 Gold 230 Silver')
        expect(within(banner()).getByText('31 Gold 420 Silver')).toBeInTheDocument()
        expect(lastRounds().queryAllByRole('listitem')).toHaveLength(0)
      }
      held()
      await poll(queryClient)
      held()

      // Through the free spins, and up to the last one: nothing of the money moves.
      run(100, held)
      for (let t = 0; t < 120_000 && !status().textContent!.includes('Free spin 8 of 8'); t += 100) {
        advance(100)
        held()
      }
      expect(status()).toHaveTextContent('Free spin 8 of 8')
      playOut()

      expect(wallet()).toBe(walletText(spin))
      expect(await within(banner()).findByText('31 Gold 423 Silver')).toBeInTheDocument()
      expect(lastRounds().getAllByRole('listitem')[0]).toHaveTextContent(roundListLine(shelf, spin))
      expect(status()).toHaveTextContent(lineOf(spin))
    })

    it('plays eight free spins by themselves after one press and sends one request', async () => {
      const spin = freeSpin()
      const { user, fetchMock } = open(state(), server(result(spin)))
      await loaded()
      animate()
      const spins = roundSpins(shelf, spin)
      const freeWon = spin.payout - spins[0].won

      await user.click(spinButton())
      await screen.findByRole('img', { name: 'Reels, spinning' })
      const told = seen(() => status().textContent)
      // Drawn over the window.
      const banners = seen(() => within(reels()).queryByText(/free spins/)?.textContent ?? null)
      const figures = seen(winFigure)
      playOut(() => {
        told.look()
        banners.look()
        figures.look()
      })

      expect(told.texts.filter((text) => text.startsWith('Free spin'))).toEqual(Array.from({ length: 8 }, (_, i) => `Free spin ${i + 1} of 8`))
      expect(told.texts[0]).toBe('Good luck...')
      expect(banners.texts).toEqual(['8 free spins. Every win is doubled.', `8 free spins won ${silverText(freeWon)}.`])
      // The Win figure goes up with each winning spin: doubled, as the round adds it.
      const runningTotals = [...new Set(spins.filter((s) => s.won > 0).map((s) => silverText(s.total)))]
      for (const total of runningTotals) expect(figures.texts).toContain(total)
      expect(status()).toHaveTextContent(lineOf(spin))
      expect(status()).toHaveTextContent(`8 free spins won you ${silverText(freeWon)}. You won ${silverText(spin.payout)} in all on a stake of 20 Silver.`)
      expect(reels()).toHaveAccessibleName(reelsName(FREE[7]))
      expect(winFigure()).toBe(silverText(spin.payout))
      expect(sentBodies(fetchMock, 'POST /slots/spin')).toHaveLength(1)
      expect(calls.filter((call) => call === 'spinning true')).toHaveLength(9)
      expect(calls.filter((call) => call === 'freeStart')).toHaveLength(1)
      expect(calls.filter((call) => call === 'freeEnd')).toHaveLength(1)
      // No suspense in a free spin, whatever its scatters.
      expect(calls.filter((call) => call === 'suspense true')).toHaveLength(1)
    })

    it('a press while the reels turn stops them and sends nothing', async () => {
      const { user, fetchMock } = open(state(), server(lines))
      await loaded()
      await user.click(stake('60 Silver'))
      animate()

      await user.click(spinButton())
      await screen.findByRole('img', { name: 'Reels, spinning' })
      advance(600)
      expect(reelSounds(calls)).toEqual([])

      fireEvent.click(spinButton())
      // They settle onto their stops (0.18 s) and only then land, each with its sound.
      advance(100)
      expect(reels()).toHaveAccessibleName('Reels, spinning')
      expect(reelSounds(calls)).toEqual([])
      advance(120)
      expect(reels()).toHaveAccessibleName(reelsName(LINES))
      expect(reelSounds(calls)).toHaveLength(5)
      expect(sentBodies(fetchMock, 'POST /slots/spin')).toHaveLength(1)

      playOut()
      expect(status()).toHaveTextContent(lineOf(lines.spin))
      expect(sentBodies(fetchMock, 'POST /slots/spin')).toHaveLength(1)
    })

    it('a press during a celebration ends it and sends nothing', async () => {
      const big = result(roundOf(BIG))
      const { user, fetchMock } = open(state(), server(big))
      await loaded()
      animate()

      await user.click(spinButton())
      await screen.findByRole('img', { name: 'Reels, spinning' })
      for (let t = 0; t < 20_000 && !screen.queryByText('Big win'); t += 100) advance(100)
      expect(screen.getByText('Big win')).toBeInTheDocument()
      expect(calls).toContain('bigWin')
      expect(wallet()).toBe('5 Gold 230 Silver')

      fireEvent.keyDown(document.body, { key: ' ' })

      expect(screen.queryByText('Big win')).not.toBeInTheDocument()
      expect(calls[calls.length - 1]).toBe('stop')
      expect(spinButton()).toHaveTextContent('Spin')
      expect(status()).toHaveTextContent(lineOf(big.spin))
      expect(winFigure()).toBe(silverText(big.spin.payout))
      expect(wallet()).toBe(walletText(big.spin))
      expect(sentBodies(fetchMock, 'POST /slots/spin')).toHaveLength(1)
      // Nothing of it comes back afterwards.
      const after = calls.length
      run(6000)
      expect(calls).toHaveLength(after)
      expect(vi.getTimerCount()).toBe(0)
    })

    it('Skip to the total ends the free spins at once with the right wallet', async () => {
      const spin = freeSpin()
      const { user, fetchMock } = open(state(), server(result(spin)))
      await loaded()
      animate()

      await user.click(spinButton())
      await screen.findByRole('img', { name: 'Reels, spinning' })
      expect(skipButton()).toBeNull()
      // Offered from the banner on.
      for (let t = 0; t < 20_000 && !skipButton(); t += 100) advance(100)
      expect(within(reels()).getByText('8 free spins. Every win is doubled.')).toBeInTheDocument()
      for (let t = 0; t < 20_000 && !status().textContent!.includes('Free spin 3 of 8'); t += 100) advance(100)
      expect(skipButton()).toBeInTheDocument()

      fireEvent.click(skipButton()!)

      expect(skipButton()).toBeNull()
      expect(status()).toHaveTextContent(lineOf(spin))
      expect(wallet()).toBe(walletText(spin))
      expect(reels()).toHaveAccessibleName(reelsName(FREE[7]))
      expect(winFigure()).toBe(silverText(spin.payout))
      expect(spinButton()).toHaveTextContent('Spin')
      const after = calls.length
      run(10_000)
      expect(calls).toHaveLength(after)
      expect(vi.getTimerCount()).toBe(0)
      expect(sentBodies(fetchMock, 'POST /slots/spin')).toHaveLength(1)
    })

    it('stops offering Skip once the last free spin has stopped', async () => {
      const { user } = open(state(), server(result(freeSpin())))
      await loaded()
      animate()

      await user.click(spinButton())
      await screen.findByRole('img', { name: 'Reels, spinning' })
      for (let t = 0; t < 120_000 && !status().textContent!.includes('Free spin 8 of 8'); t += 100) advance(100)
      expect(skipButton()).toBeInTheDocument()
      for (let t = 0; t < 20_000 && reels().getAttribute('aria-label') === 'Reels, spinning'; t += 100) advance(100)
      expect(skipButton()).toBeNull()
      playOut()
    })

    it('a win below the stake gets the small tick and no win sound or overlay', async () => {
      const small = result(roundOf(SMALL))
      expect(winTier(small.spin.payout, 20)).toBe('small')
      const { user } = open(state(), server(small))
      await loaded()
      animate()

      await user.click(spinButton())
      await screen.findByRole('img', { name: 'Reels, spinning' })
      const overlays = seen(() => screen.queryByText(/^(Big|Huge) win$/)?.textContent ?? null)
      playOut(overlays.look)

      expect(calls.filter((call) => call === 'smallWin')).toHaveLength(1)
      expect(calls.filter((call) => WIN_SOUNDS.includes(call.split(' ')[0]))).toEqual([])
      expect(overlays.texts).toEqual([])
      // Shown plainly: its lines and its amount, and the line not in bold.
      expect(drawnLines()).toBe(roundSpins(shelf, small.spin)[0].outcome.lines.length)
      expect(winFigure()).toBe(silverText(small.spin.payout))
      expect(status()).toHaveTextContent(lineOf(small.spin))
      expect(within(status()).getByText(lineOf(small.spin))).not.toHaveClass('font-bold')
    })

    it('a win of ten times the stake shows Big win; fifty times shows Huge win', async () => {
      const big = result(roundOf(BIG))
      const huge = result(roundOf(HUGE))
      expect(winTier(big.spin.payout, 20)).toBe('big')
      expect(winTier(huge.spin.payout, 20)).toBe('huge')
      const { user } = open(state(), server(big, huge))
      await loaded()
      animate()

      await user.click(spinButton())
      await screen.findByRole('img', { name: 'Reels, spinning' })
      let overlays = seen(() => screen.queryByText(/^(Big|Huge) win$/)?.textContent ?? null)
      playOut(overlays.look)
      expect(overlays.texts).toEqual(['Big win'])
      expect(calls).toContain('bigWin')
      expect(calls).not.toContain('hugeWin')
      // The count ticks while the figure moves, but never more than about 12 a second.
      const ticks = calls.filter((call) => call === 'count').length
      expect(ticks).toBeGreaterThan(5)
      expect(ticks).toBeLessThanOrEqual(3 * 12 + 1)
      expect(screen.queryByText('Big win')).not.toBeInTheDocument()

      calls.length = 0
      await user.click(spinButton())
      await screen.findByRole('img', { name: 'Reels, spinning' })
      overlays = seen(() => screen.queryByText(/^(Big|Huge) win$/)?.textContent ?? null)
      playOut(overlays.look)
      expect(overlays.texts).toEqual(['Huge win'])
      expect(calls).toContain('hugeWin')
      expect(calls).not.toContain('bigWin')
      expect(status()).toHaveTextContent(lineOf(huge.spin))
    })

    it('sounds each reel as it stops, a scatter instead where one landed, and never before its reel has stopped', async () => {
      const { user } = open(state(), server(result(roundOf(SCATTERS_1_4))))
      await loaded()
      animate()
      const times = reelTimes(scatterReels(SCATTERS_1_4), false)

      await user.click(spinButton())
      await screen.findByRole('img', { name: 'Reels, spinning' })
      expect(calls).toEqual(['unlock', 'press', 'spinning true'])
      let now = 0
      const to = (seconds: number) => {
        advance(seconds * 1000 - now)
        now = seconds * 1000
      }
      times.forEach((time, reel) => {
        to(time - 0.05)
        expect(reelSounds(calls)).toHaveLength(reel)
        to(time + 0.05)
        expect(reelSounds(calls)).toHaveLength(reel + 1)
      })

      // The scatters climb: the second is a step higher than the first.
      expect(reelSounds(calls)).toEqual(['scatter 0', 'reelStop', 'reelStop', 'scatter 1', 'reelStop'])
      playOut()
    })

    it('runs the suspense sound only while a reel turns after two scatters are showing', async () => {
      const { user } = open(state(), server(result(roundOf(SCATTERS_1_2))))
      await loaded()
      animate()
      const times = reelTimes([true, true, false, false, false], false)

      await user.click(spinButton())
      await screen.findByRole('img', { name: 'Reels, spinning' })
      advance((times[1] - 0.05) * 1000)
      expect(calls).not.toContain('suspense true')
      advance(100)
      expect(calls).toContain('suspense true')
      advance((times[4] - times[1] - 0.1) * 1000)
      expect(calls).not.toContain('suspense false')
      advance(100)

      expect(calls).toEqual([
        'unlock',
        'press',
        'spinning true',
        'scatter 0',
        'scatter 1',
        'suspense true',
        'reelStop',
        'reelStop',
        'reelStop',
        'suspense false',
        'spinning false',
      ])
      playOut()
    })

    it('calls no sound before the first press', async () => {
      const { user, queryClient } = open(state({ jackpot: pot }), server(lines))
      await loaded()
      await user.click(stake('40 Silver'))
      await poll(queryClient)
      fireEvent.keyDown(picker(), { key: ' ' })
      expect(calls).toEqual([])

      await user.click(spinButton())
      await screen.findByRole('img', { name: /^Reels: / })
      expect(calls.slice(0, 2)).toEqual(['unlock', 'press'])
    })

    it('the Sound switch mutes and is remembered; Quick spin halves the reel times and is remembered', async () => {
      // The real engine, which remembers its switch itself. jsdom has no sound generator, so it stays silent.
      setSlotSoundsForTest(null)
      const first = open(state(), server(lost))
      await loaded()
      expect(soundSwitch()).toHaveAttribute('aria-pressed', 'true')
      await first.user.click(soundSwitch())
      expect(soundSwitch()).toHaveAttribute('aria-pressed', 'false')
      expect(localStorage.getItem('slots.sound')).toBe('off')
      await first.user.click(quickSwitch())
      expect(quickSwitch()).toHaveAttribute('aria-pressed', 'true')
      expect(localStorage.getItem('slots.quick')).toBe('on')

      cleanup()
      const { user } = open(state(), server(lost))
      await loaded()
      expect(soundSwitch()).toHaveAttribute('aria-pressed', 'false')
      expect(quickSwitch()).toHaveAttribute('aria-pressed', 'true')

      animate()
      const quick = reelTimes(scatterReels(BLANK), true)
      expect(quick[4]).toBeCloseTo(reelTimes(scatterReels(BLANK), false)[4] / 2, 6)
      await user.click(spinButton())
      await screen.findByRole('img', { name: 'Reels, spinning' })
      advance((quick[4] - 0.05) * 1000)
      expect(reels()).toHaveAccessibleName('Reels, spinning')
      advance(100)
      expect(reels()).toHaveAccessibleName(reelsName(BLANK))
      playOut()

      // Switched off again, it is remembered as off.
      await user.click(quickSwitch())
      expect(localStorage.getItem('slots.quick')).toBe('off')
    })

    it('with reduce motion the round is shown at once with one sound', async () => {
      const spin = freeSpin()
      const { user } = open(state(), server(result(spin), lost))
      await loaded()
      const tier = winTier(spin.payout, 20)
      const sound = { none: [], small: ['smallWin'], win: ['win'], big: ['bigWin'], huge: ['hugeWin'] }[tier]

      await user.click(spinButton())

      expect(await within(status()).findByText(lineOf(spin))).toBeInTheDocument()
      expect(calls).toEqual(['unlock', 'press', ...sound])
      // The reels show the last free spin, with its lines; the line says the rest.
      expect(reels()).toHaveAccessibleName(reelsName(FREE[7]))
      expect(winFigure()).toBe(silverText(spin.payout))
      expect(within(reels()).queryByText(/free spins/)).not.toBeInTheDocument()
      expect(skipButton()).toBeNull()

      // A lost round has no sound of its own.
      calls.length = 0
      await user.click(spinButton())
      expect(await within(status()).findByText(lineOf(lost.spin))).toBeInTheDocument()
      expect(calls).toEqual(['unlock', 'press'])
      expect(winFigure()).toBeNull()
    })

    it('leaving the page mid-round stops the sound and sets nothing afterwards', async () => {
      const errors = vi.spyOn(console, 'error')
      const { user } = open(state(), server(result(freeSpin())))
      await loaded()
      animate()
      await user.click(spinButton())
      await screen.findByRole('img', { name: 'Reels, spinning' })
      for (let t = 0; t < 60_000 && !status().textContent!.includes('Free spin 2 of 8'); t += 100) advance(100)
      expect(vi.getTimerCount()).toBeGreaterThan(0)

      cleanup()

      expect(calls[calls.length - 1]).toBe('stop')
      // Nothing is left waiting for the next frame.
      expect(vi.getTimerCount()).toBe(0)
      const after = calls.length
      vi.advanceTimersByTime(60_000)
      expect(calls).toHaveLength(after)
      expect(errors).not.toHaveBeenCalled()
    })

    it('chimes no line until the running total has reached the stake, and from that spin on', async () => {
      // The paid spin's own lines pay less than the stake; the second free spin takes the round past it.
      const free = [BLANK, LINES, BLANK, LINES, BLANK, BLANK, BLANK, BLANK]
      const spin = roundOf(EIGHT_SMALL, { free })
      const spins = roundSpins(shelf, spin)
      expect(spins[0].won).toBeGreaterThan(0)
      expect(spins[1].total).toBeLessThan(20)
      expect(spins[2].total).toBeGreaterThanOrEqual(20)
      const { user } = open(state(), server(result(spin)))
      await loaded()
      animate()

      await user.click(spinButton())
      await screen.findByRole('img', { name: 'Reels, spinning' })
      const cheers = () => calls.filter((call) => call.startsWith('lineWin') || call === 'count')
      // Up to free spin 2 coming to rest, nothing cheers, though the paid spin's lines are drawn.
      let drewLines = false
      for (let t = 0; t < 60_000 && !(status().textContent === 'Free spin 2 of 8' && reels().getAttribute('aria-label') !== 'Reels, spinning'); t += 50) {
        advance(50)
        drewLines ||= drawnLines() > 0
        if (status().textContent !== 'Free spin 2 of 8' || reels().getAttribute('aria-label') === 'Reels, spinning') expect(cheers()).toEqual([])
      }
      expect(drewLines).toBe(true)
      expect(status()).toHaveTextContent('Free spin 2 of 8')
      expect(calls).toContain('lineWin 0')
      playOut()
      // The fourth free spin's lines chime too.
      expect(calls.filter((call) => call === 'lineWin 0').length).toBe(2)
    })

    it('a round with free spins that stays below the stake gets only the small tick', async () => {
      const spin = roundOf(EIGHT, { free: [TINY, BLANK, BLANK, BLANK, BLANK, BLANK, BLANK, BLANK] })
      expect(winTier(spin.payout, 20)).toBe('small')
      const { user } = open(state(), server(result(spin)))
      await loaded()
      animate()

      await user.click(spinButton())
      await screen.findByRole('img', { name: 'Reels, spinning' })
      const banners = seen(() => within(reels()).queryByText(/free spins/)?.textContent ?? null)
      playOut(banners.look)

      expect(banners.texts).toContain(`8 free spins won ${silverText(spin.payout)}.`)
      expect(calls.filter((call) => WIN_SOUNDS.includes(call.split(' ')[0]))).toEqual([])
      // The closing banner says it plainly, without its cadence.
      expect(calls).not.toContain('freeEnd')
      expect(calls.filter((call) => call === 'smallWin')).toHaveLength(1)
      expect(calls[calls.length - 1]).toBe('smallWin')
    })

    it('free spins that win nothing close without a sound; ones that win the stake close with one', async () => {
      const nothing = roundOf(EIGHT, { free: Array<SlotStops>(8).fill(BLANK) })
      const { user } = open(state(), server(result(nothing), result(freeSpin())))
      await loaded()
      animate()

      await user.click(spinButton())
      await screen.findByRole('img', { name: 'Reels, spinning' })
      const banners = seen(() => within(reels()).queryByText(/free spins/)?.textContent ?? null)
      playOut(banners.look)
      expect(banners.texts).toContain('8 free spins won nothing.')
      expect(calls).toContain('freeStart')
      expect(calls).not.toContain('freeEnd')
      expect(status()).toHaveTextContent('8 free spins won you nothing. You staked 20 Silver.')

      calls.length = 0
      advance(500)
      await user.click(spinButton())
      await screen.findByRole('img', { name: 'Reels, spinning' })
      playOut()
      expect(calls.filter((call) => call === 'freeEnd')).toHaveLength(1)
    })

    describe('a press that ends a round', () => {
      it('during Big win, two clicks on Spin send one spin in all', async () => {
        const { user, fetchMock } = open(state(), server(result(roundOf(BIG))))
        await loaded()
        animate()
        await user.click(spinButton())
        await screen.findByRole('img', { name: 'Reels, spinning' })
        for (let t = 0; t < 20_000 && !screen.queryByText('Big win'); t += 100) advance(100)
        expect(screen.getByText('Big win')).toBeInTheDocument()

        fireEvent.click(spinButton())
        expect(spinButton()).toHaveTextContent('Spin')
        fireEvent.click(spinButton())
        advance(100)
        fireEvent.click(spinButton())

        expect(spinButton()).toHaveTextContent('Spin')
        expect(reels()).toHaveAccessibleName(reelsName(BIG))
        expect(sentBodies(fetchMock, 'POST /slots/spin')).toHaveLength(1)
      })

      it("during a lone paid spin's lines, two space presses send one spin in all; after 400 ms a press sends the next", async () => {
        const { fetchMock } = open(state(), server(lines, lost))
        await loaded()
        animate()
        fireEvent.keyDown(document.body, { key: ' ' })
        await screen.findByRole('img', { name: 'Reels, spinning' })
        advance(reelTimes(scatterReels(LINES), false)[4] * 1000 + 100)
        expect(drawnLines()).toBe(1)

        fireEvent.keyDown(document.body, { key: ' ' })
        expect(status()).toHaveTextContent(lineOf(lines.spin))
        fireEvent.keyDown(document.body, { key: ' ' })
        advance(350)
        fireEvent.keyDown(document.body, { key: ' ' })
        expect(spinButton()).toHaveTextContent('Spin')
        expect(sentBodies(fetchMock, 'POST /slots/spin')).toHaveLength(1)

        // The pause is over: a press is a new round.
        advance(100)
        fireEvent.keyDown(document.body, { key: ' ' })
        await screen.findByRole('img', { name: 'Reels, spinning' })
        expect(sentBodies(fetchMock, 'POST /slots/spin')).toHaveLength(2)
        playOut()
      })

      it('a click on Skip to the total followed at once by a click on Spin sends nothing', async () => {
        const spin = freeSpin()
        const { user, fetchMock } = open(state(), server(result(spin)))
        await loaded()
        animate()
        await user.click(spinButton())
        await screen.findByRole('img', { name: 'Reels, spinning' })
        for (let t = 0; t < 20_000 && !skipButton(); t += 100) advance(100)

        fireEvent.click(skipButton()!)
        fireEvent.click(spinButton())

        expect(spinButton()).toHaveTextContent('Spin')
        expect(status()).toHaveTextContent(lineOf(spin))
        expect(reels()).toHaveAccessibleName(reelsName(FREE[7]))
        expect(sentBodies(fetchMock, 'POST /slots/spin')).toHaveLength(1)
      })

      it('a round that ends by itself leaves Spin ready at once', async () => {
        const { user, fetchMock } = open(state(), server(lost, lines))
        await loaded()
        animate()
        await user.click(spinButton())
        await screen.findByRole('img', { name: 'Reels, spinning' })
        playOut()

        fireEvent.click(spinButton())
        await screen.findByRole('img', { name: 'Reels, spinning' })
        expect(sentBodies(fetchMock, 'POST /slots/spin')).toHaveLength(2)
        playOut()
      })
    })
  })

  it('says each round in the lists, with its free spins', async () => {
    const free = roundOf(EIGHT, { id: 99, free: FREE })
    const mine = [free, ...Array.from({ length: 11 }, (_, i) => roundOf(i === 0 ? LINES : BLANK, { id: 98 - i, stake: 60 }))]
    mine[2] = { ...mine[2], machine: 'retired' as SlotSpinView['machine'] }
    const armoury = SLOT_MACHINES[1]
    const bigWins = [
      { ...roundOf(BLANK, { id: 90, character: 'Kael', machine: 'armoury', stake: 40, at: '2026-11-13T23:59:00.000Z' }), payout: 12_500 },
      roundOf(BLANK, { id: 89, character: 'Mounara', stake: 60, jackpot: 50_002 }),
      { ...roundOf(BLANK, { id: 88, character: 'Kael', machine: 'retired' as SlotSpinView['machine'] }), payout: 99_000 },
    ]
    open(state({ mine, bigWins }))
    await loaded()

    const last = lastRounds().getAllByRole('listitem')
    expect(last).toHaveLength(10)
    expect(last[0].firstElementChild).toHaveTextContent(roundListLine(shelf, free))
    expect(last[0].firstElementChild).toHaveTextContent(/with 8 free spins$/)
    expect(last[0]).toHaveTextContent('14 Nov, 10:05')
    expect(last[1].firstElementChild).toHaveTextContent(`Tranus's Shelf: staked 60 Silver, won ${silverText(mine[1].payout)}`)
    // The retired machine's round is left out.
    expect(last[2].firstElementChild).toHaveTextContent("Tranus's Shelf: staked 60 Silver, won nothing")

    const big = within(screen.getByRole('region', { name: 'Big wins' })).getAllByRole('listitem')
    expect(big).toHaveLength(2)
    expect(big[0]).toHaveTextContent(`Kael won 12 Gold 500 Silver on ${armoury.name}`)
    expect(big[0]).toHaveTextContent('13 Nov, 23:59')
    expect(big[1]).toHaveTextContent('Mounara won the jackpot, 50 Gold 2 Silver')
  })

  it('says so when there are no rounds yet', async () => {
    open()
    await loaded()
    expect(lastRounds().getByText('You have not played yet.')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Big wins' })).getByText('Nobody has had a big win yet.')).toBeInTheDocument()
  })

  describe('the jackpot', () => {
    it('shows the jackpot above the machines', async () => {
      open(state({ jackpot: pot }))
      await loaded()

      const region = within(banner())
      expect(region.getByText('31 Gold 420 Silver')).toBeInTheDocument()
      expect(region.getByText('Must be won before 50 Gold')).toBeInTheDocument()
      expect(region.getByText('Every lost round adds to it, on any machine. It can drop from 5 Gold.')).toBeInTheDocument()
      expect(region.getByText('Last won by Moosey: 27 Gold 310 Silver.')).toBeInTheDocument()
      const bar = region.getByRole('progressbar', { name: 'Jackpot' })
      expect(bar).toHaveAttribute('aria-valuenow', '31420')
      expect(bar).toHaveAttribute('aria-valuemin', '0')
      expect(bar).toHaveAttribute('aria-valuemax', '50000')
      // Above the machines; on a phone the long lines go and it is drawn under the machine, so that Spin stays on the
      // first screen.
      expect(banner().compareDocumentPosition(screen.getByRole('tablist', { name: 'Machine' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(banner()).toHaveClass('order-1', 'sm:order-none')
      expect(region.getByText(/^Every lost round adds/)).toHaveClass('hidden', 'sm:block')
      expect(region.getByText(/^Last won by/)).toHaveClass('hidden', 'sm:block')
    })

    it('has no banner when the jackpot cannot be read', async () => {
      open(state({ jackpot: null }))
      await loaded()

      expect(screen.queryByRole('region', { name: 'Jackpot' })).not.toBeInTheDocument()
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
      expect(pays().queryByText(/jackpot/)).not.toBeInTheDocument()
    })

    it('says the jackpot is paused', async () => {
      open(state({ jackpot: { ...pot, live: false } }))
      await loaded()

      expect(within(banner()).getByText('The jackpot is paused.')).toBeInTheDocument()
      expect(within(banner()).queryByText(/Must be won before/)).not.toBeInTheDocument()
      expect(pays().queryByText(/jackpot/)).not.toBeInTheDocument()
    })

    it('shows an unfed pot as 0 Silver under the cap set', async () => {
      open(state({ jackpot: { ...pot, pot: 0, last: null } }))
      await loaded()

      expect(within(banner()).getByText('0 Silver')).toBeInTheDocument()
      expect(within(banner()).getByText('Must be won before 50 Gold')).toBeInTheDocument()
      expect(within(banner()).queryByText(/Last won by/)).not.toBeInTheDocument()
    })

    it('never shows the bar past full', async () => {
      open(state({ jackpot: { ...pot, pot: 60_000 } }))
      await loaded()

      expect(within(banner()).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50000')
    })

    it('follows a pot someone else won between two polls', async () => {
      let current = state({ jackpot: pot })
      const { user, queryClient } = open(current, { 'GET /slots': () => json(200, current), 'POST /slots/spin': () => json(200, lost) })
      await loaded()

      current = state({ jackpot: dropped })
      await poll(queryClient)

      expect(within(banner()).getByText('0 Silver')).toBeInTheDocument()
      expect(within(banner()).getByText('Last won by Mounara: 50 Gold 2 Silver.')).toBeInTheDocument()
      await user.click(spinButton())
      expect(await screen.findByRole('img', { name: /^Reels: / })).toBeInTheDocument()
    })

    it('holds the pot still until the round has been shown, on a lost round', async () => {
      const grown = { ...lost, state: { ...lost.state, jackpot: { ...pot, pot: 31_423 } } }
      let spun = false
      const { user } = open(state({ jackpot: pot }), {
        'GET /slots': () => json(200, spun ? grown.state : state({ jackpot: pot })),
        'POST /slots/spin': () => {
          spun = true
          return json(200, grown)
        },
      })
      await loaded()
      animate()

      await user.click(spinButton())
      await screen.findByRole('img', { name: 'Reels, spinning' })
      expect(within(banner()).getByText('31 Gold 420 Silver')).toBeInTheDocument()

      advance(600)
      expect(within(banner()).getByText('31 Gold 420 Silver')).toBeInTheDocument()
      playOut()
      expect(await within(banner()).findByText('31 Gold 423 Silver')).toBeInTheDocument()
    })

    it('tells a jackpot only when the round has been shown, with its sound', async () => {
      let spun = false
      const { user, queryClient } = open(state({ jackpot: pot }), {
        'GET /slots': () => json(200, spun ? dropState.state : state({ jackpot: pot })),
        'POST /slots/spin': () => {
          spun = true
          return json(200, dropState)
        },
      })
      await loaded()
      await user.click(stake('60 Silver'))
      animate()

      await user.click(spinButton())
      await screen.findByRole('img', { name: 'Reels, spinning' })
      // A poll that brings the drop in mid-spin does not give it away.
      await poll(queryClient)

      expect(within(banner()).getByText('31 Gold 420 Silver')).toBeInTheDocument()
      expect(within(banner()).queryByText(/Last won by Mounara/)).not.toBeInTheDocument()
      expect(banner()).not.toHaveAttribute('data-won')
      expect(wallet()).toBe('5 Gold 190 Silver')
      expect(status()).toHaveTextContent('Good luck...')
      expect(calls).not.toContain('jackpot')

      playOut()

      expect(status()).toHaveTextContent('Jackpot. This round made it drop. You won 50 Gold 2 Silver on a stake of 60 Silver.')
      expect(calls).toContain('jackpot')
      expect(wallet()).toBe(walletText(dropSpin))
      expect(within(banner()).getByText('0 Silver')).toBeInTheDocument()
      expect(banner()).toHaveAttribute('data-won', 'true')
      expect(within(banner()).getByText('Last won by Mounara: 50 Gold 2 Silver.')).toBeInTheDocument()
    })

    it('lists a jackpot round in the last rounds and the big wins', async () => {
      open(state({ jackpot: pot, mine: [dropSpin], bigWins: [dropSpin] }))
      await loaded()

      const mine = lastRounds().getAllByRole('listitem')
      expect(mine[0].firstElementChild).toHaveTextContent(roundListLine(shelf, dropSpin))
      expect(mine[0].firstElementChild).toHaveTextContent('staked 60 Silver, won the jackpot, 50 Gold 2 Silver')
      const big = within(screen.getByRole('region', { name: 'Big wins' })).getAllByRole('listitem')
      expect(big[0]).toHaveTextContent('Mounara won the jackpot, 50 Gold 2 Silver')
    })

    it('says what a lost round adds, per machine', async () => {
      const { user } = open(state({ jackpot: pot }))
      await loaded()

      for (const machine of SLOT_MACHINES) {
        await user.click(tab(machine.name))
        const { num, den } = slotJackpotShare(machine)
        expect(pays().getByText(`A lost round on this machine adds ${((num / den) * 100).toFixed(1)}% of its stake to the jackpot. ${JACKPOT_LINE}`)).toBeInTheDocument()
      }
    })

    it('reads the state every 15 seconds', () => {
      expect(slotsQueryOptions.refetchInterval).toBe(15_000)
    })
  })
})
