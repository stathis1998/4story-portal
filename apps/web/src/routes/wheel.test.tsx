import type { WheelSpin, WheelSpinResult, WheelState } from '@4story-portal/shared'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { character } from '../test/characters'
import { json, mockApi, sentBodies } from '../test/mock-api'
import { renderRoute } from '../test/render-route'

const me = { userId: 2, username: 'plain', isGm: false }

const gold = { gold: 1, silver: 0, copper: 0, items: [] }
const potions = { gold: 0, silver: 0, copper: 0, items: [{ itemId: 7600, count: 10, name: 'First-Class Healing Potion', icon: null }] }

const state = (overrides: Partial<WheelState> = {}): WheelState => ({
  live: true,
  minLevel: 20,
  prizes: [
    { id: 1, name: '1 Gold', chance: 75, reward: gold, announce: false },
    { id: 2, name: '10 Healing Potions', chance: 24.6, reward: potions, announce: false },
    { id: 3, name: 'Jackpot', chance: 0.4, reward: { ...gold, gold: 10 }, announce: true },
  ],
  today: null,
  secondsToReset: 50_400,
  mine: [],
  winners: [],
  ...overrides,
})

const spinOf = (overrides: Partial<WheelSpin> = {}): WheelSpin => ({
  id: 9,
  at: '2026-11-14T10:05:00.000Z',
  character: 'Mounara',
  prize: '1 Gold',
  reward: gold,
  ...overrides,
})

const result = (prizeId: number, spin: WheelSpin): WheelSpinResult => ({
  prizeId,
  spin,
  state: state({ today: spin, mine: [spin] }),
})

const mounara = character({ id: 7, name: 'Mounara', level: 60, className: 'Archer' })
const moosey = character({ id: 5, name: 'Moosey', level: 45 })
const tiny = character({ id: 8, name: 'Tiny', level: 12 })

const open = (current: WheelState = state(), extra: Parameters<typeof mockApi>[0] = {}, characters = [moosey, mounara, tiny]) => {
  const fetchMock = mockApi({
    'GET /wheel': () => json(200, current),
    'GET /characters': () => json(200, characters),
    ...extra,
  })
  return { fetchMock, ...renderRoute('/wheel', { me }) }
}

const spinButton = () => screen.findByRole('button', { name: 'Spin the wheel' })
const status = () => within(screen.getByRole('region', { name: 'Spin' })).getByRole('status')
const picker = () => screen.getByRole('combobox', { name: 'Send the prize to' })

