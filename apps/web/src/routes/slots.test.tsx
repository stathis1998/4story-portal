import { SLOT_MACHINES } from '@4story-portal/shared'
import type { SlotMachineState, SlotSpinResult, SlotSpinView, SlotStakes, SlotsState, Wallet, WalletCharacter } from '@4story-portal/shared'
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { REEL_BLURS } from '../lib/reel-blur'
import { SLOT_REEL_SECONDS, SLOT_SPIN_SECONDS } from '../lib/slots'
import { json, mockApi, sentBodies } from '../test/mock-api'
import { renderRoute } from '../test/render-route'

const me = { userId: 2, username: 'plain', isGm: false }

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
  ...overrides,
})

/** Three Experience Potions on Tranus's Shelf at 50 Silver: 100 times the stake. */
const spinOf = (overrides: Partial<SlotSpinView> = {}): SlotSpinView => ({
  id: 31,
  at: '2026-11-14T10:05:00.000Z',
  character: 'Mounara',
  machine: 'shelf',
  stops: [12, 8, 11],
  stake: 50,
  payout: 5000,
  ...overrides,
})

/** What the API answers for a spin by Mounara that left her with `wallet`. */
const result = (spin: SlotSpinView, wallet: Wallet, mine: SlotSpinView[] = [spin]): SlotSpinResult => ({
  spin,
  wallet,
  state: state({ characters: [{ ...mounara, wallet }, busy], mine }),
})

const jackpot = result(spinOf(), { gold: 10, silver: 200, copper: 0 })
const lost = result(spinOf({ stops: [12, 8, 12], payout: 0 }), { gold: 5, silver: 200, copper: 0 })
const lucky = result(spinOf({ stops: [0, 0, 1], payout: 100 }), { gold: 5, silver: 300, copper: 0 })

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
const spinButton = () => within(panel()).getByRole('button', { name: /^Spin/ })
const loaded = () => screen.findByRole('button', { name: 'Spin' })
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

/** A reel's strip of tiles, and how far it is moved down, in rows: tile n sits at row offset + n, row 1 is the win line. */
function strip(reel: number) {
  const element = screen.getByTestId(`reel-${reel}`)
  const percent = Number(/translateY\((-?[\d.e+-]+)%\)/.exec(element.style.transform)?.[1])
  return { element, offset: (percent / 100) * element.children.length }
}

/** The tile drawn in `row` (0 top, 1 the win line, 2 bottom) of a reel. */
function tileAt(reel: number, row: number): HTMLElement {
  const { element, offset } = strip(reel)
  const index = row - offset
  // At rest the strip sits on whole rows.
  expect(index).toBeCloseTo(Math.round(index), 6)
  return element.children[Math.round(index)] as HTMLElement
}

/** The names of the symbols drawn in a row, left to right, read from the icons' files. */
function rowSymbols(row: number, machine = SLOT_MACHINES[0]): string[] {
  return [0, 1, 2].map((reel) => {
    const src = tileAt(reel, row).querySelector('img')!.getAttribute('src')!
    return machine.symbols.find((symbol) => src === `/game-icons/${symbol.sprite}.png`)!.name
  })
}

/** The filter on a reel at full speed: the strongest of the page's vertical blurs. */
const STRONGEST = `#${REEL_BLURS[REEL_BLURS.length - 1].id}`

const litOnLine = () => [0, 1, 2].map((reel) => tileAt(reel, 1).dataset.won === 'true')
const allLit = () => screen.queryAllByTestId(/^reel-/).flatMap((reel) => [...reel.children].filter((tile) => (tile as HTMLElement).dataset.won))

/** Turns the animation on, with a clock the test moves by hand. */
function animate() {
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
}

/** jsdom has no scrollIntoView; a stub on every element records the calls, and the element each was made on. */
function stubScrollIntoView() {
  const scrolled = vi.fn()
  Object.defineProperty(Element.prototype, 'scrollIntoView', { value: scrolled, configurable: true, writable: true })
  return scrolled
}

