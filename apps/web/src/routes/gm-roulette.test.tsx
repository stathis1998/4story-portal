import type { GmRoulette, RouletteSpinView } from '@4story-portal/shared'
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { json, mockApi, sentBodies } from '../test/mock-api'
import { renderRoute } from '../test/render-route'

const gm = { userId: 1, username: 'moose', isGm: true }

const spin = (overrides: Partial<RouletteSpinView> = {}): RouletteSpinView => ({
  id: 1,
  at: '2026-11-14T09:05:00.000Z',
  character: 'Moosey',
  pocket: 17,
  stake: 500,
  payout: 0,
  ...overrides,
})

const state = (overrides: Partial<GmRoulette> = {}): GmRoulette => ({
  live: false,
  limits: { minBet: 10, maxNumber: 1000, maxOutside: 10_000 },
  today: { spins: 3, staked: 2500, paid: 1000 },
  allTime: { spins: 120, staked: 1_500_000, paid: 1_400_000 },
  latest: [spin(), spin({ id: 2, at: '2026-11-13T21:30:00.000Z', character: 'Mounara', pocket: 0, stake: 100, payout: 3600 })],
  ...overrides,
})

const base = (extra: Parameters<typeof mockApi>[0] = {}, current: GmRoulette = state()) => ({
  'GET /gm/roulette': () => json(200, current),
  ...extra,
})

const status = async () => within(await screen.findByRole('region', { name: 'Status' }))
const totals = async (name: string) => within(await screen.findByRole('region', { name }))

