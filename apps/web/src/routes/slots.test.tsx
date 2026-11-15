import { SLOT_MACHINES, SLOT_SCATTER, silverText, slotChain, slotJackpotShare, slotPaidChainPay, slotReplayRound, slotWindow } from '@4story-portal/shared'
import type {
  SlotChain,
  SlotGrid,
  SlotJackpotView,
  SlotMachine,
  SlotMachineState,
  SlotPot,
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
import { bigWinLine, roundLine, roundListLine, roundSpins, winTier, wonTiles } from '../lib/slot-round'
import type { SlotSounds } from '../lib/slot-sounds'
import { reelTimes, slotsQueryOptions, suspenseReels } from '../lib/slots'
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
  jackpots: [],
  meters: [],
  daily: { limit: 1500, played: 0 },
  ...overrides,
})

// Spins on the real Tranus's Shelf, found from its strips through its chains, so the tests hold whatever the strips are.
const where = (want: (chain: SlotChain, stops: SlotStops) => boolean) => stopsWhere(shelf, (_, stops) => want(slotChain(shelf, stops), stops), { spread: true })
/** The steps that win. */
const wins = (chain: SlotChain) => chain.steps.filter((step) => step.lines.length > 0).length
/** What a paid spin's chain pays, in line stakes: Silver at a stake of 20. */
const pays = (chain: SlotChain) => slotPaidChainPay(chain)
/** What a chain pays as a free spin that starts the free round, in line stakes. */
function freePays(chain: SlotChain) {
  let times = 2
  let sum = 0
  for (const step of chain.steps) {
    if (step.lines.length === 0) continue
    sum += step.multiple * times
    times = Math.min(times + 1, 10)
  }
  return sum
}
const scatterReels = (stops: SlotStops) => slotWindow(shelf, stops).map((rows) => rows.includes(SLOT_SCATTER))
const sameReels = (a: boolean[], b: boolean[]) => a.every((x, i) => x === b[i])
/** No line and no scatter. */
const BLANK = where((c) => pays(c) === 0 && c.scatters === 0)
/** Less than the stake. */
const SMALL = where((c) => pays(c) > 0 && pays(c) < 20 && c.scatters === 0)
/** One winning step of two lines or more, paying the stake up to ten times it. */
const LINES = where((c) => wins(c) === 1 && c.steps[0].lines.length >= 2 && pays(c) >= 20 && pays(c) < 200 && c.scatters === 0)
/** A chain of two winning steps or more, paying the stake up to ten times it. */
const CHAIN = where((c) => wins(c) >= 2 && c.steps[0].multiple >= 20 && pays(c) < 200 && c.scatters === 0)
/** A chain of three winning steps or more. */
const CHAIN3 = where((c) => wins(c) >= 3 && pays(c) < 400 && c.scatters === 0)
/** Ten to fifty times the stake. */
const BIG = where((c) => pays(c) >= 200 && pays(c) < 1000 && c.scatters === 0)
/** Fifty times the stake or more. */
const HUGE = where((c) => pays(c) >= 1000 && c.scatters === 0)
/** Three scatters and no line: 8 free spins, or a retrigger in a free spin. */
const EIGHT = where((c) => c.scatters === 3 && pays(c) === 0)
/** Three scatters, and lines of its own that pay less than the stake. */
const EIGHT_SMALL = where((c) => c.scatters === 3 && pays(c) > 0 && pays(c) < 20)
/** As a free spin, less than the stake. */
const TINY = where((c) => freePays(c) > 0 && freePays(c) < 20 && c.scatters === 0)
/** One scatter and no line: one meter point. */
const ONE_SCATTER = where((c) => pays(c) === 0 && c.scatters === 1)
/** A chain that wins, then leaves two scatters in its last window: two meter points once it has ended. */
const METER_CHAIN = where((c) => wins(c) >= 1 && c.scatters === 2)
/** Scatters on reels 1 and 4, nothing else. */
const SCATTERS_1_4 = where((c, s) => pays(c) === 0 && sameReels(scatterReels(s), [true, false, false, true, false]))
/** Scatters on reels 1 and 2, nothing else: reels 3 to 5 turn in suspense. */
const SCATTERS_1_2 = where((c, s) => pays(c) === 0 && sameReels(scatterReels(s), [true, true, false, false, false]))
/** Eight free spins: two pay well, one a little, the rest nothing. */
const FREE = [LINES, BLANK, SMALL, BLANK, BLANK, BLANK, LINES, BLANK]

let ids = 100
/** A round on Tranus's Shelf by Mounara, paying what the rules say its stops pay. */
const roundOf = (stops: SlotStops, overrides: Partial<SlotSpinView> = {}): SlotSpinView => {
  const free = overrides.free ?? []
  const meterFree = overrides.meterFree ?? []
  const meterBefore = overrides.meterBefore ?? 0
  const stake = overrides.stake ?? 20
  return {
    id: ids++,
    at: '2026-11-14T10:05:00.000Z',
    character: 'Mounara',
    machine: 'shelf',
    stops,
    free,
    meterFree,
    meterBefore,
    stake,
    payout: (slotReplayRound(shelf, { stops, free, meterFree, meterBefore }).lineStakes * stake) / 20,
    jackpot: 0,
    pots: { mini: 0, major: 0, giga: 0 },
    ...overrides,
  }
}
/** The meter a round leaves, by the rules. */
const meterAfter = (spin: SlotSpinView) => slotReplayRound(shelf, spin).meterAfter

const silverWallet = (silver: number): Wallet => ({ gold: Math.floor(silver / 1000), silver: silver % 1000, copper: 0 })
const walletAfter = (spin: SlotSpinView) => silverWallet(BEFORE - spin.stake + spin.payout + spin.jackpot)
/** Mounara's wallet as the page reads it out once the round has been shown. */
const walletText = (spin: SlotSpinView) => silverText(BEFORE - spin.stake + spin.payout + spin.jackpot)

/** What the API answers for a round by Mounara. */
const result = (spin: SlotSpinView, overrides: Partial<SlotsState> = {}): SlotSpinResult => {
  const meter = { machine: spin.machine, stake: spin.stake, points: meterAfter(spin) }
  return {
    spin,
    wallet: walletAfter(spin),
    state: state({ characters: [{ ...mounara, wallet: walletAfter(spin) }, busy], mine: [spin], meters: [meter], daily: { limit: 1500, played: 1 }, ...overrides }),
    meter,
  }
}

const lineOf = (spin: SlotSpinView) => roundLine(spin, roundSpins(shelf, spin))
const ROWS = ['top', 'middle', 'bottom']
/** The reels' name showing `grid`. */
const gridName = (grid: SlotGrid, machine: SlotMachine = shelf) =>
  `Reels: ${ROWS.map((name, row) => `${name} row ${grid.map((rows) => machine.symbols[rows[row]].name).join(', ')}`).join('; ')}`
/** The reels' name at rest on `stops`, before any step has fallen. */
const reelsName = (stops: SlotStops, machine: SlotMachine = shelf) => gridName(slotWindow(machine, stops), machine)
/** The reels' name at the end of the chain from `stops`: its last step. */
const endName = (stops: SlotStops) => gridName(slotChain(shelf, stops).steps.at(-1)!.grid)

const lost = result(roundOf(BLANK, { stake: 60 }))
const lines = result(roundOf(LINES, { stake: 60 }))

const AT = '2026-11-12T09:00:00.000Z'
/** The three pots, Mini first; `change` replaces what it names. */
const pots = (change: Partial<Record<SlotPot, Partial<SlotJackpotView>>> = {}): SlotJackpotView[] => [
  { pot: 'mini', live: true, amount: 640, cap: 1_000, floor: 100, last: null, ...change.mini },
  { pot: 'major', live: true, amount: 4_210, cap: 10_000, floor: 1_000, last: { character: 'Kael', amount: 9_870, at: AT }, ...change.major },
  { pot: 'giga', live: true, amount: 31_420, cap: 50_000, floor: 5_000, last: { character: 'Moosey', amount: 27_310, at: AT }, ...change.giga },
]
const jackpots = () => screen.getByRole('region', { name: 'Jackpots' })
const pot = (name: string) => within(jackpots()).getByRole('group', { name })
const payTable = () => within(screen.getByRole('region', { name: 'What it pays' }))
const JACKPOT_LINE = 'With the jackpot, the slots pay back everything staked, over time.'

