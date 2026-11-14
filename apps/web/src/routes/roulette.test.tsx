import { ROULETTE_DEFAULT_LIMITS } from '@4story-portal/shared'
import type { RouletteSpinResult, RouletteSpinView, RouletteSpot, RouletteState, Wallet, WalletCharacter } from '@4story-portal/shared'
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pocketAngle, ROULETTE_SPIN_SECONDS } from '../lib/roulette'
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

const state = (overrides: Partial<RouletteState> = {}): RouletteState => ({
  live: true,
  limits: ROULETTE_DEFAULT_LIMITS,
  characters: [mounara, busy],
  mine: [],
  bigWins: [],
  ...overrides,
})

const spinOf = (overrides: Partial<RouletteSpinView> = {}): RouletteSpinView => ({
  id: 31,
  at: '2026-11-14T10:05:00.000Z',
  character: 'Mounara',
  pocket: 17,
  stake: 600,
  payout: 3600,
  ...overrides,
})

/** What the API answers for a spin by Mounara that left her with `wallet`. */
const result = (spin: RouletteSpinView, winning: RouletteSpot[], wallet: Wallet, mine: RouletteSpinView[] = [spin]): RouletteSpinResult => ({
  spin,
  winning,
  wallet,
  state: state({ characters: [{ ...mounara, wallet }, busy], mine }),
})

const won = result(spinOf(), ['n17'], { gold: 8, silver: 250, copper: 0 })

const open = (current: RouletteState = state(), extra: Parameters<typeof mockApi>[0] = {}) => {
  const fetchMock = mockApi({ 'GET /roulette': () => json(200, current), ...extra })
  return { fetchMock, ...renderRoute('/roulette', { me }) }
}

const table = () => screen.getByRole('region', { name: 'Table' })
const status = () => within(table()).getByRole('status')
const picker = () => screen.getByRole('combobox', { name: 'Playing with' })
const spinButton = () => within(table()).getByRole('button', { name: /^Spin/ })
const loaded = () => screen.findByRole('button', { name: 'Spin' })
const chip = (name: string) => screen.getByRole('radio', { name })
/** A spot on the felt, with or without chips on it. */
const spot = (name: string) => screen.getByRole('button', { name: new RegExp(`^Bet on ${name}(,|$)`) })
const lastNumbers = () => within(screen.getByRole('list', { name: 'Last numbers' })).queryAllByRole('listitem')

/** The text a screen reader reads: coin sprites read as their names. */
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
const wallet = () => spoken(within(table()).getByText('Wallet').nextElementSibling!)
const onTable = () => spoken(within(table()).getByText('On the table').nextElementSibling!)