describe('slots', () => {
  beforeEach(() => {
    // Spins resolve at once unless a test turns the animation on.
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
  })

  afterEach(() => {
    vi.useRealTimers()
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
  })

  it('shows three machines, the house line and what the first one pays', async () => {
    open()
    await loaded()

    expect(screen.getByRole('heading', { name: 'Slots', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('Three machines, one pull at a time.')).toBeInTheDocument()
    expect(screen.getByText("This is real gambling with your character's money. Each machine shows what it pays back.")).toBeInTheDocument()
    // On a phone the tagline goes, and the sentence is shown under the machine, before everything below it.
    expect(screen.getByText('Three machines, one pull at a time.')).toHaveClass('hidden', 'sm:block')
    expect(screen.getByText("This is real gambling with your character's money. Each machine shows what it pays back.")).toHaveClass('order-1')
    for (const name of ['What it pays', 'Your last spins', 'Big wins']) expect(screen.getByRole('region', { name })).toHaveClass('order-2')
    expect(tabNames()).toEqual(["Tranus's Shelf", 'The Armoury', "Dragon's Hoard"])
    expect(tab("Tranus's Shelf")).toHaveAttribute('aria-selected', 'true')
    expect(panel()).toHaveAccessibleName("Tranus's Shelf")
    expect(stakeNames()).toEqual(['10 Silver', '25 Silver', '50 Silver'])
    expect(stake('10 Silver')).toBeChecked()
    expect(spinButton()).toBeEnabled()

    // At rest on slotRest's stops [1, 0, 2]: a line that pays nothing and no row of three alike, with each strip's
    // real neighbours above and below the line.
    expect(reels()).toHaveAccessibleName('Reels')
    expect(rowSymbols(0)).toEqual(['Healing Potion', 'Healing Potion', 'Apprentice Formula'])
    expect(rowSymbols(1)).toEqual(['Apprentice Formula', 'Healing Potion', 'Serendipity'])
    expect(rowSymbols(2)).toEqual(['Healing Potion', 'Apprentice Formula', 'Healing Potion'])
    expect(allLit()).toEqual([])

    const pays = within(screen.getByRole('region', { name: 'What it pays' }))
    expect(pays.getAllByRole('row').map((row) => row.textContent)).toEqual([
      'On the linePaysAt 10 Silver',
      'Three Experience Potionspays 100 times1 Gold',
      'Three Survival Tincturespays 50 times500 Silver',
      'Three Serendipity potionspays 25 times250 Silver',
      "Three Master's Formulaspays 15 times150 Silver",
      'Three Apprentice Formulaspays 10 times100 Silver',
      'Three Healing Potionspays 5 times50 Silver',
      'Two Healing Potions from the leftpays 2 times20 Silver',
    ])
    // Each prize is drawn with its icons: three of the symbol, or two lucky ones.
    const top = pays.getAllByRole('row')[1]
    expect(top.querySelectorAll('img[src="/game-icons/8598.png"]')).toHaveLength(3)
    expect(pays.getAllByRole('row')[7].querySelectorAll('img[src="/game-icons/8526.png"]')).toHaveLength(2)
    expect(pays.getByText('This machine pays back 95.8% of what goes into it, over time. One spin in 4 pays something.')).toBeInTheDocument()
    expect(pays.getByText('The most one spin can win at these stakes is 5 Gold.')).toBeInTheDocument()
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

    await user.click(tab('The Armoury'))

    expect(tab('The Armoury')).toHaveAttribute('aria-selected', 'true')
    expect(panel()).toHaveAccessibleName('The Armoury')
    expect(stakeNames()).toEqual(['25 Silver', '50 Silver', '100 Silver'])
    expect(stake('25 Silver')).toBeChecked()
    expect(reels()).toHaveAccessibleName('Reels')
    expect(rowSymbols(1, SLOT_MACHINES[1])).toEqual(['Dragon String Bow', 'Dragon Iron Boots', 'Sword of Judgement'])
    const pays = within(screen.getByRole('region', { name: 'What it pays' }))
    const rows = pays.getAllByRole('row').map((row) => row.textContent)
    expect(rows[0]).toBe('On the linePaysAt 25 Silver')
    expect(rows[1]).toBe('Three Dragon Eye Wandspays 250 times6 Gold 250 Silver')
    expect(rows[7]).toBe('Two Dragon Iron Boots from the leftpays 2 times50 Silver')
    expect(pays.getByText('This machine pays back 95.7% of what goes into it, over time. One spin in 6 pays something.')).toBeInTheDocument()
    expect(pays.getByText('The most one spin can win at these stakes is 25 Gold.')).toBeInTheDocument()

    // The money in the table follows the stake.
    await user.click(stake('100 Silver'))
    expect(pays.getAllByRole('row')[1]).toHaveTextContent('Three Dragon Eye Wandspays 250 times25 Gold')

    await user.click(tab("Dragon's Hoard"))
    expect(stakeNames()).toEqual(['50 Silver', '100 Silver', '200 Silver'])
    expect(pays.getByText('This machine pays back 96.1% of what goes into it, over time. One spin in 10 pays something.')).toBeInTheDocument()
    expect(pays.getByText('The most one spin can win at these stakes is 100 Gold.')).toBeInTheDocument()
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
    expect(stake('10 Silver')).toBeChecked()
  })

  it('falls back to the first machine and lowest stake when the remembered ones do not exist', async () => {
    localStorage.setItem('slots.machine', 'retired')
    localStorage.setItem('slots.stake.shelf', '999')
    open()
    await loaded()

    expect(tab("Tranus's Shelf")).toHaveAttribute('aria-selected', 'true')
    expect(stake('10 Silver')).toBeChecked()
    expect(spinButton()).toBeEnabled()
  })

  it('sends one spin with the machine and stake and shows the win only after the last reel stops', async () => {
    let spun = false
    const { user, fetchMock, queryClient } = open(state(), {
      'GET /slots': () => json(200, spun ? jackpot.state : state()),
      'POST /slots/spin': () => {
        spun = true
        return json(200, jackpot)
      },
    })
    await loaded()
    await user.click(stake('50 Silver'))
    animate()

    await user.click(spinButton())

    expect(await screen.findByRole('img', { name: 'Reels, spinning' })).toBeInTheDocument()
    expect(sentBodies(fetchMock, 'POST /slots/spin')).toEqual([{ characterId: 7, machine: 'shelf', stake: 50 }])
    expect(status()).toHaveTextContent('Good luck...')
    expect(spinButton()).toHaveTextContent('Spinning...')
    expect(spinButton()).toBeDisabled()
    expect(wallet()).toBe('5 Gold 250 Silver')
    expect(tab('The Armoury')).toBeDisabled()
    expect(tab("Tranus's Shelf")).toBeDisabled()
    expect(picker()).toBeDisabled()
    expect(stake('10 Silver')).toBeDisabled()
    // A poll that brings the new wallet in mid-spin does not give the result away.
    await poll(queryClient)
    expect(getGets(fetchMock)).toHaveLength(2)
    expect(wallet()).toBe('5 Gold 250 Silver')
    expect(within(screen.getByRole('region', { name: 'Your last spins' })).queryAllByRole('listitem')).toHaveLength(0)

    // At full speed the reels are smeared along their run with the strongest blur, which is vertical only.
    act(() => vi.advanceTimersByTime(600))
    expect([0, 1, 2].map((reel) => strip(reel).element.style.filter)).toEqual(Array(3).fill(expect.stringContaining(`url(`)))
    expect([0, 1, 2].map((reel) => strip(reel).element.style.filter)).toEqual(Array(3).fill(expect.stringContaining(STRONGEST)))
    const blur = document.querySelector(`${STRONGEST} feGaussianBlur`)
    expect(blur?.getAttribute('stdDeviation')).toMatch(/^0 [1-9]\d*$/)
    expect(document.querySelectorAll(STRONGEST)).toHaveLength(1)

    // The first reel has stopped, sharp and on its stop; the others still turn and nothing is told yet.
    act(() => vi.advanceTimersByTime((SLOT_REEL_SECONDS[0] + 0.05) * 1000 - 600))
    expect(strip(0).element.style.filter).toBe('')
    expect(tileAt(0, 1).querySelector('img')).toHaveAttribute('src', '/game-icons/8598.png')
    expect(strip(2).element.style.filter).toContain('slot-reel-blur')
    expect(reels()).toHaveAccessibleName('Reels, spinning')
    expect(status()).toHaveTextContent('Good luck...')
    expect(allLit()).toEqual([])

    act(() => vi.advanceTimersByTime(SLOT_SPIN_SECONDS * 1000))

    expect(reels()).toHaveAccessibleName('Reels: Experience Potion, Experience Potion, Experience Potion on the win line')
    expect(rowSymbols(1)).toEqual(['Experience Potion', 'Experience Potion', 'Experience Potion'])
    expect([0, 1, 2].map((reel) => strip(reel).element.style.filter)).toEqual(['', '', ''])
    expect(status()).toHaveTextContent('Three Experience Potions. You won 5 Gold on a stake of 50 Silver.')
    expect(litOnLine()).toEqual([true, true, true])
    expect(allLit()).toHaveLength(3)
    expect(wallet()).toBe('10 Gold 200 Silver')
    expect(spinButton()).toHaveTextContent('Spin')
    expect(spinButton()).toBeEnabled()
    expect(tab('The Armoury')).toBeEnabled()
    const last = within(screen.getByRole('region', { name: 'Your last spins' })).getAllByRole('listitem')
    expect(spoken(last[0])).toContain("Tranus's Shelf: Experience Potion Experience Potion Experience Potion staked 50 Silver, won 5 Gold")
    // The page reads the state again once the spin is shown.
    await waitFor(() => expect(getGets(fetchMock)).toHaveLength(3))
  })

  it('says so when nothing was won', async () => {
    const { user } = open(state(), server(lost))
    await loaded()
    await user.click(stake('50 Silver'))

    await user.click(spinButton())

    expect(await screen.findByRole('img', { name: 'Reels: Experience Potion, Experience Potion, Apprentice Formula on the win line' })).toBeInTheDocument()
    expect(status()).toHaveTextContent('No win this time. You staked 50 Silver.')
    // The third reel's Experience Potion is real, and just above the line.
    expect(rowSymbols(0)[2]).toBe('Experience Potion')
    expect(rowSymbols(1)).toEqual(['Experience Potion', 'Experience Potion', 'Apprentice Formula'])
    expect(allLit()).toEqual([])
    expect(wallet()).toBe('5 Gold 200 Silver')
  })

  it('reads out two lucky symbols', async () => {
    const { user } = open(state(), server(lucky))
    await loaded()
    await user.click(stake('50 Silver'))

    await user.click(spinButton())

    expect(await screen.findByRole('img', { name: 'Reels: Healing Potion, Healing Potion, Apprentice Formula on the win line' })).toBeInTheDocument()
    expect(status()).toHaveTextContent('Two Healing Potions. You won 100 Silver on a stake of 50 Silver.')
    expect(litOnLine()).toEqual([true, true, false])
    expect(allLit()).toHaveLength(2)
    expect(wallet()).toBe('5 Gold 300 Silver')
  })

  it('sends one spin when Spin is pressed twice, and none while the reels turn', async () => {
    const { user, fetchMock } = open(state(), { 'POST /slots/spin': () => json(200, jackpot) })
    await loaded()
    animate()

    fireEvent.click(spinButton())
    fireEvent.click(spinButton())
    await screen.findByRole('img', { name: 'Reels, spinning' })
    await user.click(spinButton())
    fireEvent.keyDown(document.body, { key: ' ' })

    expect(sentBodies(fetchMock, 'POST /slots/spin')).toHaveLength(1)
  })

  it('spins on the space bar, once for a held key', async () => {
    const { fetchMock } = open(state(), server(lost, jackpot))
    await loaded()

    fireEvent.keyDown(document.body, { key: ' ' })
    await screen.findByRole('img', { name: /^Reels: / })
    expect(sentBodies(fetchMock, 'POST /slots/spin')).toEqual([{ characterId: 7, machine: 'shelf', stake: 10 }])
    expect(await screen.findByRole('button', { name: 'Spin' })).toBeEnabled()

    // The key is still down: the browser repeats it, and that is not a new pull.
    fireEvent.keyDown(document.body, { key: ' ', repeat: true })
    expect(spinButton()).toHaveTextContent('Spin')
    expect(sentBodies(fetchMock, 'POST /slots/spin')).toHaveLength(1)

    fireEvent.keyDown(document.body, { key: ' ' })
    await screen.findByRole('img', { name: 'Reels: Experience Potion, Experience Potion, Experience Potion on the win line' })
    expect(sentBodies(fetchMock, 'POST /slots/spin')).toHaveLength(2)
  })

  it('does not spin on space in the character picker', async () => {
    const { fetchMock } = open(state({ characters: [mounara, moosey] }), server(jackpot))
    await loaded()

    fireEvent.keyDown(picker(), { key: ' ' })
    fireEvent.keyDown(stake('25 Silver'), { key: ' ' })
    fireEvent.keyDown(tab('The Armoury'), { key: ' ' })

    expect(spinButton()).toHaveTextContent('Spin')
    expect(reels()).toHaveAccessibleName('Reels')
    expect(sentBodies(fetchMock, 'POST /slots/spin')).toEqual([])
  })

  it('keeps the old table while the spin is on its way', async () => {
    let answer: (response: Response) => void = () => {}
    let spun = false
    const { user, queryClient } = open(state(), {
      'GET /slots': () => json(200, spun ? jackpot.state : state()),
      // The server has bet and committed; its answer is still on the way.
      'POST /slots/spin': () => {
        spun = true
        return new Promise<Response>((resolve) => (answer = resolve))
      },
    })
    await loaded()
    await user.click(stake('50 Silver'))

    await user.click(spinButton())
    await screen.findByRole('button', { name: 'Spinning...' })
    await poll(queryClient)

    expect(wallet()).toBe('5 Gold 250 Silver')
    expect(within(screen.getByRole('region', { name: 'Your last spins' })).queryAllByRole('listitem')).toHaveLength(0)
    expect(status()).toHaveTextContent('Good luck...')
    expect(reels()).toHaveAccessibleName('Reels')
    expect(tab('The Armoury')).toBeDisabled()

    await act(async () => answer(json(200, jackpot)))

    expect(await screen.findByRole('img', { name: 'Reels: Experience Potion, Experience Potion, Experience Potion on the win line' })).toBeInTheDocument()
    expect(wallet()).toBe('10 Gold 200 Silver')
    expect(within(screen.getByRole('region', { name: 'Your last spins' })).getAllByRole('listitem')).toHaveLength(1)
  })

  it('disables a stake the wallet cannot cover, and Spin when none is affordable', async () => {
    let current = state({ characters: [{ ...mounara, wallet: { gold: 0, silver: 30, copper: 0 } }] })
    const { queryClient } = open(current, { 'GET /slots': () => json(200, current) })
    await loaded()

    expect(stake('10 Silver')).toBeEnabled()
    expect(stake('25 Silver')).toBeEnabled()
    expect(stake('50 Silver')).toBeDisabled()
    expect(spinButton()).toBeEnabled()

    // Loose Bronze does not count.
    current = state({ characters: [{ ...mounara, wallet: { gold: 0, silver: 9, copper: 999 } }] })
    await poll(queryClient)

    expect(stake('10 Silver')).toBeDisabled()
    expect(stake('25 Silver')).toBeDisabled()
    expect(stake('50 Silver')).toBeDisabled()
    expect(spinButton()).toBeDisabled()
  })

  it('shows a refusal, reloads the stakes and picks the lowest when the chosen one is gone', async () => {
    let loads = 0
    const { user, fetchMock } = open(state(), {
      'GET /slots': () => json(200, ++loads === 1 ? state() : state({ machines: machines({ shelf: { stakes: [20, 40, 80] } }) })),
      'POST /slots/spin': () => json(422, { statusCode: 422, message: 'That stake is no longer offered on this machine' }),
    })
    await loaded()
    await user.click(stake('25 Silver'))

    await user.click(spinButton())

    expect(await screen.findByRole('alert')).toHaveTextContent('That stake is no longer offered on this machine')
    await waitFor(() => expect(stakeNames()).toEqual(['20 Silver', '40 Silver', '80 Silver']))
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
      'POST /slots/spin': () => json(200, jackpot),
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
      'POST /slots/spin': () => json(200, jackpot),
    })
    await loaded()

    expect(tabNames()).toEqual(["Tranus's Shelf", 'The Armoury Closed', "Dragon's Hoard"])
    expect(tab('The Armoury Closed')).toHaveAttribute('aria-selected', 'true')
    expect(spinButton()).toBeDisabled()
    expect(status()).toHaveTextContent('This machine is closed. Try another one.')

    await user.click(tab("Tranus's Shelf"))
    expect(spinButton()).toBeEnabled()
    expect(status()).not.toHaveTextContent('This machine is closed.')

    await user.click(stake('50 Silver'))
    await user.click(spinButton())
    expect(await screen.findByRole('img', { name: /^Reels: / })).toBeInTheDocument()
    expect(status()).toHaveTextContent('Three Experience Potions. You won 5 Gold on a stake of 50 Silver.')
  })

  it('still shows the result when the answer says the floor has closed', async () => {
    // The settings could not be read after the bet: the API fell back to a closed floor and no lists.
    const closed: SlotSpinResult = { ...jackpot, state: { ...jackpot.state, live: false, characters: [], mine: [] } }
    let loads = 0
    const { user } = open(state(), {
      // The page asks again, but meanwhile it must not lose the characters it had.
      'GET /slots': () => (++loads === 1 ? json(200, state()) : new Promise<Response>(() => {})),
      'POST /slots/spin': () => json(200, closed),
    })
    await loaded()
    await user.click(stake('50 Silver'))

    await user.click(spinButton())

    await screen.findByRole('img', { name: 'Reels: Experience Potion, Experience Potion, Experience Potion on the win line' })
    const line = 'Three Experience Potions. You won 5 Gold on a stake of 50 Silver.'
    const note = 'The slots are not open yet. Have a look at the machines: they open soon.'
    expect(status()).toHaveTextContent(line)
    expect(status()).toHaveTextContent(note)
    expect(status().textContent!.indexOf(line)).toBeLessThan(status().textContent!.indexOf(note))
    expect(spinButton()).toBeDisabled()
    // The characters it had stay, with the wallet the spin left, and the spin is listed.
    expect(picker()).toHaveValue('7')
    expect(wallet()).toBe('10 Gold 200 Silver')
    expect(within(screen.getByRole('region', { name: 'Your last spins' })).getAllByRole('listitem')).toHaveLength(1)
  })

  it('brings the reels into view when a spin starts', async () => {
    const scrolled = stubScrollIntoView()
    const { user } = open(state(), server(jackpot))
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

    act(() => vi.advanceTimersByTime(SLOT_SPIN_SECONDS * 1000 + 100))
    expect(reels()).toHaveAccessibleName(/^Reels: /)
    expect(scrolled).toHaveBeenCalledTimes(1)
  })

  it('keeps the machine while the reels turn, even for an arrow key on its tab', async () => {
    const { user } = open(state(), server(jackpot))
    await loaded()
    await user.click(stake('50 Silver'))
    animate()
    await user.click(spinButton())
    await screen.findByRole('img', { name: 'Reels, spinning' })

    // Straight on the tab, as if it had kept the focus when it was turned off.
    fireEvent.keyDown(tab("Tranus's Shelf"), { key: 'ArrowRight' })
    fireEvent.keyDown(tab("Tranus's Shelf"), { key: 'ArrowLeft' })
    expect(tab("Tranus's Shelf")).toHaveAttribute('aria-selected', 'true')
    expect(panel()).toHaveAccessibleName("Tranus's Shelf")
    expect(localStorage.getItem('slots.machine')).toBeNull()

    act(() => vi.advanceTimersByTime(SLOT_SPIN_SECONDS * 1000 + 100))
    expect(reels()).toHaveAccessibleName('Reels: Experience Potion, Experience Potion, Experience Potion on the win line')
    expect(status()).toHaveTextContent('Three Experience Potions. You won 5 Gold on a stake of 50 Silver.')
    expect(spinButton()).toHaveTextContent('Spin')
  })

  it('does not bring back a stake the machine dropped once it is offered again', async () => {
    let current = state()
    const { user, queryClient } = open(current, { 'GET /slots': () => json(200, current) })
    await loaded()
    await user.click(stake('25 Silver'))

    current = state({ machines: machines({ shelf: { stakes: [10, 50, 100] } }) })
    await poll(queryClient)
    expect(stake('10 Silver')).toBeChecked()

    current = state()
    await poll(queryClient)
    expect(stakeNames()).toEqual(['10 Silver', '25 Silver', '50 Silver'])
    expect(stake('10 Silver')).toBeChecked()
    expect(stake('25 Silver')).not.toBeChecked()

    // Nor on the next visit.
    cleanup()
    open(state())
    await loaded()
    expect(stake('10 Silver')).toBeChecked()
  })

  it('stops quietly when the page is left mid-spin', async () => {
    const errors = vi.spyOn(console, 'error')
    const { user } = open(state(), { 'POST /slots/spin': () => json(200, jackpot) })
    await loaded()
    animate()
    await user.click(spinButton())
    await screen.findByRole('img', { name: 'Reels, spinning' })
    act(() => vi.advanceTimersByTime(1000))
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    cleanup()
    // Nothing is left waiting for the next frame.
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(SLOT_SPIN_SECONDS * 1000)

    expect(errors).not.toHaveBeenCalled()
  })

  it('lists your last spins and the big wins, skipping a machine it does not know', async () => {
    const mine = Array.from({ length: 12 }, (_, i) =>
      spinOf({ id: 100 - i, stops: i === 0 ? [4, 4, 16] : [12, 8, 12], stake: 50, payout: i === 0 ? 2500 : 0 }),
    )
    mine[1] = { ...mine[1], machine: 'retired' as SlotSpinView['machine'] }
    const bigWins = [
      spinOf({ id: 90, character: 'Mounara', machine: 'armoury', stops: [1, 2, 3], stake: 50, payout: 12_500, at: '2026-11-13T23:59:00.000Z' }),
      spinOf({ id: 89, character: 'Kael', machine: 'retired' as SlotSpinView['machine'], payout: 99_000 }),
    ]
    open(state({ mine, bigWins }))
    await loaded()

    const last = within(screen.getByRole('region', { name: 'Your last spins' })).getAllByRole('listitem')
    expect(last).toHaveLength(10)
    expect(spoken(last[0].firstElementChild!)).toBe("Tranus's Shelf: Survival Tincture Survival Tincture Survival Tincture staked 50 Silver, won 2 Gold 500 Silver")
    expect(last[0]).toHaveTextContent('14 Nov, 10:05')
    expect(spoken(last[1].firstElementChild!)).toBe("Tranus's Shelf: Experience Potion Experience Potion Apprentice Formula staked 50 Silver, won nothing")

    const big = within(screen.getByRole('region', { name: 'Big wins' })).getAllByRole('listitem')
    expect(big).toHaveLength(1)
    expect(big[0]).toHaveTextContent('Mounara won 12 Gold 500 Silver on The Armoury')
    expect(big[0]).toHaveTextContent('13 Nov, 23:59')
  })

  describe('when a GM changes the stakes', () => {
    const PICK = 'The stakes on this machine changed. Pick a stake to keep playing.'

    it('waits for the player to pick one when every new stake is higher', async () => {
      let current = state()
      const { user, queryClient, fetchMock } = open(current, { 'GET /slots': () => json(200, current), 'POST /slots/spin': () => json(200, lost) })
      await loaded()
      expect(stake('10 Silver')).toBeChecked()

      current = state({ machines: machines({ shelf: { stakes: [100, 250, 500] } }) })
      await poll(queryClient)

      expect(stakeNames()).toEqual(['100 Silver', '250 Silver', '500 Silver'])
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
      await user.click(stake('25 Silver'))

      current = state({ machines: machines({ shelf: { stakes: [20, 40, 80] } }) })
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
        'GET /slots': () => json(200, ++loads === 1 ? state() : state({ machines: machines({ shelf: { stakes: [100, 250, 500] } }) })),
        'POST /slots/spin': () => json(422, { statusCode: 422, message: 'That stake is no longer offered on this machine' }),
      })
      await loaded()

      fireEvent.click(spinButton())

      expect(await screen.findByRole('alert')).toHaveTextContent('That stake is no longer offered on this machine')
      await waitFor(() => expect(stakeNames()).toEqual(['100 Silver', '250 Silver', '500 Silver']))
      expect(stake('100 Silver')).not.toBeChecked()
      expect(spinButton()).toBeDisabled()
      expect(status()).toHaveTextContent(PICK)
    })

    it('waits until the reels stop, and the spin keeps the stake it was sent with', async () => {
      let current = state()
      const moved = state({ machines: machines({ shelf: { stakes: [20, 40, 80] } }) })
      const { user, queryClient, fetchMock } = open(current, {
        'GET /slots': () => json(200, current),
        'POST /slots/spin': () => json(200, { ...jackpot, state: { ...jackpot.state, machines: moved.machines } }),
      })
      await loaded()
      await user.click(stake('50 Silver'))
      animate()
      await user.click(spinButton())
      await screen.findByRole('img', { name: 'Reels, spinning' })

      current = { ...moved, characters: jackpot.state.characters, mine: jackpot.state.mine }
      await poll(queryClient)
      expect(stakeNames()).toEqual(['10 Silver', '25 Silver', '50 Silver'])
      expect(stake('50 Silver')).toBeChecked()
      expect(status()).toHaveTextContent('Good luck...')

      act(() => vi.advanceTimersByTime(SLOT_SPIN_SECONDS * 1000 + 100))

      expect(sentBodies(fetchMock, 'POST /slots/spin')).toEqual([{ characterId: 7, machine: 'shelf', stake: 50 }])
      expect(stake('20 Silver')).toBeChecked()
      const line = 'Three Experience Potions. You won 5 Gold on a stake of 50 Silver.'
      const note = 'The stakes on this machine changed. Your stake is now 20 Silver.'
      expect(status()).toHaveTextContent(line)
      expect(status()).toHaveTextContent(note)
      expect(status().textContent!.indexOf(line)).toBeLessThan(status().textContent!.indexOf(note))
    })
  })

  it('spins on space right after a stake is clicked', async () => {
    const { user, fetchMock } = open(state(), server(lost))
    await loaded()
    await user.click(stake('25 Silver'))
    expect(stake('25 Silver')).toHaveFocus()

    await user.keyboard(' ')

    await screen.findByRole('img', { name: /^Reels: / })
    expect(sentBodies(fetchMock, 'POST /slots/spin')).toEqual([{ characterId: 7, machine: 'shelf', stake: 25 }])
  })

  it('says why Spin is off when the wallet is short of the stake', async () => {
    let current = state({ characters: [{ ...mounara, wallet: { gold: 0, silver: 60, copper: 0 } }] })
    const { user, queryClient } = open(current, { 'GET /slots': () => json(200, current) })
    await loaded()
    await user.click(stake('50 Silver'))
    expect(status()).not.toHaveTextContent('Not enough money')

    current = state({ characters: [{ ...mounara, wallet: { gold: 0, silver: 40, copper: 0 } }] })
    await poll(queryClient)

    expect(stake('50 Silver')).toBeChecked()
    expect(spinButton()).toBeDisabled()
    expect(status()).toHaveTextContent('Not enough money in that wallet for this stake.')
  })
})
