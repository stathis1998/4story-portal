import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { json, mockApi, sentBodies } from '../test/mock-api'
import { renderRoute } from '../test/render-route'

const gm = { userId: 1, username: 'moose', isGm: true }
const player = { userId: 2, username: 'plain', isGm: false }
const status = (state: string) => () => json(200, { state, worlds: [], channels: [] })

describe('GM link', () => {
  it('shows for a GM', async () => {
    mockApi()
    renderRoute('/characters', { me: gm })
    expect(await screen.findByRole('link', { name: 'GM' })).toBeInTheDocument()
  })

  it('is hidden for a non-GM', async () => {
    mockApi()
    renderRoute('/characters', { me: player })
    await screen.findByText('Signed in as')
    expect(screen.queryByRole('link', { name: 'GM' })).not.toBeInTheDocument()
  })
})

describe('teleport page', () => {
  it('sends a non-GM to /characters', async () => {
    mockApi()
    const { router } = renderRoute('/gm/teleport', { me: player })
    await waitFor(() => expect(router.state.location.pathname).toBe('/characters'))
  })

  it.each([
    ['connected', 'Connected'],
    ['login-failed', 'Login failed'],
  ])('shows the %s badge for a GM', async (state, label) => {
    mockApi({ 'GET /gm/status': status(state) })
    renderRoute('/gm/teleport', { me: gm })
    expect(await screen.findByRole('heading', { name: 'Teleport' })).toBeInTheDocument()
    expect(await screen.findByRole('status')).toHaveTextContent(label)
  })
})

describe('teleport page: sending', () => {
  const players = [
    { charId: 1, name: 'Kaelith', level: 50, className: 'Mage', world: 1, channel: 1, mapId: 0 },
    { charId: 2, name: 'Moosey', level: 40, className: 'Warrior', world: 1, channel: 2, mapId: 3 },
  ]
  const connected = () => json(200, { state: 'connected', worlds: [{ id: 1, name: 'Lapiris' }], channels: [1, 2] })
  const base = (extra: Parameters<typeof mockApi>[0] = {}) => ({
    'GET /gm/status': connected,
    'GET /gm/players': () => json(200, players),
    'GET /gm/locations': () => json(200, []),
    ...extra,
  })

  async function fill(user: ReturnType<typeof renderRoute>['user']) {
    await user.type(screen.getByLabelText('Map ID'), '0')
    await user.type(screen.getByLabelText('X'), '2800')
    await user.type(screen.getByLabelText('Height (Y)'), '50')
    await user.type(screen.getByLabelText('Z'), '5000')
  }

  it('lists players and filters by search', async () => {
    mockApi(base())
    const { user } = renderRoute('/gm/teleport', { me: gm })
    expect(await screen.findByText('Kaelith')).toBeInTheDocument()
    expect(screen.getByText('Moosey')).toBeInTheDocument()
    await user.type(screen.getByRole('searchbox'), 'kae')
    expect(screen.queryByText('Moosey')).not.toBeInTheDocument()
    expect(screen.getByText('Kaelith')).toBeInTheDocument()
  })

  it('shows the empty text', async () => {
    mockApi(base({ 'GET /gm/players': () => json(200, []) }))
    renderRoute('/gm/teleport', { me: gm })
    expect(await screen.findByText('No one is online right now.')).toBeInTheDocument()
  })

  it('sends the selected players to the coordinates', async () => {
    const fetchMock = mockApi(base({ 'POST /gm/teleport': () => json(202, { sent: true, names: ['Kaelith'] }) }))
    const { user } = renderRoute('/gm/teleport', { me: gm })
    await user.click(await screen.findByRole('checkbox', { name: 'Select Kaelith' }))
    await fill(user)
    await user.click(screen.getByRole('button', { name: 'Teleport 1 player' }))
    expect(
      await screen.findByText("Sent to Kaelith. The game doesn't confirm teleports, so check in game."),
    ).toBeInTheDocument()
    expect(sentBodies(fetchMock, 'POST /gm/teleport')).toEqual([
      {
        names: ['Kaelith'],
        destination: { kind: 'position', world: 1, channel: 1, mapId: 0, x: 2800, y: 50, z: 5000 },
      },
    ])
  })

  it.each([
    [409, 'Not online: Kaelith'],
    [503, 'Game server is not connected'],
  ])('shows a %d error', async (status, message) => {
    mockApi(base({ 'POST /gm/teleport': () => json(status, { statusCode: status, message }) }))
    const { user } = renderRoute('/gm/teleport', { me: gm })
    await user.click(await screen.findByRole('checkbox', { name: 'Select Kaelith' }))
    await fill(user)
    await user.click(screen.getByRole('button', { name: 'Teleport 1 player' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
  })

  it('disables sending when the game server is disconnected', async () => {
    mockApi(base({ 'GET /gm/status': () => json(200, { state: 'disconnected', worlds: [], channels: [] }) }))
    const { user } = renderRoute('/gm/teleport', { me: gm })
    await user.click(await screen.findByRole('checkbox', { name: 'Select Kaelith' }))
    expect(await screen.findByRole('button', { name: /^Teleport 1 player/ })).toBeDisabled()
    expect(screen.getAllByText('Game server is not connected').length).toBeGreaterThan(0)
  })

  it('drops selected players that are no longer online', async () => {
    let list = players
    mockApi(base({ 'GET /gm/players': () => json(200, list) }))
    const { user } = renderRoute('/gm/teleport', { me: gm })
    await user.click(await screen.findByRole('checkbox', { name: 'Select Kaelith' }))
    expect(screen.getByText('1 selected')).toBeInTheDocument()
    list = [players[1]]
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByText('0 selected')).toBeInTheDocument()
  })
})