describe('GM roulette page', () => {
  it('is linked from the GM menu and shows the switch, limits and totals', async () => {
    mockApi(base({ 'GET /gm/logins': () => json(200, []) }))
    const { user } = renderRoute('/gm/logins', { me: gm })

    await user.click(within(await screen.findByRole('navigation', { name: 'GM tools' })).getByRole('link', { name: 'Roulette' }))

    expect(await screen.findByRole('heading', { name: 'Roulette', level: 1 })).toBeInTheDocument()
    const row = await status()
    expect(row.getByRole('switch', { name: 'Table open' })).not.toBeChecked()
    expect(row.getByText('Players see the table and cannot bet.')).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Smallest bet' })).toHaveValue(10)
    expect(screen.getByRole('spinbutton', { name: 'Largest bet on a number' })).toHaveValue(1000)
    expect(screen.getByRole('spinbutton', { name: 'Largest bet on another spot' })).toHaveValue(10_000)
    expect(screen.getByText('10 Gold')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save limits' })).toBeInTheDocument()

    const today = await totals('Today')
    expect(today.getByText('Spins').nextElementSibling).toHaveTextContent('3')
    expect(today.getByText('Staked').nextElementSibling).toHaveTextContent('2 Gold 500 Silver')
    expect(today.getByText('Paid out').nextElementSibling).toHaveTextContent('1 Gold')
    expect(today.getByText('House result').nextElementSibling).toHaveTextContent('1 Gold 500 Silver')
    const allTime = await totals('All time')
    expect(allTime.getByText('Spins').nextElementSibling).toHaveTextContent('120')
    expect(allTime.getByText('House result').nextElementSibling).toHaveTextContent('100 Gold')
  })

  it('opens and closes the table', async () => {
    const fetchMock = mockApi(base({ 'PUT /gm/roulette/settings': () => json(200, state({ live: true })) }))
    const { user } = renderRoute('/gm/roulette', { me: gm })

    await user.click((await status()).getByRole('switch', { name: 'Table open' }))

    await waitFor(() => expect(screen.getByRole('switch', { name: 'Table open' })).toBeChecked())
    expect(sentBodies(fetchMock, 'PUT /gm/roulette/settings')).toEqual([{ live: true, minBet: 10, maxNumber: 1000, maxOutside: 10_000 }])
    expect(screen.getByText('Players can bet.')).toBeInTheDocument()
  })

  it('closes an open table with the current limits', async () => {
    const fetchMock = mockApi(base({ 'PUT /gm/roulette/settings': () => json(200, state()) }, state({ live: true })))
    const { user } = renderRoute('/gm/roulette', { me: gm })

    await user.click((await status()).getByRole('switch', { name: 'Table open' }))

    await waitFor(() => expect(screen.getByRole('switch', { name: 'Table open' })).not.toBeChecked())
    expect(sentBodies(fetchMock, 'PUT /gm/roulette/settings')).toEqual([{ live: false, minBet: 10, maxNumber: 1000, maxOutside: 10_000 }])
  })

  it('shows why the switch could not be saved', async () => {
    mockApi(base({ 'PUT /gm/roulette/settings': () => json(403, { statusCode: 403, message: 'Not allowed' }) }))
    const { user } = renderRoute('/gm/roulette', { me: gm })

    await user.click((await status()).getByRole('switch', { name: 'Table open' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Not allowed')
  })

  it('saves new limits', async () => {
    const next = state({ live: true, limits: { minBet: 50, maxNumber: 2000, maxOutside: 20_000 } })
    const fetchMock = mockApi(base({ 'PUT /gm/roulette/settings': () => json(200, next) }, state({ live: true })))
    const { user } = renderRoute('/gm/roulette', { me: gm })

    const smallest = await screen.findByRole('spinbutton', { name: 'Smallest bet' })
    await user.clear(smallest)
    await user.type(smallest, '50')
    await user.clear(screen.getByRole('spinbutton', { name: 'Largest bet on a number' }))
    await user.type(screen.getByRole('spinbutton', { name: 'Largest bet on a number' }), '2000')
    await user.clear(screen.getByRole('spinbutton', { name: 'Largest bet on another spot' }))
    await user.type(screen.getByRole('spinbutton', { name: 'Largest bet on another spot' }), '20000')
    expect(screen.getByText('20 Gold')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save limits' }))

    await waitFor(() => expect(sentBodies(fetchMock, 'PUT /gm/roulette/settings')).toHaveLength(1))
    expect(sentBodies(fetchMock, 'PUT /gm/roulette/settings')).toEqual([{ live: true, minBet: 50, maxNumber: 2000, maxOutside: 20_000 }])
    await waitFor(() => expect(screen.getByRole('spinbutton', { name: 'Smallest bet' })).toHaveValue(50))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not send a smallest bet above a largest', async () => {
    const fetchMock = mockApi(base())
    const { user } = renderRoute('/gm/roulette', { me: gm })

    const smallest = await screen.findByRole('spinbutton', { name: 'Smallest bet' })
    await user.clear(smallest)
    await user.type(smallest, '5000')
    await user.click(screen.getByRole('button', { name: 'Save limits' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('The smallest bet cannot be larger than a largest bet')
    expect(smallest).toHaveAttribute('aria-invalid', 'true')
    expect(sentBodies(fetchMock, 'PUT /gm/roulette/settings')).toEqual([])
  })

  it('does not send a limit that is not a whole number', async () => {
    const fetchMock = mockApi(base())
    const { user } = renderRoute('/gm/roulette', { me: gm })

    await user.clear(await screen.findByRole('spinbutton', { name: 'Largest bet on a number' }))
    await user.click(screen.getByRole('button', { name: 'Save limits' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a whole number')
    expect(sentBodies(fetchMock, 'PUT /gm/roulette/settings')).toEqual([])
  })

  it('shows the house down when it has paid more than it took', async () => {
    mockApi(base({}, state({ today: { spins: 1, staked: 1000, paid: 3600 } })))
    renderRoute('/gm/roulette', { me: gm })

    expect((await totals('Today')).getByText('House result').nextElementSibling).toHaveTextContent('-2 Gold 600 Silver')
  })

  it('lists the latest spins', async () => {
    mockApi(base())
    renderRoute('/gm/roulette', { me: gm })

    const table = await screen.findByRole('table')
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['When', 'Character', 'Number', 'Staked', 'Paid'])
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent))).toEqual([
      ['14 Nov, 09:05', 'Moosey', '17 black', '500 Silver', '0 Silver'],
      ['13 Nov, 21:30', 'Mounara', '0 green', '100 Silver', '3 Gold 600 Silver'],
    ])
  })

  it('says so when nobody has spun', async () => {
    mockApi(base({}, state({ latest: [] })))
    renderRoute('/gm/roulette', { me: gm })

    expect(await screen.findByText('Nobody has spun yet.')).toBeInTheDocument()
  })

  it('sends a non-GM to /characters', async () => {
    mockApi()
    const { router } = renderRoute('/gm/roulette', { me: { userId: 2, username: 'plain', isGm: false } })
    await waitFor(() => expect(router.state.location.pathname).toBe('/characters'))
  })

  it('says so when the page cannot be loaded', async () => {
    mockApi({ 'GET /gm/roulette': () => json(500, { statusCode: 500, message: 'Down' }) })
    renderRoute('/gm/roulette', { me: gm })

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the roulette table.')
  })
})