const open = (current: SlotsState = state(), extra: Parameters<typeof mockApi>[0] = {}) => {
  const fetchMock = mockApi({ 'GET /slots': () => json(200, current), ...extra })
  return { fetchMock, ...renderRoute('/slots', { me }) }
}

/** A server that serves `first`, answers each spin in turn, and afterwards serves the state that spin left. */
function serverFrom(first: SlotsState, ...results: SlotSpinResult[]) {
  let current = first
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
const server = (...results: SlotSpinResult[]) => serverFrom(state(), ...results)

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
/** Spin ready again after the pause that follows every round, on the real clock. */
const ready = () => waitFor(() => expect(spinButton()).not.toHaveAttribute('aria-disabled'))
const tab = (name: string) => screen.getByRole('tab', { name })
const tabNames = () => within(screen.getByRole('tablist', { name: 'Machine' })).getAllByRole('tab').map((t) => t.textContent)
const stake = (name: string) => screen.getByRole('radio', { name })
const stakeNames = () =>
  within(screen.getByRole('radiogroup', { name: 'Stake' }))
    .getAllByRole('radio')
    .map((radio) => radio.getAttribute('aria-label'))
const reels = () => screen.getByRole('img', { name: /^Reels/ })
const reelsLabel = () => reels().getAttribute('aria-label')
const getGets = (fetchMock: ReturnType<typeof open>['fetchMock']) =>
  fetchMock.mock.calls.filter(([input, init]) => String(input) === '/api/slots' && !init?.method)
const quickSwitch = () => screen.getByRole('button', { name: 'Quick spin' })
const soundSwitch = () => screen.getByRole('button', { name: 'Sound' })
const skipButton = () => screen.queryByRole('button', { name: 'Skip to the total' })
const lastRounds = () => within(screen.getByRole('region', { name: 'Your last rounds' }))
/** The multiplier on the cabinet, or null when none is shown. */
const multiplier = () => within(reels()).queryByTestId('slot-multiplier')?.textContent ?? null
/** "Meter 12 / 30" */
const meterText = () => within(panel()).getByText(/^Meter \d+ \/ \d+$/).textContent
/** The banner drawn over the window, if any. */
const bannerText = () => within(reels()).queryByText(/free spins|^Meter full/)?.textContent ?? null
const roundsLeft = () => within(panel()).queryByText(/rounds? left today$/)?.textContent ?? null

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
/** "1 Gold 260 Silver" as 1260. */
const silverIn = (text: string) => {
  const gold = /(\d+) Gold/.exec(text)
  const silver = /(\d+) Silver/.exec(text)
  return Number(gold?.[1] ?? 0) * 1000 + Number(silver?.[1] ?? 0)
}

/** A reel's strip of tiles, and how far it is moved down, in rows: tile n sits at row offset + n. */
function strip(reel: number) {
  const element = screen.getByTestId(`reel-${reel}`)
  const percent = Number(/translateY\((-?[\d.e+-]+)%\)/.exec(element.style.transform)?.[1])
  return { element, offset: (percent / 100) * element.children.length }
}

/** The tile drawn in `row` (0 top, 1 middle, 2 bottom) of a reel: a step's when one is on the reels, else the strip's. */
function tileAt(reel: number, row: number): HTMLElement {
  const step = screen.queryByTestId(`step-${reel}`)
  if (step) return step.children[row] as HTMLElement
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
/** The lit tiles, on the strips and on a step. */
const allLit = () => screen.queryAllByTestId(/^(reel|step)-/).flatMap((layer) => [...layer.children].filter((tile) => (tile as HTMLElement).dataset.won))
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

/** Moves the clock until `done`, in steps of `ms`, calling `each` after every one. */
function until(done: () => boolean, each?: () => void, ms = 50) {
  for (let t = 0; t < 180_000 && !done(); t += ms) {
    advance(ms)
    each?.()
  }
  expect(done()).toBe(true)
}

/** Moves the clock until the round has been shown and Spin is back, past the pause after the round. */
function playOut(each?: () => void, ms = 200) {
  const back = () => spinButton().textContent === 'Spin' && !spinButton().hasAttribute('aria-disabled')
  for (let t = 0; t < 180_000 && !back(); t += ms) {
    advance(ms)
    each?.()
  }
  expect(spinButton()).toHaveTextContent('Spin')
  expect(spinButton()).not.toHaveAttribute('aria-disabled')
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

/** Every change of what `read` gives over a run, in order: a text seen again after another is listed again. */
function changes(read: () => string | null) {
  const texts: (string | null)[] = []
  const look = () => {
    const text = read()
    if (texts.length === 0 || texts[texts.length - 1] !== text) texts.push(text)
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
    setHidden: (hidden) => calls.push(`hidden ${hidden}`),
  }
  return { sounds, calls }
}

const reelSounds = (calls: string[]) => calls.filter((call) => call === 'reelStop' || call.startsWith('scatter'))
const WIN_SOUNDS = ['lineWin', 'win', 'bigWin', 'hugeWin', 'count']
const POT_SOUNDS = ['jackpot', 'jackpotMajor', 'jackpotMini']

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
    // The meter for this machine and stake, at its own size; far from the daily limit nothing is said of it.
    expect(meterText()).toBe(`Meter 0 / ${shelf.meterSize}`)
    expect(roundsLeft()).toBeNull()

    // At rest on the machine's rest stops, with each strip's real neighbours above and below the middle row.
    expect(reels()).toHaveAccessibleName('Reels')
    expect(shownWindow()).toEqual(slotWindow(shelf, shelf.rest))
    expect(allLit()).toEqual([])
    expect(drawnLines()).toBe(0)
    expect(multiplier()).toBeNull()

    // The pay table draws its own sentences.
    expect(payTable().getAllByRole('row')[1]).toHaveTextContent(shelf.symbols[7].name)
    expect(payTable().getByText(/^This machine pays back \d+\.\d% of what goes into it/)).toBeInTheDocument()
    expect(payTable().getByText(/^The most one paid spin can win at these stakes is/)).toBeInTheDocument()
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

  it("switches machine and shows that machine's stakes, meter and payout table", async () => {
    const meters = [
      { machine: 'shelf' as const, stake: 20, points: 4 },
      { machine: 'armoury' as const, stake: 40, points: 11 },
      { machine: 'armoury' as const, stake: 100, points: 27 },
    ]
    const { user } = open(state({ meters }))
    await loaded()
    const armoury = SLOT_MACHINES[1]
    expect(meterText()).toBe(`Meter 4 / ${shelf.meterSize}`)

    await user.click(tab('The Armoury'))

    expect(tab('The Armoury')).toHaveAttribute('aria-selected', 'true')
    expect(panel()).toHaveAccessibleName('The Armoury')
    expect(stakeNames()).toEqual(['40 Silver', '60 Silver', '100 Silver'])
    expect(stake('40 Silver')).toBeChecked()
    expect(meterText()).toBe(`Meter 11 / ${armoury.meterSize}`)
    expect(reels()).toHaveAccessibleName('Reels')
    expect(shownWindow(armoury)).toEqual(slotWindow(armoury, armoury.rest))
    // The money in the table follows the stake: the top prize for five is that many line stakes.
    const top = () => payTable().getAllByRole('row')[1]
    expect(top()).toHaveTextContent(armoury.symbols[7].name)
    expect(top()).toHaveTextContent(silverText((armoury.pays[7][2] * 40) / 20))

    // One meter for each stake.
    await user.click(stake('100 Silver'))
    expect(top()).toHaveTextContent(silverText((armoury.pays[7][2] * 100) / 20))
    expect(meterText()).toBe(`Meter 27 / ${armoury.meterSize}`)
    await user.click(stake('60 Silver'))
    expect(meterText()).toBe(`Meter 0 / ${armoury.meterSize}`)

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
    const first = roundSpins(shelf, lines.spin)[0].steps[0]

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

    // All five have stopped: the first step's winning tiles light and its first line is drawn. The money still waits.
    advance((times[4] - times[0]) * 1000)
    expect(reels()).toHaveAccessibleName(reelsName(LINES))
    expect(shownWindow()).toEqual(slotWindow(shelf, LINES))
    expect(allLit()).toHaveLength(wonTiles(first).length)
    expect(drawnLines()).toBe(1)
    expect(calls).toContain('lineWin 0')
    expect(multiplier()).toBe('x1')
    expect(wallet()).toBe('5 Gold 190 Silver')
    expect(status()).toHaveTextContent('Good luck...')

    playOut()

    expect(status()).toHaveTextContent(lineOf(lines.spin))
    expect(status()).toHaveTextContent(`${first.lines.length} lines won.`)
    // The winning tiles burst and the reels end on the step that won nothing.
    expect(reels()).toHaveAccessibleName(endName(LINES))
    expect(drawnLines()).toBe(0)
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

  it('says how many lines won, and ends on the step after them', async () => {
    open(state(), server(lines))
    await loaded()
    fireEvent.click(stake('60 Silver'))

    fireEvent.click(spinButton())

    expect(await screen.findByRole('img', { name: endName(LINES) })).toBeInTheDocument()
    await settled()
    const first = roundSpins(shelf, lines.spin)[0].steps[0]
    expect(status()).toHaveTextContent(`${first.lines.length} lines won. You won ${silverText(lines.spin.payout)} on a stake of 60 Silver.`)
    // A win of the stake or more is told in bold.
    expect(within(status()).getByText(lineOf(lines.spin))).toHaveClass('font-bold')
    expect(shownWindow()).toEqual(slotChain(shelf, LINES).steps.at(-1)!.grid)
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
    run(500)
    expect(drawnLines()).toBeGreaterThan(0)
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

    await ready()
    fireEvent.keyDown(document.body, { key: ' ' })
    await screen.findByRole('img', { name: endName(LINES) })
    expect(sentBodies(fetchMock, 'POST /slots/spin')).toHaveLength(2)
  })

  it('holding Enter on the focused Spin button is one press: the repeats send nothing and stop nothing', async () => {
    const { user, fetchMock } = open(state(), server(lost, lines))
    await loaded()
    animate()
    spinButton().focus()

    // Down, three repeats, then up: the first is a press, and starts the round.
    await user.keyboard('{Enter>4/}')
    await screen.findByRole('img', { name: 'Reels, spinning' })
    expect(sentBodies(fetchMock, 'POST /slots/spin')).toHaveLength(1)
    expect(spinButton()).toHaveTextContent('Stop')

    // While the reels turn, a repeat is not a press of Stop: the browser is told not to click.
    for (let i = 0; i < 3; i++) expect(fireEvent.keyDown(spinButton(), { key: 'Enter', repeat: true })).toBe(false)
    advance(300)
    expect(reels()).toHaveAccessibleName('Reels, spinning')
    expect(sentBodies(fetchMock, 'POST /slots/spin')).toHaveLength(1)
    playOut()
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

    expect(await screen.findByRole('img', { name: endName(LINES) })).toBeInTheDocument()
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

  it('a changed meter refusal reloads the state and the next press plays', async () => {
    let loads = 0
    let spins = 0
    const moved = state({ meters: [{ machine: 'shelf', stake: 20, points: 7 }] })
    const next = result(roundOf(BLANK, { meterBefore: 7 }))
    const { user, fetchMock } = open(state(), {
      // Another tab of the same account played the same machine and stake meanwhile.
      'GET /slots': () => json(200, ++loads === 1 ? state({ meters: [{ machine: 'shelf', stake: 20, points: 6 }] }) : moved),
      'POST /slots/spin': () =>
        spins++ === 0 ? json(409, { statusCode: 409, message: 'Your meter changed. Press Spin again.' }) : json(200, next),
    })
    await loaded()
    expect(meterText()).toBe('Meter 6 / 30')

    await user.click(spinButton())

    expect(await screen.findByRole('alert')).toHaveTextContent('Your meter changed. Press Spin again.')
    expect(calls).toEqual(['unlock', 'press', 'refused'])
    await waitFor(() => expect(meterText()).toBe('Meter 7 / 30'))
    expect(getGets(fetchMock)).toHaveLength(2)
    expect(wallet()).toBe('5 Gold 250 Silver')
    expect(reels()).toHaveAccessibleName('Reels')

    await user.click(spinButton())
    expect(await screen.findByRole('img', { name: reelsName(BLANK) })).toBeInTheDocument()
    await settled()
    expect(sentBodies(fetchMock, 'POST /slots/spin')).toHaveLength(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(status()).toHaveTextContent(lineOf(next.spin))
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

    await screen.findByRole('img', { name: endName(LINES) })
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
    expect(shown).toContainElement(screen.getByRole('progressbar', { name: 'Meter' }))
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
    expect(reels()).toHaveAccessibleName(endName(LINES))
    expect(status()).toHaveTextContent(lineOf(lines.spin))
  })

  it('shows a machine played earlier at the step its last round ended on', async () => {
    const { user } = open(state(), server(lines))
    await loaded()
    await user.click(stake('60 Silver'))
    await user.click(spinButton())
    await screen.findByRole('img', { name: endName(LINES) })
    await settled()

    await user.click(tab('The Armoury'))
    expect(reels()).toHaveAccessibleName('Reels')
    await user.click(tab("Tranus's Shelf"))
    expect(reels()).toHaveAccessibleName(endName(LINES))
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

  describe('the daily limit', () => {
    const DONE = "You have played today's 1,500 rounds. The slots open again for you tomorrow."

    it('shows rounds left near the limit and switches Spin off at 0', async () => {
      let current = state({ daily: { limit: 1500, played: 1299 } })
      const last = result(roundOf(BLANK), { daily: { limit: 1500, played: 1500 } })
      const { user, queryClient, fetchMock } = open(current, {
        'GET /slots': () => json(200, current),
        'POST /slots/spin': () => {
          current = last.state
          return json(200, last)
        },
      })
      await loaded()
      // 201 left: nothing is said yet.
      expect(roundsLeft()).toBeNull()

      current = state({ daily: { limit: 1500, played: 1300 } })
      await poll(queryClient)
      expect(roundsLeft()).toBe('200 rounds left today')
      // Under Spin.
      expect(spinButton().compareDocumentPosition(within(panel()).getByText('200 rounds left today')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

      current = state({ daily: { limit: 1500, played: 1499 } })
      await poll(queryClient)
      expect(roundsLeft()).toBe('1 round left today')
      expect(spinButton()).toBeEnabled()

      // The last round of the day plays, and then Spin is off.
      await user.click(spinButton())
      await screen.findByRole('img', { name: reelsName(BLANK) })
      await settled()
      expect(roundsLeft()).toBe('0 rounds left today')
      expect(spinButton()).toBeDisabled()
      expect(status()).toHaveTextContent(lineOf(last.spin))
      expect(status()).toHaveTextContent(DONE)
      await ready()
      fireEvent.keyDown(document.body, { key: ' ' })
      expect(sentBodies(fetchMock, 'POST /slots/spin')).toHaveLength(1)
    })

    it('a daily refusal says so, and the page then shows no rounds left and Spin off', async () => {
      let loads = 0
      const { user, fetchMock } = open(state(), {
        'GET /slots': () => json(200, ++loads === 1 ? state({ daily: { limit: 1500, played: 1499 } }) : state({ daily: { limit: 1500, played: 1500 } })),
        // Another tab played the last round first.
        'POST /slots/spin': () => json(403, { statusCode: 403, message: DONE }),
      })
      await loaded()

      await user.click(spinButton())

      expect(await screen.findByRole('alert')).toHaveTextContent(DONE)
      expect(calls).toEqual(['unlock', 'press', 'refused'])
      await waitFor(() => expect(roundsLeft()).toBe('0 rounds left today'))
      expect(spinButton()).toBeDisabled()
      // Said once, not twice.
      expect(within(panel()).getAllByText(DONE)).toHaveLength(1)
      expect(wallet()).toBe('5 Gold 250 Silver')
      expect(sentBodies(fetchMock, 'POST /slots/spin')).toHaveLength(1)
    })
  })

  // A round with free spins runs a minute of clock, drawn step by step.
  describe('a round', { timeout: 60_000 }, () => {
    /** Eight free spins at 20 Silver: the paid spin wins nothing itself. */
    const freeSpin = () => roundOf(EIGHT, { free: FREE })

    it("shows a chain step by step, each step's lines and win only once that step has landed", async () => {
      const spin = roundOf(CHAIN)
      const { user } = open(state(), server(result(spin)))
      await loaded()
      animate()
      const [paid] = roundSpins(shelf, spin)
      const names = paid.steps.map((step) => gridName(step.grid))
      expect(paid.steps.filter((step) => step.lines.length > 0).length).toBeGreaterThanOrEqual(2)

      await user.click(spinButton())
      await screen.findByRole('img', { name: 'Reels, spinning' })
      const labels = changes(reelsLabel)
      // The step on the reels: the latest whose grid has been seen.
      let landed = -1
      playOut(() => {
        labels.look()
        const label = reelsLabel()
        const k = names.indexOf(label!, Math.max(landed, 0))
        if (k >= 0) landed = k
        const figure = winFigure()
        if (label === 'Reels, spinning' || label === 'Reels, tiles falling') {
          // Between steps nothing of either is drawn.
          expect(drawnLines()).toBe(0)
          expect(allLit()).toEqual([])
        }
        if (label === 'Reels, spinning') expect(figure).toBeNull()
        if (k >= 0 && drawnLines() > 0) {
          expect(allLit()).toHaveLength(wonTiles(paid.steps[k]).length)
          expect(drawnLines()).toBeLessThanOrEqual(paid.steps[k].lines.length)
        }
        // The figure never runs ahead of the step on the reels.
        if (figure !== null) expect(silverIn(figure)).toBeLessThanOrEqual(paid.steps[Math.max(landed, 0)].total)
      }, 50)

      // The strips stop on step 1; each later step's tiles fall in before it is read.
      expect(labels.texts).toEqual(['Reels, spinning', names[0], ...names.slice(1).flatMap((name) => ['Reels, tiles falling', name])])
      expect(winFigure()).toBe(silverText(spin.payout))
      expect(status()).toHaveTextContent(lineOf(spin))
      expect(status()).toHaveTextContent(/^A chain of \d+\./)
    })

    it('shows the step multiplier on the cabinet, x1 then x2', async () => {
      const spin = roundOf(CHAIN)
      const { user } = open(state(), server(result(spin)))
      await loaded()
      animate()
      const [paid] = roundSpins(shelf, spin)
      const won = paid.steps.filter((step) => step.lines.length > 0)

      await user.click(spinButton())
      await screen.findByRole('img', { name: 'Reels, spinning' })
      expect(multiplier()).toBeNull()
      const shown = changes(multiplier)
      const names = paid.steps.map((step) => gridName(step.grid))
      let landed = -1
      playOut(() => {
        shown.look()
        const k = names.indexOf(reelsLabel()!, Math.max(landed, 0))
        if (k >= 0) landed = k
        // Each multiplier with its own step: x2 never before step 2 has landed.
        const text = multiplier()
        if (text !== null) expect(landed).toBeGreaterThanOrEqual(Number(text.slice(1)) - 1)
      }, 50)

      expect(shown.texts).toEqual([null, ...won.map((step) => `x${step.times}`), null])
      expect(shown.texts.slice(1, 3)).toEqual(['x1', 'x2'])
    })

    it("a press during a chain jumps to the end of that spin's chain with the right total", async () => {
      // A free spin's chain is cut short and the free spins go on; a lone paid spin's chain cut short ends the round.
      const free = [CHAIN3, BLANK, BLANK, BLANK, BLANK, BLANK, BLANK, BLANK]
      const freeRound = roundOf(EIGHT, { free })
      const alone = roundOf(CHAIN3)
      const { user, fetchMock } = open(state(), server(result(freeRound), result(alone)))
      await loaded()
      animate()
      const spins = roundSpins(shelf, freeRound)
      const chain = spins[1]
      expect(chain.steps.filter((step) => step.lines.length > 0).length).toBeGreaterThanOrEqual(3)

      await user.click(spinButton())
      await screen.findByRole('img', { name: 'Reels, spinning' })
      // To free spin 1's first step, its lines showing.
      until(() => status().textContent === 'Free spin 1 of 8' && reelsLabel() === gridName(chain.steps[0].grid) && drawnLines() > 0)
      fireEvent.click(spinButton())

      // Its last step at once, every step's win in the figure; the free spins carry on by themselves.
      expect(reels()).toHaveAccessibleName(gridName(chain.steps.at(-1)!.grid))
      expect(winFigure()).toBe(silverText(chain.total))
      expect(spinButton()).toHaveTextContent('Stop')
      // The multiplier climbed with every step that won, the skipped ones too.
      until(() => status().textContent === 'Free spin 2 of 8')
      const lastWin = chain.steps.filter((step) => step.lines.length > 0).at(-1)!
      expect(multiplier()).toBe(`x${Math.min(lastWin.times + 1, 10)}`)
      playOut()
      expect(winFigure()).toBe(silverText(freeRound.payout))
      expect(status()).toHaveTextContent(lineOf(freeRound))

      // A lone paid spin: the press ends the round on the chain's last step, with its whole win.
      const [paid] = roundSpins(shelf, alone)
      await user.click(spinButton())
      await screen.findByRole('img', { name: 'Reels, spinning' })
      until(() => reelsLabel() === gridName(paid.steps[0].grid) && drawnLines() > 0)
      fireEvent.click(spinButton())

      expect(reels()).toHaveAccessibleName(gridName(paid.steps.at(-1)!.grid))
      expect(spinButton()).toHaveTextContent('Spin')
      expect(winFigure()).toBe(silverText(alone.payout))
      expect(status()).toHaveTextContent(lineOf(alone))
      expect(wallet()).toBe(walletText(alone))
      expect(sentBodies(fetchMock, 'POST /slots/spin')).toHaveLength(2)
    })

    it("adds meter points only after the paid spin's chain has ended", async () => {
      const spin = roundOf(METER_CHAIN, { meterBefore: 5 })
      const [paid] = roundSpins(shelf, spin)
      expect(paid.scatters).toBe(2)
      const before = state({ meters: [{ machine: 'shelf', stake: 20, points: 5 }] })
      const { user } = open(before, serverFrom(before, result(spin)))
      await loaded()
      animate()
      expect(meterText()).toBe('Meter 5 / 30')
      const end = gridName(paid.steps.at(-1)!.grid)

      await user.click(spinButton())
      await screen.findByRole('img', { name: 'Reels, spinning' })
      const meters = seen(meterText)
      playOut(() => {
        meters.look()
        // Not at a reel's stop, nor at a step: a later step could still have brought a third scatter.
        if (calls.some((call) => call.startsWith('meterPoint')) || meterText() !== 'Meter 5 / 30') expect(reels()).toHaveAccessibleName(end)
      }, 50)

      expect(meters.texts).toEqual(['Meter 5 / 30', 'Meter 6 / 30', 'Meter 7 / 30'])
      expect(calls.filter((call) => call.startsWith('meterPoint'))).toEqual(['meterPoint 6', 'meterPoint 7'])
      expect(calls).not.toContain('meterFull')
      // Once the round has been shown, the meter is the one the server keeps.
      expect(meterText()).toBe(`Meter ${meterAfter(spin)} / 30`)
    })

    it('plays meter free spins after a full meter, with their banner', async () => {
      const meterFree = [LINES, BLANK, BLANK, BLANK, BLANK, BLANK, BLANK, BLANK]
      const spin = roundOf(ONE_SCATTER, { meterBefore: 29, meterFree })
      expect(meterAfter(spin)).toBe(0)
      const before = state({ meters: [{ machine: 'shelf', stake: 20, points: 29 }] })
      const { user, fetchMock } = open(before, serverFrom(before, result(spin)))
      await loaded()
      animate()
      const spins = roundSpins(shelf, spin)

      await user.click(spinButton())
      await screen.findByRole('img', { name: 'Reels, spinning' })
      const told = seen(() => status().textContent)
      const banners = seen(bannerText)
      const meters = seen(meterText)
      playOut(() => {
        told.look()
        banners.look()
        meters.look()
      })

      expect(banners.texts).toEqual([
        'Meter full: 8 free spins',
        '8 free spins. The multiplier climbs.',
        `8 free spins won ${silverText(spin.payout - spins[0].won)}.`,
      ])
      expect(meters.texts).toEqual(['Meter 29 / 30', 'Meter 30 / 30', 'Meter 0 / 30'])
      expect(told.texts.filter((text) => text.startsWith('Free spin'))).toEqual(Array.from({ length: 8 }, (_, i) => `Free spin ${i + 1} of 8`))
      // The meter fills, then its free spins start: each heard once, in that order.
      const meterFull = calls.indexOf('meterFull')
      expect(calls.filter((call) => call === 'meterFull')).toHaveLength(1)
      expect(calls.filter((call) => call === 'freeStart')).toHaveLength(1)
      expect(meterFull).toBeGreaterThan(calls.indexOf('meterPoint 30'))
      expect(calls.indexOf('freeStart')).toBeGreaterThan(meterFull)
      expect(calls.filter((call) => call === 'spinning true')).toHaveLength(9)
      expect(status()).toHaveTextContent(lineOf(spin))
      expect(winFigure()).toBe(silverText(spin.payout))
      expect(sentBodies(fetchMock, 'POST /slots/spin')).toHaveLength(1)
    })

    it('carries the climbing multiplier across free spins and shows a retrigger', async () => {
      // Free spin 3 shows three scatters: 5 more, 13 in all.
      const free = [CHAIN, LINES, EIGHT, ...Array<SlotStops>(10).fill(BLANK)]
      const spin = roundOf(EIGHT, { free })
      const spins = roundSpins(shelf, spin)
      expect(spins[3].added).toBe(5)
      const { user } = open(state(), server(result(spin)))
      await loaded()
      animate()

      await user.click(spinButton())
      await screen.findByRole('img', { name: 'Reels, spinning' })
      const told = seen(() => status().textContent)
      const banners = seen(bannerText)
      const shown = changes(multiplier)
      let retold = false
      playOut(() => {
        told.look()
        banners.look()
        shown.look()
        retold ||= bannerText() === '+5 free spins'
        // The spins it adds are told only with its banner.
        if (!retold) expect(status().textContent).not.toMatch(/of 13$/)
      })

      expect(banners.texts).toEqual(['8 free spins. The multiplier climbs.', '+5 free spins', `13 free spins won ${silverText(spin.payout)}.`])
      expect(told.texts.filter((text) => text.startsWith('Free spin'))).toEqual([
        'Free spin 1 of 8',
        'Free spin 2 of 8',
        'Free spin 3 of 8',
        'Free spin 3 of 13',
        ...Array.from({ length: 10 }, (_, i) => `Free spin ${i + 4} of 13`),
      ])
      expect(calls.filter((call) => call === 'retrigger')).toHaveLength(1)
      // From x2, up one after every win, carried from one free spin to the next and never back down.
      const climbed = shown.texts.filter((text): text is string => text !== null).map((text) => Number(text.slice(1)))
      expect(climbed[0]).toBe(2)
      expect(climbed).toEqual([...climbed].sort((a, b) => a - b))
      const winning = spins.slice(1).flatMap((s) => s.steps.filter((step) => step.lines.length > 0))
      expect(Math.max(...climbed)).toBe(Math.min(winning.at(-1)!.times + 1, 10))
      expect(climbed).toEqual(expect.arrayContaining(winning.map((step) => step.times)))
      expect(winFigure()).toBe(silverText(spin.payout))
      expect(status()).toHaveTextContent(lineOf(spin))
    })

    it('holds the wallet, the pots and the meter until the whole round has been shown', async () => {
      // A lost round at a meter of 3: it feeds the pots and its two scatters go into the meter.
      const spin = roundOf(SCATTERS_1_2, { meterBefore: 3 })
      expect(meterAfter(spin)).toBe(5)
      const before = state({ jackpots: pots(), meters: [{ machine: 'shelf', stake: 20, points: 3 }] })
      const answer = result(spin, { jackpots: pots({ mini: { amount: 641 }, major: { amount: 4_211 }, giga: { amount: 31_421 } }) })
      let spun = false
      const { user, queryClient } = open(before, {
        'GET /slots': () => json(200, spun ? answer.state : before),
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
        expect(within(pot('Mini')).getByText('640 Silver')).toBeInTheDocument()
        expect(within(pot('Major')).getByText('4 Gold 210 Silver')).toBeInTheDocument()
        expect(within(pot('Giga')).getByText('31 Gold 420 Silver')).toBeInTheDocument()
        expect(lastRounds().queryAllByRole('listitem')).toHaveLength(0)
      }
      held()
      await poll(queryClient)
      held()
      // The meter too, until the chain has ended: then its points arrive one by one.
      until(() => reelsLabel() !== 'Reels, spinning', () => {
        held()
        expect(meterText()).toBe('Meter 3 / 30')
      })
      playOut(() => {
        if (spinButton().textContent === 'Stop') held()
      }, 50)

      // Only now.
      await waitFor(() => expect(wallet()).toBe(walletText(spin)))
      expect(within(pot('Mini')).getByText('641 Silver')).toBeInTheDocument()
      expect(within(pot('Giga')).getByText('31 Gold 421 Silver')).toBeInTheDocument()
      expect(meterText()).toBe('Meter 5 / 30')
      expect(lastRounds().getAllByRole('listitem')[0]).toHaveTextContent(roundListLine(shelf, spin))
    })

    it('holds the wallet and the pots through free spins, up to the last one', async () => {
      const spin = freeSpin()
      const answer = result(spin, { jackpots: pots() })
      let spun = false
      const before = state({ jackpots: pots({ giga: { amount: 31_000 } }) })
      const { user, queryClient } = open(before, {
        'GET /slots': () => json(200, spun ? answer.state : before),
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
        expect(within(pot('Giga')).getByText('31 Gold')).toBeInTheDocument()
        expect(lastRounds().queryAllByRole('listitem')).toHaveLength(0)
      }
      await poll(queryClient)
      until(() => status().textContent === 'Free spin 8 of 8', held, 100)
      playOut()

      expect(wallet()).toBe(walletText(spin))
      expect(await within(pot('Giga')).findByText('31 Gold 420 Silver')).toBeInTheDocument()
      expect(lastRounds().getAllByRole('listitem')[0]).toHaveTextContent(roundListLine(shelf, spin))
      expect(status()).toHaveTextContent(lineOf(spin))
    })

    it("sounds a burst for each later step, and never before that step", async () => {
      const spin = roundOf(CHAIN3)
      const { user } = open(state(), server(result(spin), lost))
      await loaded()
      animate()
      const [paid] = roundSpins(shelf, spin)
      const names = paid.steps.map((step) => gridName(step.grid))

      await user.click(spinButton())
      await screen.findByRole('img', { name: 'Reels, spinning' })
      let landed = -1
      let bursts = 0
      playOut(() => {
        const label = reelsLabel()
        const k = names.indexOf(label!, Math.max(landed, 0))
        if (k >= 0) landed = k
        const now = calls.filter((call) => call.startsWith('burst'))
        if (now.length > bursts) {
          // Its tiles are going this moment, and the step they won in has had its lines shown.
          expect(label).toBe('Reels, tiles falling')
          expect(now).toEqual(Array.from({ length: now.length }, (_, j) => `burst ${j}`))
          expect(now.length).toBe(landed + 1)
          bursts = now.length
        }
      }, 50)

      // One for every step after the first, in order, each a step higher.
      expect(calls.filter((call) => call.startsWith('burst'))).toEqual(Array.from({ length: paid.steps.length - 1 }, (_, j) => `burst ${j}`))
      // A round that wins nothing has no step after the first, so no burst.
      calls.length = 0
      await user.click(spinButton())
      await screen.findByRole('img', { name: 'Reels, spinning' })
      playOut()
      expect(calls.filter((call) => call.startsWith('burst'))).toEqual([])
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
      const banners = seen(bannerText)
      const figures = seen(winFigure)
      playOut(() => {
        told.look()
        banners.look()
        figures.look()
      })

      expect(told.texts.filter((text) => text.startsWith('Free spin'))).toEqual(Array.from({ length: 8 }, (_, i) => `Free spin ${i + 1} of 8`))
      expect(told.texts[0]).toBe('Good luck...')
      expect(banners.texts).toEqual(['8 free spins. The multiplier climbs.', `8 free spins won ${silverText(freeWon)}.`])
      // The Win figure goes up with each winning step, as the round adds it.
      const runningTotals = [...new Set(spins.flatMap((s) => s.steps.filter((step) => step.won > 0).map((step) => silverText(step.total))))]
      for (const total of runningTotals) expect(figures.texts).toContain(total)
      expect(status()).toHaveTextContent(lineOf(spin))
      expect(status()).toHaveTextContent(`8 free spins won you ${silverText(freeWon)}. You won ${silverText(spin.payout)} in all on a stake of 20 Silver.`)
      expect(reels()).toHaveAccessibleName(endName(FREE[7]))
      expect(winFigure()).toBe(silverText(spin.payout))
      expect(sentBodies(fetchMock, 'POST /slots/spin')).toHaveLength(1)
      expect(calls.filter((call) => call === 'spinning true')).toHaveLength(9)
      expect(calls.filter((call) => call === 'freeStart')).toHaveLength(1)
      expect(calls.filter((call) => call === 'freeEnd')).toHaveLength(1)
      // No suspense in a free spin, whatever its scatters; the paid spin's only if two scatters showed before its last reel.
      expect(calls.filter((call) => call === 'suspense true')).toHaveLength(suspenseReels(scatterReels(EIGHT)).length > 0 ? 1 : 0)
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
      until(() => screen.queryByText('Big win') !== null, undefined, 100)
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
      until(() => skipButton() !== null, undefined, 100)
      expect(within(reels()).getByText('8 free spins. The multiplier climbs.')).toBeInTheDocument()
      until(() => status().textContent!.includes('Free spin 3 of 8'), undefined, 100)
      expect(skipButton()).toBeInTheDocument()

      fireEvent.click(skipButton()!)

      expect(skipButton()).toBeNull()
      expect(status()).toHaveTextContent(lineOf(spin))
      expect(wallet()).toBe(walletText(spin))
      expect(reels()).toHaveAccessibleName(endName(FREE[7]))
      expect(winFigure()).toBe(silverText(spin.payout))
      expect(multiplier()).toBeNull()
      expect(spinButton()).toHaveTextContent('Spin')
      const after = calls.length
      run(10_000)
      expect(calls).toHaveLength(after)
      expect(vi.getTimerCount()).toBe(0)
      expect(sentBodies(fetchMock, 'POST /slots/spin')).toHaveLength(1)
    })

    it('offers Skip through the last free spin and puts it away with the closing banner', async () => {
      // The last free spin wins, so its chain is shown before the closing banner.
      const { user } = open(state(), server(result(roundOf(EIGHT, { free: [...FREE.slice(0, 7), LINES] }))))
      await loaded()
      animate()

      await user.click(spinButton())
      await screen.findByRole('img', { name: 'Reels, spinning' })
      until(() => status().textContent!.includes('Free spin 8 of 8'), undefined, 100)
      // Even once the last free spin has stopped: hidden then, it would tell that no retrigger was coming.
      until(() => reelsLabel() !== 'Reels, spinning', undefined, 100)
      expect(skipButton()).toBeInTheDocument()
      until(() => bannerText()?.startsWith('8 free spins won') === true, undefined, 50)
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
      let drew = 0
      playOut(() => {
        overlays.look()
        drew = Math.max(drew, drawnLines())
      }, 50)

      expect(calls.filter((call) => call === 'smallWin')).toHaveLength(1)
      expect(calls.filter((call) => WIN_SOUNDS.includes(call.split(' ')[0]))).toEqual([])
      expect(overlays.texts).toEqual([])
      // Shown plainly: its lines and its amount, and the line not in bold.
      expect(drew).toBe(Math.max(...roundSpins(shelf, small.spin)[0].steps.map((step) => step.lines.length)))
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
      // The count ticks while the figure moves with each winning step, but never more than about 12 a second.
      const steps = roundSpins(shelf, big.spin)[0].steps.filter((step) => step.lines.length > 0).length
      const ticks = calls.filter((call) => call === 'count').length
      expect(ticks).toBeGreaterThan(steps)
      expect(ticks).toBeLessThanOrEqual(steps * (0.6 * 12 + 1))
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
      const { user, queryClient } = open(state({ jackpots: pots() }), server(lines))
      await loaded()
      await user.click(stake('40 Silver'))
      await poll(queryClient)
      fireEvent.keyDown(picker(), { key: ' ' })
      expect(calls).toEqual([])

      await user.click(spinButton())
      await screen.findByRole('img', { name: /^Reels: / })
      expect(calls.slice(0, 2)).toEqual(['unlock', 'press'])
    })

    it('the Sound switch mutes and is remembered; Quick spin halves the reel and step times and is remembered', async () => {
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
      const chain = result(roundOf(CHAIN))
      const { user } = open(state(), server(lost, chain))
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

      // A chain's step: lines at 0.3 s each, a count of 0.3 s, then a burst of 0.15 s and a fall of 0.175 s.
      const [paid] = roundSpins(shelf, chain.spin)
      const lineSeconds = Math.min(0.6, 2.4 / paid.steps[0].lines.length) * 0.5
      await user.click(spinButton())
      await screen.findByRole('img', { name: 'Reels, spinning' })
      until(() => reelsLabel() === gridName(paid.steps[0].grid), undefined, 10)
      advance((paid.steps[0].lines.length * lineSeconds + 0.3) * 1000 + 40)
      expect(reels()).toHaveAccessibleName('Reels, tiles falling')
      // Frames come every 16 ms: a little more for the frames that start and end the fall.
      advance((0.15 + 0.175) * 1000 + 50)
      expect(reels()).toHaveAccessibleName(gridName(paid.steps[1].grid))
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
      // The reels show the last free spin's last step; the line says the rest.
      expect(reels()).toHaveAccessibleName(endName(FREE[7]))
      expect(winFigure()).toBe(silverText(spin.payout))
      expect(bannerText()).toBeNull()
      expect(multiplier()).toBeNull()
      expect(skipButton()).toBeNull()

      // A lost round has no sound of its own.
      calls.length = 0
      await ready()
      await user.click(spinButton())
      expect(await within(status()).findByText(lineOf(lost.spin))).toBeInTheDocument()
      expect(calls).toEqual(['unlock', 'press'])
      expect(winFigure()).toBeNull()
    })

    it('pauses the sound while the tab is hidden, and stops listening when the page goes', async () => {
      const shown = (hidden: boolean) => {
        Object.defineProperty(document, 'hidden', { value: hidden, configurable: true })
        document.dispatchEvent(new Event('visibilitychange'))
      }
      try {
        open()
        await loaded()
        shown(true)
        expect(calls).toEqual(['hidden true'])
        shown(false)
        expect(calls).toEqual(['hidden true', 'hidden false'])

        cleanup()
        calls.length = 0
        shown(true)
        expect(calls.filter((call) => call.startsWith('hidden'))).toEqual([])
      } finally {
        delete (document as { hidden?: boolean }).hidden
      }
    })

    it('leaving the page mid-round stops the sound and sets nothing afterwards', async () => {
      const errors = vi.spyOn(console, 'error')
      const { user } = open(state(), server(result(freeSpin())))
      await loaded()
      animate()
      await user.click(spinButton())
      await screen.findByRole('img', { name: 'Reels, spinning' })
      until(() => status().textContent!.includes('Free spin 2 of 8'), undefined, 100)
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

    it('chimes no line until the running total has reached the stake, and from that step on', async () => {
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
      const atRest = () => status().textContent === 'Free spin 2 of 8' && reelsLabel() !== 'Reels, spinning'
      until(atRest, () => {
        drewLines ||= drawnLines() > 0
        if (!atRest()) expect(cheers()).toEqual([])
      })
      expect(drewLines).toBe(true)
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
      const banners = seen(bannerText)
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
      const banners = seen(bannerText)
      playOut(banners.look)
      expect(banners.texts).toContain('8 free spins won nothing.')
      expect(calls).toContain('freeStart')
      expect(calls).not.toContain('freeEnd')
      expect(status()).toHaveTextContent(lineOf(nothing))

      calls.length = 0
      advance(500)
      await user.click(spinButton())
      await screen.findByRole('img', { name: 'Reels, spinning' })
      playOut()
      expect(calls.filter((call) => call === 'freeEnd')).toHaveLength(1)
    })

    describe('a press that ends a round', () => {
      it('during Big win, two clicks on Spin send one spin in all', async () => {
        const big = result(roundOf(BIG))
        const { user, fetchMock } = open(state(), server(big))
        await loaded()
        animate()
        await user.click(spinButton())
        await screen.findByRole('img', { name: 'Reels, spinning' })
        until(() => screen.queryByText('Big win') !== null, undefined, 100)

        fireEvent.click(spinButton())
        expect(spinButton()).toHaveTextContent('Spin')
        fireEvent.click(spinButton())
        advance(100)
        fireEvent.click(spinButton())

        expect(spinButton()).toHaveTextContent('Spin')
        expect(reels()).toHaveAccessibleName(endName(BIG))
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
        expect(reels()).toHaveAccessibleName(endName(LINES))
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
        until(() => skipButton() !== null, undefined, 100)

        fireEvent.click(skipButton()!)
        fireEvent.click(spinButton())

        expect(spinButton()).toHaveTextContent('Spin')
        expect(status()).toHaveTextContent(lineOf(spin))
        expect(reels()).toHaveAccessibleName(endName(FREE[7]))
        expect(sentBodies(fetchMock, 'POST /slots/spin')).toHaveLength(1)
      })

      it('a round that ends by itself leaves Spin resting for 400 ms: a press 200 ms later sends nothing, one after sends the next', async () => {
        const { user, fetchMock } = open(state(), server(lost, lines))
        await loaded()
        animate()
        await user.click(spinButton())
        await screen.findByRole('img', { name: 'Reels, spinning' })
        // To the very frame the round ends.
        until(() => spinButton().textContent === 'Spin', undefined, 10)
        expect(spinButton()).toHaveAttribute('aria-disabled', 'true')
        // Not the native switch: the focus stays on Spin.
        expect(spinButton()).toBeEnabled()

        advance(200)
        fireEvent.click(spinButton())
        fireEvent.keyDown(document.body, { key: ' ' })
        expect(spinButton()).toHaveTextContent('Spin')
        expect(reels()).toHaveAccessibleName(reelsName(BLANK))
        expect(sentBodies(fetchMock, 'POST /slots/spin')).toHaveLength(1)

        advance(250)
        expect(spinButton()).not.toHaveAttribute('aria-disabled')
        fireEvent.click(spinButton())
        await screen.findByRole('img', { name: 'Reels, spinning' })
        expect(sentBodies(fetchMock, 'POST /slots/spin')).toHaveLength(2)
        playOut()
      })

      it('a lost round stopped while the reels turn: a second press 250 ms later sends nothing', async () => {
        const { user, fetchMock } = open(state(), server(lost, lines))
        await loaded()
        animate()
        await user.click(spinButton())
        await screen.findByRole('img', { name: 'Reels, spinning' })
        advance(300)
        expect(spinButton()).toHaveTextContent('Stop')

        // Stop only stops the reels; the lost round then ends by itself as they settle.
        fireEvent.click(spinButton())
        advance(250)
        expect(spinButton()).toHaveTextContent('Spin')
        fireEvent.click(spinButton())
        expect(reels()).toHaveAccessibleName(reelsName(BLANK))
        expect(sentBodies(fetchMock, 'POST /slots/spin')).toHaveLength(1)

        advance(400)
        fireEvent.click(spinButton())
        await screen.findByRole('img', { name: 'Reels, spinning' })
        expect(sentBodies(fetchMock, 'POST /slots/spin')).toHaveLength(2)
        playOut()
      })

      it('with reduce motion, a press just after the result sends nothing; one after 400 ms sends the next', async () => {
        const { fetchMock } = open(state(), server(lost, lines))
        await loaded()
        fireEvent.click(spinButton())
        await screen.findByRole('img', { name: reelsName(BLANK) })
        await settled()
        expect(spinButton()).toHaveAttribute('aria-disabled', 'true')

        fireEvent.click(spinButton())
        fireEvent.keyDown(document.body, { key: ' ' })
        expect(reels()).toHaveAccessibleName(reelsName(BLANK))
        expect(sentBodies(fetchMock, 'POST /slots/spin')).toHaveLength(1)

        await ready()
        fireEvent.click(spinButton())
        expect(await screen.findByRole('img', { name: endName(LINES) })).toBeInTheDocument()
        expect(sentBodies(fetchMock, 'POST /slots/spin')).toHaveLength(2)
      })

      it('leaving the page during the pause leaves no frame waiting', async () => {
        const { user } = open(state(), server(lost))
        await loaded()
        animate()
        await user.click(spinButton())
        await screen.findByRole('img', { name: 'Reels, spinning' })
        until(() => spinButton().textContent === 'Spin', undefined, 10)
        expect(spinButton()).toHaveAttribute('aria-disabled', 'true')
        expect(vi.getTimerCount()).toBeGreaterThan(0)

        cleanup()
        expect(vi.getTimerCount()).toBe(0)
      })

      it('a refused spin leaves Spin ready at once', async () => {
        let spins = 0
        const { fetchMock } = open(state(), {
          'POST /slots/spin': () => (spins++ === 0 ? json(503, { statusCode: 503, message: 'Slots are not available right now' }) : json(200, lost)),
        })
        await loaded()
        fireEvent.click(spinButton())
        await waitFor(() => expect(calls).toContain('refused'))
        await settled()
        expect(spinButton()).not.toHaveAttribute('aria-disabled')

        fireEvent.click(spinButton())
        expect(await screen.findByRole('img', { name: reelsName(BLANK) })).toBeInTheDocument()
        expect(sentBodies(fetchMock, 'POST /slots/spin')).toHaveLength(2)
      })
    })
  })

  it('says each round in the lists, with its free spins and jackpots', async () => {
    const free = roundOf(EIGHT, { id: 99, free: FREE })
    const mine = [free, ...Array.from({ length: 11 }, (_, i) => roundOf(i === 0 ? LINES : BLANK, { id: 98 - i, stake: 60 }))]
    mine[2] = { ...mine[2], machine: 'retired' as SlotSpinView['machine'] }
    const armoury = SLOT_MACHINES[1]
    const giga = roundOf(BLANK, { id: 89, character: 'Mounara', stake: 60, jackpot: 50_002, pots: { mini: 0, major: 0, giga: 50_002 } })
    const bigWins = [
      { ...roundOf(BLANK, { id: 90, character: 'Kael', machine: 'armoury', stake: 40, at: '2026-11-13T23:59:00.000Z' }), payout: 12_500 },
      giga,
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
    expect(big[0].firstElementChild).toHaveTextContent(`Kael won 12 Gold 500 Silver on ${armoury.name} on a stake of 40 Silver`)
    expect(big[0].firstElementChild?.textContent).toBe(bigWinLine(armoury, bigWins[0]))
    expect(big[0]).toHaveTextContent('13 Nov, 23:59')
    expect(big[1].firstElementChild?.textContent).toBe(bigWinLine(shelf, giga))
    expect(big[1]).toHaveTextContent('Mounara won the Giga jackpot, 50 Gold 2 Silver')
  })

  it('says so when there are no rounds yet', async () => {
    open()
    await loaded()
    expect(lastRounds().getByText('You have not played yet.')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Big wins' })).getByText('Nobody has had a big win yet.')).toBeInTheDocument()
  })

  describe('the jackpots', () => {
    it('shows three jackpots above the machines, each with its pot, its cap and its last winner', async () => {
      open(state({ jackpots: pots() }))
      await loaded()

      expect(within(jackpots()).getAllByRole('group').map((group) => group.getAttribute('aria-label'))).toEqual(['Mini', 'Major', 'Giga'])
      const mini = within(pot('Mini'))
      expect(mini.getByText('640 Silver')).toBeInTheDocument()
      expect(mini.getByText('must drop before 1 Gold')).toBeInTheDocument()
      expect(mini.queryByText(/Last won by/)).not.toBeInTheDocument()
      const giga = within(pot('Giga'))
      expect(giga.getByText('31 Gold 420 Silver')).toBeInTheDocument()
      expect(giga.getByText('must drop before 50 Gold')).toBeInTheDocument()
      expect(giga.getByText('Last won by Moosey: 27 Gold 310 Silver.')).toBeInTheDocument()
      expect(within(pot('Major')).getByText('Last won by Kael: 9 Gold 870 Silver.')).toBeInTheDocument()
      const bar = giga.getByRole('progressbar', { name: 'Giga jackpot' })
      expect(bar).toHaveAttribute('aria-valuenow', '31420')
      expect(bar).toHaveAttribute('aria-valuemin', '0')
      expect(bar).toHaveAttribute('aria-valuemax', '50000')
      // Above the machines; on a phone the three sit in one row under the machine, so that Spin stays on the first
      // screen, and the last winners go.
      expect(jackpots().compareDocumentPosition(screen.getByRole('tablist', { name: 'Machine' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(jackpots()).toHaveClass('order-1', 'sm:order-none', 'grid-cols-3')
      expect(giga.getByText(/^Last won by/)).toHaveClass('hidden', 'sm:block')
    })

    it('shows nothing when the pots cannot be read', async () => {
      open(state({ jackpots: [] }))
      await loaded()

      expect(screen.queryByRole('region', { name: 'Jackpots' })).not.toBeInTheDocument()
      expect(screen.queryByRole('progressbar', { name: /jackpot/ })).not.toBeInTheDocument()
      expect(payTable().queryByText(/jackpot/)).not.toBeInTheDocument()
    })

    it('says a pot switched off is paused', async () => {
      open(state({ jackpots: pots({ major: { live: false } }) }))
      await loaded()

      expect(within(pot('Major')).getByText('Paused')).toBeInTheDocument()
      expect(within(pot('Major')).queryByText(/must drop before/)).not.toBeInTheDocument()
      expect(within(pot('Mini')).getByText('must drop before 1 Gold')).toBeInTheDocument()
    })

    it('shows an unfed pot as 0 Silver, and never a bar past full', async () => {
      open(state({ jackpots: pots({ mini: { amount: 0 }, giga: { amount: 60_000 } }) }))
      await loaded()

      expect(within(pot('Mini')).getByText('0 Silver')).toBeInTheDocument()
      expect(within(pot('Giga')).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50000')
    })

    it('follows a pot someone else won between two polls', async () => {
      let current = state({ jackpots: pots() })
      const { user, queryClient } = open(current, { 'GET /slots': () => json(200, current), 'POST /slots/spin': () => json(200, lost) })
      await loaded()

      current = state({ jackpots: pots({ major: { amount: 0, last: { character: 'Moosey', amount: 10_002, at: AT } } }) })
      await poll(queryClient)

      expect(within(pot('Major')).getByText('0 Silver')).toBeInTheDocument()
      expect(within(pot('Major')).getByText('Last won by Moosey: 10 Gold 2 Silver.')).toBeInTheDocument()
      // Someone else's drop is not celebrated here.
      expect(pot('Major')).not.toHaveAttribute('data-won')
      await user.click(spinButton())
      expect(await screen.findByRole('img', { name: /^Reels: / })).toBeInTheDocument()
    })

    it('shows three jackpots and celebrates only the pot that dropped', async () => {
      const at = '2026-11-15T10:05:00.000Z'
      const mini = roundOf(BLANK, { stake: 60, jackpot: 1_002, pots: { mini: 1_002, major: 0, giga: 0 } })
      const two = roundOf(BLANK, { stake: 60, jackpot: 51_004, pots: { mini: 1_001, major: 0, giga: 50_003 } })
      const afterMini = result(mini, { jackpots: pots({ mini: { amount: 0, last: { character: 'Mounara', amount: 1_002, at } } }) })
      const afterTwo = result(two, {
        jackpots: pots({ mini: { amount: 0, last: { character: 'Mounara', amount: 1_001, at } }, giga: { amount: 0, last: { character: 'Mounara', amount: 50_003, at } } }),
      })
      const before = state({ jackpots: pots() })
      let current = before
      let spins = 0
      const { user, queryClient } = open(before, {
        'GET /slots': () => json(200, current),
        'POST /slots/spin': () => {
          const next = spins++ === 0 ? afterMini : afterTwo
          current = next.state
          return json(200, next)
        },
      })
      await loaded()
      await user.click(stake('60 Silver'))
      animate()

      await user.click(spinButton())
      await screen.findByRole('img', { name: 'Reels, spinning' })
      // A poll that brings the drop in mid-spin does not give it away.
      await poll(queryClient)
      playOut(() => {
        if (spinButton().textContent !== 'Stop') return
        expect(within(pot('Mini')).getByText('640 Silver')).toBeInTheDocument()
        expect(within(pot('Mini')).queryByText(/Last won by Mounara/)).not.toBeInTheDocument()
        expect(within(jackpots()).queryAllByRole('group').filter((group) => group.hasAttribute('data-won'))).toEqual([])
        expect(calls.filter((call) => POT_SOUNDS.includes(call))).toEqual([])
      })
      // The sound comes with the end, the meter and the money with the result.
      await waitFor(() => expect(within(pot('Mini')).getByText('0 Silver')).toBeInTheDocument())
      expect(status()).toHaveTextContent(`Mini jackpot. You won ${silverText(1_002)} on a stake of 60 Silver.`)
      expect(calls.filter((call) => POT_SOUNDS.includes(call))).toEqual(['jackpotMini'])
      expect(wallet()).toBe(walletText(mini))
      expect(pot('Mini')).toHaveAttribute('data-won', 'true')
      expect(pot('Major')).not.toHaveAttribute('data-won')
      expect(pot('Giga')).not.toHaveAttribute('data-won')
      expect(within(pot('Mini')).getByText(`Last won by Mounara: ${silverText(1_002)}.`)).toBeInTheDocument()

      // Two pots at once: the biggest one's sound, once, and both meters celebrate.
      calls.length = 0
      await user.click(spinButton())
      await screen.findByRole('img', { name: 'Reels, spinning' })
      playOut()
      await waitFor(() => expect(within(pot('Giga')).getByText('0 Silver')).toBeInTheDocument())
      expect(calls.filter((call) => POT_SOUNDS.includes(call))).toEqual(['jackpot'])
      expect(status()).toHaveTextContent(`Mini and Giga jackpots. You won ${silverText(51_004)} on a stake of 60 Silver.`)
      expect(pot('Mini')).toHaveAttribute('data-won', 'true')
      expect(pot('Major')).not.toHaveAttribute('data-won')
      expect(pot('Giga')).toHaveAttribute('data-won', 'true')
    })

    it('lists a jackpot round in the last rounds and the big wins', async () => {
      const drop = roundOf(BLANK, { stake: 60, jackpot: 50_002, pots: { mini: 0, major: 0, giga: 50_002 } })
      open(state({ jackpots: pots(), mine: [drop], bigWins: [drop] }))
      await loaded()

      const mine = lastRounds().getAllByRole('listitem')
      expect(mine[0].firstElementChild).toHaveTextContent(roundListLine(shelf, drop))
      const big = within(screen.getByRole('region', { name: 'Big wins' })).getAllByRole('listitem')
      expect(big[0]).toHaveTextContent(bigWinLine(shelf, drop))
    })

    it('says what a lost round adds, per machine', async () => {
      const { user } = open(state({ jackpots: pots() }))
      await loaded()

      for (const machine of SLOT_MACHINES) {
        await user.click(tab(machine.name))
        const { num, den } = slotJackpotShare(machine)
        expect(payTable().getByText(`A lost round on this machine adds ${((num / den) * 100).toFixed(1)}% of its stake to the jackpot. ${JACKPOT_LINE}`)).toBeInTheDocument()
      }
    })

    it('reads the state every 15 seconds', () => {
      expect(slotsQueryOptions.refetchInterval).toBe(15_000)
    })
  })
})