/** Where the ball sits, as an angle on the wheel and a distance from its centre. */
function ballOnWheel() {
  const ball = screen.getByTestId('roulette-ball')
  const x = Number(ball.getAttribute('cx')) - 200
  const y = Number(ball.getAttribute('cy')) - 200
  const ring = screen.getByTestId('roulette-pockets').getAttribute('transform') ?? ''
  const wheel = Number(/rotate\((-?[\d.e+-]+)/.exec(ring)?.[1])
  const angle = (Math.atan2(x, -y) * 180) / Math.PI
  return { angle: (((angle - wheel) % 360) + 360) % 360, radius: Math.hypot(x, y) }
}

/** Turns the animation on, with a clock the test moves by hand. */
function animate() {
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
}

async function placeBets(user: ReturnType<typeof open>['user']) {
  await user.click(chip('100 Silver'))
  await user.click(spot('17'))
  await user.click(chip('500 Silver'))
  await user.click(spot('Red'))
}

describe('roulette', () => {
  beforeEach(() => {
    // Spins resolve at once unless a test turns the animation on.
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the table, the house share and the payouts', async () => {
    open()
    await loaded()

    expect(screen.getByRole('heading', { name: 'Roulette', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('Put your coin on the felt and let the ball decide.')).toBeInTheDocument()
    expect(
      screen.getByText("This is real gambling with your character's money. The zero gives the house about 2.7% of everything staked."),
    ).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Roulette wheel' })).toBeInTheDocument()
    // 37 numbers and 12 outside spots.
    expect(within(table()).getAllByRole('button', { name: /^Bet on / })).toHaveLength(49)
    for (const name of ['0', '36', 'Red', 'Black', 'Odd', 'Even', '1 to 18', '19 to 36', '1 to 12', '13 to 24', '25 to 36', 'Column 1', 'Column 3'])
      expect(spot(name)).toBeEnabled()
    expect(within(screen.getByRole('radiogroup', { name: 'Chip' })).getAllByRole('radio').map((radio) => radio.getAttribute('aria-label'))).toEqual([
      '10 Silver',
      '50 Silver',
      '100 Silver',
      '500 Silver',
      '1 Gold',
      '5 Gold',
    ])

    const pays = within(screen.getByRole('region', { name: 'How it pays' }))
    expect(pays.getAllByRole('row').map((row) => row.textContent)).toEqual([
      'BetCoversPays',
      'A numberone of 0 to 3635 to 1',
      'Red, Black18 numbers each1 to 1',
      'Odd, Even18 numbers each1 to 1',
      '1 to 18, 19 to 3618 numbers each1 to 1',
      'A dozen (1 to 12, 13 to 24, 25 to 36)12 numbers2 to 1',
      'A column12 numbers2 to 1',
    ])
    expect(pays.getByText(/Zero wins only for a chip on 0/)).toBeInTheDocument()
    expect(pays.getByText('Bets from 10 Silver, up to 1 Gold on a number and 10 Gold on any other spot.')).toBeInTheDocument()
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

    // The choice is remembered for the next visit.
    cleanup()
    open(state({ characters: [mounara, busy, moosey] }))
    await loaded()
    expect(picker()).toHaveValue('5')
  })

  it('does not pick a remembered character that is in the game', async () => {
    localStorage.setItem('roulette.character', '8')
    open()
    await loaded()

    expect(picker()).toHaveValue('7')
  })

  it('puts the chosen chip on a spot and adds up the stake', async () => {
    const { user } = open()
    await loaded()
    expect(onTable()).toBe('0 Silver')

    await user.click(chip('100 Silver'))
    expect(chip('100 Silver')).toBeChecked()
    await user.click(spot('17'))
    await user.click(spot('17'))
    await user.click(spot('Red'))

    expect(spot('17')).toHaveAccessibleName('Bet on 17, 200 Silver on it')
    expect(spot('Red')).toHaveAccessibleName('Bet on Red, 100 Silver on it')
    expect(spot('18')).toHaveAccessibleName('Bet on 18')
    expect(onTable()).toBe('300 Silver')
  })

  it('takes back the last chip, and clears the table', async () => {
    const { user } = open()
    await loaded()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled()

    await user.click(chip('10 Silver'))
    await user.click(spot('17'))
    await user.click(spot('17'))
    await user.click(chip('50 Silver'))
    await user.click(spot('Column 2'))
    expect(onTable()).toBe('70 Silver')

    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(spot('Column 2')).toHaveAccessibleName('Bet on Column 2')
    expect(spot('17')).toHaveAccessibleName('Bet on 17, 20 Silver on it')
    expect(onTable()).toBe('20 Silver')

    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(spot('17')).toHaveAccessibleName('Bet on 17, 10 Silver on it')

    await user.click(spot('Even'))
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(spot('17')).toHaveAccessibleName('Bet on 17')
    expect(spot('Even')).toHaveAccessibleName('Bet on Even')
    expect(onTable()).toBe('0 Silver')
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
  })

  it('refuses a chip past the number limit', async () => {
    const { user } = open()
    await loaded()

    await user.click(chip('1 Gold'))
    await user.click(spot('17'))
    await user.click(spot('17'))

    expect(screen.getByRole('alert')).toHaveTextContent('The largest bet on a number is 1 Gold')
    expect(spot('17')).toHaveAccessibleName('Bet on 17, 1 Gold on it')
    expect(onTable()).toBe('1 Gold')

    // A chip that fits clears the message.
    await user.click(spot('Black'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(onTable()).toBe('2 Gold')
  })

  it('refuses a chip past the limit on an outside spot', async () => {
    const { user } = open(state({ characters: [{ ...mounara, wallet: { gold: 50, silver: 0, copper: 0 } }] }))
    await loaded()

    await user.click(chip('5 Gold'))
    await user.click(spot('Red'))
    await user.click(spot('Red'))
    await user.click(spot('Red'))

    expect(screen.getByRole('alert')).toHaveTextContent('The largest bet on Red is 10 Gold')
    expect(onTable()).toBe('10 Gold')
  })

  it('refuses a chip the wallet cannot cover', async () => {
    const { user } = open()
    await loaded()

    await user.click(chip('5 Gold'))
    await user.click(spot('Red'))
    await user.click(spot('Red'))

    expect(screen.getByRole('alert')).toHaveTextContent('Not enough money in that wallet')
    expect(spot('Red')).toHaveAccessibleName('Bet on Red, 5 Gold on it')
    expect(onTable()).toBe('5 Gold')
  })

  it('cannot spin an empty table', async () => {
    const { user, fetchMock } = open()
    const button = await loaded()

    expect(button).toBeDisabled()
    await user.click(button)
    expect(sentBodies(fetchMock, 'POST /roulette/spin')).toEqual([])

    await user.click(spot('0'))
    expect(button).toBeEnabled()
  })

  it('sends the bets and shows the win only after the wheel stops', async () => {
    let spun = false
    const { user, fetchMock, queryClient } = open(state(), {
      'GET /roulette': () => json(200, spun ? won.state : state()),
      'POST /roulette/spin': () => {
        spun = true
        return json(200, won)
      },
    })
    await loaded()
    await placeBets(user)
    animate()

    await user.click(spinButton())

    expect(await screen.findByRole('img', { name: 'Roulette wheel, spinning' })).toBeInTheDocument()
    expect(sentBodies(fetchMock, 'POST /roulette/spin')).toEqual([
      {
        characterId: 7,
        bets: [
          { spot: 'n17', amount: 100 },
          { spot: 'red', amount: 500 },
        ],
      },
    ])
    expect(status()).toHaveTextContent('Good luck...')
    expect(spinButton()).toHaveTextContent('Spinning...')
    expect(spinButton()).toBeDisabled()
    expect(wallet()).toBe('5 Gold 250 Silver')
    expect(lastNumbers()).toHaveLength(0)
    expect(spot('17')).not.toHaveAttribute('data-won')
    // The chips stay on the felt while the ball runs.
    expect(onTable()).toBe('600 Silver')
    // A poll that brings the new wallet in mid-spin does not give the result away.
    await act(() => queryClient.invalidateQueries({ queryKey: ['roulette'] }))
    // React Query tells the page a moment later.
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
    expect(fetchMock.mock.calls.filter(([input, init]) => String(input) === '/api/roulette' && !init?.method)).toHaveLength(2)
    expect(wallet()).toBe('5 Gold 250 Silver')
    expect(lastNumbers()).toHaveLength(0)

    // Halfway through the ball is still on its track.
    act(() => vi.advanceTimersByTime(4000))
    expect(screen.getByRole('img', { name: 'Roulette wheel, spinning' })).toBeInTheDocument()
    expect(ballOnWheel().radius).toBeCloseTo(175, 0)
    expect(status()).toHaveTextContent('Good luck...')

    act(() => vi.advanceTimersByTime((ROULETTE_SPIN_SECONDS - 4) * 1000 + 100))

    expect(screen.getByRole('img', { name: 'Roulette wheel, ball on 17 black' })).toBeInTheDocument()
    expect(status()).toHaveTextContent('17 black. You won 3 Gold 600 Silver on a stake of 600 Silver.')
    expect(spot('17')).toHaveAttribute('data-won', 'true')
    expect(spot('Red')).not.toHaveAttribute('data-won')
    expect(wallet()).toBe('8 Gold 250 Silver')
    expect(lastNumbers()[0]).toHaveTextContent('17')
    expect(onTable()).toBe('0 Silver')
    expect(spot('17')).toHaveAccessibleName('Bet on 17')
    expect(spinButton()).toHaveTextContent('Spin')
    // The ball came to rest in its pocket.
    const ball = ballOnWheel()
    expect(ball.angle).toBeCloseTo(pocketAngle(17), 3)
    expect(ball.radius).toBeCloseTo(127, 3)
  })

  it('rests the ball in pocket 0 before the first spin', async () => {
    open()
    await loaded()

    const ball = ballOnWheel()
    expect(ball.angle).toBeCloseTo(0, 3)
    expect(ball.radius).toBeCloseTo(127, 3)
  })

  it('says so when nothing was won', async () => {
    const lost = result(spinOf({ pocket: 4, payout: 0 }), [], { gold: 4, silver: 650, copper: 0 })
    const { user } = open(state(), { 'POST /roulette/spin': () => json(200, lost) })
    await loaded()
    await placeBets(user)

    await user.click(spinButton())

    expect(await screen.findByRole('img', { name: 'Roulette wheel, ball on 4 black' })).toBeInTheDocument()
    expect(status()).toHaveTextContent('4 black. No win this time. You staked 600 Silver.')
    expect(within(table()).queryAllByRole('button', { name: /^Bet on / }).filter((button) => button.dataset.won)).toEqual([])
    expect(wallet()).toBe('4 Gold 650 Silver')
    expect(ballOnWheel().angle).toBeCloseTo(pocketAngle(4), 3)
  })

  it('sends one spin when Spin is pressed twice', async () => {
    const { user, fetchMock } = open(state(), { 'POST /roulette/spin': () => json(200, won) })
    await loaded()
    await user.click(spot('17'))
    animate()

    fireEvent.click(spinButton())
    fireEvent.click(spinButton())
    await screen.findByRole('img', { name: 'Roulette wheel, spinning' })
    await user.click(spinButton())

    expect(sentBodies(fetchMock, 'POST /roulette/spin')).toHaveLength(1)
  })

  it('puts the same bets back', async () => {
    const poorer = result(spinOf({ id: 32, pocket: 0, payout: 0 }), [], { gold: 0, silver: 300, copper: 0 })
    let spins = 0
    const { user, fetchMock } = open(state(), { 'POST /roulette/spin': () => json(200, ++spins === 1 ? won : poorer) })
    await loaded()
    expect(screen.queryByRole('button', { name: 'Same bets again' })).not.toBeInTheDocument()
    await placeBets(user)
    await user.click(spinButton())
    await screen.findByRole('img', { name: 'Roulette wheel, ball on 17 black' })
    expect(onTable()).toBe('0 Silver')

    await user.click(screen.getByRole('button', { name: 'Same bets again' }))

    expect(spot('17')).toHaveAccessibleName('Bet on 17, 100 Silver on it')
    expect(spot('Red')).toHaveAccessibleName('Bet on Red, 500 Silver on it')
    expect(onTable()).toBe('600 Silver')
    // Undo still takes back one chip at a time.
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onTable()).toBe('100 Silver')
    await user.click(screen.getByRole('button', { name: 'Same bets again' }))
    expect(onTable()).toBe('600 Silver')

    await user.click(spinButton())
    await screen.findByRole('img', { name: 'Roulette wheel, ball on 0 green' })
    expect(sentBodies(fetchMock, 'POST /roulette/spin')).toHaveLength(2)
    expect(status()).toHaveTextContent('0 green. No win this time. You staked 600 Silver.')

    // 300 Silver left cannot cover 600 Silver.
    await user.click(screen.getByRole('button', { name: 'Same bets again' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Not enough money in that wallet')
    expect(onTable()).toBe('0 Silver')
  })

  it('shows a refusal and reloads the table', async () => {
    let loads = 0
    const smaller = { minBet: 10, maxNumber: 50, maxOutside: 50 }
    const { user } = open(state(), {
      'GET /roulette': () => json(200, ++loads === 1 ? state() : state({ limits: smaller })),
      'POST /roulette/spin': () => json(422, { statusCode: 422, message: 'The largest bet on a number is 50 Silver' }),
    })
    await loaded()
    await user.click(chip('100 Silver'))
    await user.click(spot('17'))

    await user.click(spinButton())

    expect(await screen.findByRole('alert')).toHaveTextContent('The largest bet on a number is 50 Silver')
    await waitFor(() =>
      expect(within(screen.getByRole('radiogroup', { name: 'Chip' })).getAllByRole('radio').map((radio) => radio.getAttribute('aria-label'))).toEqual([
        '10 Silver',
        '50 Silver',
      ]),
    )
    expect(screen.getByRole('img', { name: 'Roulette wheel' })).toBeInTheDocument()
    expect(wallet()).toBe('5 Gold 250 Silver')
  })

  it('shows a character that went into the game as unavailable after a refusal', async () => {
    let loads = 0
    const { user } = open(state(), {
      'GET /roulette': () => json(200, ++loads === 1 ? state() : state({ characters: [{ ...mounara, online: true }, busy] })),
      'POST /roulette/spin': () => json(409, { statusCode: 409, message: 'Log out of Mounara in the game first' }),
    })
    await loaded()
    await user.click(spot('17'))

    await user.click(spinButton())

    expect(await screen.findByRole('alert')).toHaveTextContent('Log out of Mounara in the game first')
    await waitFor(() => expect(screen.getByRole('option', { name: 'Mounara (in the game, log out to play)' })).toBeDisabled())
    expect(spinButton()).toBeDisabled()
    expect(status()).toHaveTextContent('Log out of the game to play: your characters are all in it.')
  })

  it('shows the real wallet after a not-enough-money refusal', async () => {
    let loads = 0
    const { user } = open(state(), {
      'GET /roulette': () =>
        json(200, ++loads === 1 ? state() : state({ characters: [{ ...mounara, wallet: { gold: 0, silver: 300, copper: 0 } }, busy] })),
      'POST /roulette/spin': () => json(422, { statusCode: 422, message: 'Not enough money in that wallet' }),
    })
    await loaded()
    await placeBets(user)

    await user.click(spinButton())

    expect(await screen.findByRole('alert')).toHaveTextContent('Not enough money in that wallet')
    await waitFor(() => expect(wallet()).toBe('300 Silver'))
  })

  it('keeps the characters when the state after a spin could not be read', async () => {
    let loads = 0
    const unread: RouletteSpinResult = { ...won, state: state({ characters: [], mine: [spinOf()] }) }
    const { user, fetchMock } = open(state(), {
      // The page asks again, but meanwhile it must not lose the characters it had.
      'GET /roulette': () => (++loads === 1 ? json(200, state()) : new Promise<Response>(() => {})),
      'POST /roulette/spin': () => json(200, unread),
    })
    await loaded()
    await placeBets(user)

    await user.click(spinButton())

    expect(await screen.findByRole('img', { name: 'Roulette wheel, ball on 17 black' })).toBeInTheDocument()
    expect(screen.queryByText('You have no characters yet.')).not.toBeInTheDocument()
    expect(picker()).toHaveValue('7')
    expect(wallet()).toBe('8 Gold 250 Silver')
    await waitFor(() => expect(fetchMock.mock.calls.filter(([input, init]) => String(input) === '/api/roulette' && !init?.method)).toHaveLength(2))
  })

  it('is closed until a GM opens it', async () => {
    open(state({ live: false }))

    expect(await loaded()).toBeDisabled()
    expect(status()).toHaveTextContent('The table is not open yet. Have a look around: betting starts soon.')
    expect(within(table()).getAllByRole('button', { name: /^Bet on / }).every((button) => (button as HTMLButtonElement).disabled)).toBe(true)
    expect(chip('10 Silver')).toBeDisabled()
    expect(screen.getByRole('region', { name: 'How it pays' })).toBeInTheDocument()
  })

  it('explains when every character is in the game, and when there are none', async () => {
    open(state({ characters: [busy] }))

    expect(await loaded()).toBeDisabled()
    expect(status()).toHaveTextContent('Log out of the game to play: your characters are all in it.')
    expect(picker()).toBeDisabled()
    expect(spot('17')).toBeDisabled()

    cleanup()
    open(state({ characters: [] }))

    expect(await loaded()).toBeDisabled()
    expect(status()).toHaveTextContent('You have no characters yet.')
    expect(spot('17')).toBeDisabled()
  })

  it('stops quietly when the page is left mid-spin', async () => {
    const errors = vi.spyOn(console, 'error')
    const { user } = open(state(), { 'POST /roulette/spin': () => json(200, won) })
    await loaded()
    await user.click(spot('17'))
    animate()
    await user.click(spinButton())
    await screen.findByRole('img', { name: 'Roulette wheel, spinning' })
    act(() => vi.advanceTimersByTime(1000))
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    cleanup()
    // Nothing is left waiting for the next frame.
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(ROULETTE_SPIN_SECONDS * 1000)

    expect(errors).not.toHaveBeenCalled()
  })

  it('lists your last spins and the big wins', async () => {
    const mine = Array.from({ length: 12 }, (_, i) =>
      spinOf({ id: 100 - i, pocket: [17, 0, 32, 5, 21, 4, 9, 12, 30, 1, 2, 3][i], stake: 600, payout: i === 0 ? 3600 : 0 }),
    )
    const bigWins = [spinOf({ id: 90, character: 'Kael', pocket: 17, stake: 1000, payout: 36_000, at: '2026-11-13T23:59:00.000Z' })]
    open(state({ mine, bigWins }))
    await loaded()

    const last = within(screen.getByRole('region', { name: 'Your last spins' })).getAllByRole('listitem')
    expect(last).toHaveLength(10)
    expect(last[0]).toHaveTextContent('17 black, staked 600 Silver, won 3 Gold 600 Silver')
    expect(last[1]).toHaveTextContent('0 green, staked 600 Silver, won nothing')
    expect(last[2]).toHaveTextContent('32 red, staked 600 Silver, won nothing')

    expect(within(screen.getByRole('region', { name: 'Big wins' })).getByRole('listitem')).toHaveTextContent('Kael hit 17 and won 36 Gold')
    expect(lastNumbers().map((item) => item.textContent)).toEqual(
      ['17 black', '0 green', '32 red', '5 red', '21 red', '4 black', '9 red', '12 red', '30 red', '1 red', '2 black', '3 red'],
    )
  })

  it('says so before any spin', async () => {
    open()
    await loaded()

    expect(within(screen.getByRole('region', { name: 'Your last spins' })).getByText('You have not spun yet.')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Big wins' })).getByText('Nobody has hit a number yet.')).toBeInTheDocument()
  })

  it('says so when it cannot be loaded', async () => {
    mockApi({ 'GET /roulette': () => json(500, { statusCode: 500, message: 'Down' }) })
    renderRoute('/roulette', { me })

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the table.')
  })
})