describe('wheel of fortune', () => {
  it('is linked from the header', async () => {
    mockApi({ 'GET /wheel': () => json(200, state()) })
    const { user, router } = renderRoute('/characters', { me })

    await user.click(await screen.findByRole('button', { name: 'Try Your Luck' }))
    await user.click(within(screen.getByRole('list', { name: 'Try Your Luck' })).getByRole('link', { name: 'Wheel of Fortune' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/wheel'))
    expect(await screen.findByRole('heading', { name: 'Wheel of Fortune', level: 1 })).toBeInTheDocument()
  })

  it('draws a segment for each prize and lists their chances', async () => {
    open()

    expect(await screen.findByRole('img', { name: 'Wheel with 3 prizes' })).toBeInTheDocument()
    const prizes = within(screen.getByRole('region', { name: 'Prizes' })).getAllByRole('listitem')
    expect(prizes.map((item) => item.textContent)).toEqual([
      expect.stringMatching(/^1 Gold.*75%$/),
      expect.stringMatching(/^10 Healing Potions.*First-Class Healing Potionx10.*24\.6%$/),
      expect.stringMatching(/^★ Jackpot.*0\.4%$/),
    ])
    expect(screen.getByText('★ A win is announced in the game.')).toBeInTheDocument()
  })

  it('offers the characters at level 20 or higher, highest first, and says why the others cannot be picked', async () => {
    open()
    await spinButton()

    const options = within(picker()).getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual([
      'Mounara (level 60 Archer)',
      'Moosey (level 45 Wizard)',
      'Tiny (level 12, needs 20)',
    ])
    expect(options[2]).toBeDisabled()
    expect(picker()).toHaveValue('7')
    expect(status()).toHaveTextContent('Your free spin is ready.')
  })

  it('spins for the chosen character and shows what was won', async () => {
    const { user, fetchMock } = open(state(), { 'POST /wheel/spin': () => json(200, result(1, spinOf())) })

    await user.click(await spinButton())

    expect(await screen.findByText('You won 1 Gold!')).toBeInTheDocument()
    expect(sentBodies(fetchMock, 'POST /wheel/spin')).toEqual([{ characterId: 7 }])
    expect(status()).toHaveTextContent("It is on its way to Mounara's mailbox in the game.")
    expect(status()).toHaveTextContent(/Next free spin in 1[34]:\d\d:\d\d/)
    expect(screen.getByRole('button', { name: 'Come back tomorrow' })).toBeDisabled()
    expect(within(screen.getByRole('region', { name: 'Your spins' })).getByRole('listitem')).toHaveTextContent('1 Gold for Mounara14 Nov, 10:05')
  })

  it('turns the wheel to the prize it landed on', async () => {
    const { user } = open(state(), { 'POST /wheel/spin': () => json(200, result(2, spinOf({ prize: '10 Healing Potions', reward: potions }))) })
    await user.click(await spinButton())
    await screen.findByText('You won 10 Healing Potions!')

    // The second of three segments is centred at 180 degrees.
    expect(screen.getByTestId('wheel-disc').style.transform).toBe('rotate(180deg)')
  })

  it('sends the prize to another character when one is picked, and remembers the choice', async () => {
    const spin = spinOf({ character: 'Moosey' })
    const { user, fetchMock } = open(state(), { 'POST /wheel/spin': () => json(200, result(1, spin)) })
    await spinButton()

    await user.selectOptions(picker(), 'Moosey (level 45 Wizard)')
    await user.click(await spinButton())

    await screen.findByText('You won 1 Gold!')
    expect(sentBodies(fetchMock, 'POST /wheel/spin')).toEqual([{ characterId: 5 }])

    cleanup()
    open()
    await spinButton()
    expect(picker()).toHaveValue('5')
  })

  it('keeps the result back until the wheel has stopped turning', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    const { user } = open(state(), { 'POST /wheel/spin': () => json(200, result(3, spinOf({ prize: 'Jackpot' }))) })

    await user.click(await spinButton())

    const turning = await screen.findByRole('button', { name: 'Spinning…' })
    expect(turning).toBeDisabled()
    expect(status()).toHaveTextContent('Good luck…')
    expect(screen.queryByText(/Jackpot!/)).not.toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Your spins' })).queryByRole('listitem')).not.toBeInTheDocument()
    // Five whole turns, then on to the third segment at 300 degrees.
    const disc = screen.getByTestId('wheel-disc')
    expect(disc.style.transform).toBe('rotate(1860deg)')
    expect(disc.style.transition).toMatch(/^transform 5s/)

    fireEvent.transitionEnd(disc)

    expect(await screen.findByText('You won Jackpot!')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Your spins' })).getByRole('listitem')).toBeInTheDocument()
  })

  it('says so when the segment was a no luck one', async () => {
    const empty = state({ prizes: [{ id: 4, name: 'No luck', chance: 100, reward: null, announce: false }] })
    const { user } = open(empty, { 'POST /wheel/spin': () => json(200, result(4, spinOf({ prize: 'No luck', reward: null }))) })

    const button = await spinButton()
    expect(within(screen.getByRole('region', { name: 'Prizes' })).getByText('No prize')).toBeInTheDocument()
    await user.click(button)

    expect(await screen.findByText('Nothing this time. Come back tomorrow for another free spin.')).toBeInTheDocument()
  })

  it('shows the spin already made today and when the next one is free', async () => {
    open(state({ today: spinOf(), mine: [spinOf()] }))

    const button = await screen.findByRole('button', { name: 'Come back tomorrow' })
    expect(button).toBeDisabled()
    expect(status()).toHaveTextContent('Today you won 1 Gold for Mounara.')
    expect(status()).toHaveTextContent(/Next free spin in 1[34]:\d\d:\d\d/)
  })

  it('is closed until a GM opens it', async () => {
    open(state({ live: false }))

    expect(await spinButton()).toBeDisabled()
    expect(status()).toHaveTextContent('The wheel is not open yet.')
    expect(screen.getByRole('region', { name: 'Prizes' })).toBeInTheDocument()
  })

  it('needs a character at level 20 or higher', async () => {
    open(state(), {}, [tiny])

    expect(await spinButton()).toBeDisabled()
    expect(status()).toHaveTextContent('You need a character at level 20 or higher to spin.')
    expect(picker()).toBeDisabled()
    expect(within(picker()).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'No character at level 20 or higher',
      'Tiny (level 12, needs 20)',
    ])
  })

  it('says so for an account with no characters', async () => {
    open(state(), {}, [])

    expect(await spinButton()).toBeDisabled()
    expect(screen.getByText('You have no characters yet.')).toBeInTheDocument()
  })

  it('shows why a spin was refused and loads the wheel again', async () => {
    let loads = 0
    const { user } = open(state(), {
      'GET /wheel': () => json(200, ++loads === 1 ? state() : state({ today: spinOf() })),
      'POST /wheel/spin': () => json(409, { statusCode: 409, message: 'You have already spun today' }),
    })

    await user.click(await spinButton())

    expect(await screen.findByRole('alert')).toHaveTextContent('You have already spun today')
    expect(await screen.findByRole('button', { name: 'Come back tomorrow' })).toBeDisabled()
  })

  it('lists the big wins by anyone', async () => {
    open(state({ winners: [spinOf({ id: 4, character: 'Kael', prize: 'Jackpot', at: '2026-11-13T23:59:00.000Z' })] }))
    await spinButton()

    expect(within(screen.getByRole('region', { name: 'Big wins' })).getByRole('listitem')).toHaveTextContent('Kael won Jackpot13 Nov, 23:59')
    expect(within(screen.getByRole('region', { name: 'Your spins' })).getByText('You have not spun yet.')).toBeInTheDocument()
  })

  it('says so when it has no prizes', async () => {
    open(state({ prizes: [] }))

    expect(await spinButton()).toBeDisabled()
    expect(screen.getByText('The wheel has no prizes yet.')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Prizes' })).not.toBeInTheDocument()
  })

  it('says so when it cannot be loaded', async () => {
    mockApi({ 'GET /wheel': () => json(500, { statusCode: 500, message: 'Down' }) })
    renderRoute('/wheel', { me })

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the wheel.')
  })
})
