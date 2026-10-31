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

  it('caps the selection at 20 players', async () => {
    const many = Array.from({ length: 21 }, (_, i) => ({
      charId: i,
      name: 'Player' + i,
      level: 1,
      className: 'Mage',
      world: 1,
      channel: 1,
      mapId: 0,
    }))
    mockApi(base({ 'GET /gm/players': () => json(200, many) }))
    const { user } = renderRoute('/gm/teleport', { me: gm })
    await user.click(await screen.findByRole('checkbox', { name: 'Select all' }))
    expect(screen.getByRole('button', { name: 'Teleport 21 players' })).toBeDisabled()
    expect(screen.getByText('Select at most 20 players')).toBeInTheDocument()
  })

  it('shows server validation errors on fields the form lacks', async () => {
    mockApi(
      base({
        'POST /gm/teleport': () =>
          json(400, { statusCode: 400, message: 'Validation failed', fieldErrors: { names: ['Names must be unique'] } }),
      }),
    )
    const { user } = renderRoute('/gm/teleport', { me: gm })
    await user.click(await screen.findByRole('checkbox', { name: 'Select Kaelith' }))
    await fill(user)
    await user.click(screen.getByRole('button', { name: 'Teleport 1 player' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Names must be unique')
  })

  describe('presets and character target', () => {
    const town = { id: 'loc1', name: 'Town square', world: 1, channel: 2, mapId: 7, x: 2800, y: 50, z: 5000 }

    it('fills the fields from a preset', async () => {
      mockApi(base({ 'GET /gm/locations': () => json(200, [town]) }))
      const { user } = renderRoute('/gm/teleport', { me: gm })
      await user.click(await screen.findByRole('button', { name: 'Town square' }))
      expect(screen.getByLabelText('Map ID')).toHaveValue(7)
      expect(screen.getByLabelText('X')).toHaveValue(2800)
      expect(screen.getByLabelText('Height (Y)')).toHaveValue(50)
      expect(screen.getByLabelText('Z')).toHaveValue(5000)
      expect(screen.getByLabelText('Channel')).toHaveValue('2')
    })

    it('shows the empty presets text', async () => {
      mockApi(base())
      renderRoute('/gm/teleport', { me: gm })
      expect(await screen.findByText('No saved locations yet.')).toBeInTheDocument()
    })

    it('saves the current position as a preset', async () => {
      let saved: unknown[] = []
      const fetchMock = mockApi(
        base({
          'GET /gm/locations': () => json(200, saved),
          'POST /gm/locations': (body) => {
            saved = [{ id: 'new1', ...(body as object) }]
            return json(201, saved[0])
          },
        }),
      )
      const { user } = renderRoute('/gm/teleport', { me: gm })
      await user.click(await screen.findByRole('button', { name: 'Save as preset' }))
      await fill(user)
      await user.type(screen.getByLabelText('Preset name'), 'Gate')
      await user.click(screen.getByRole('button', { name: 'Save' }))
      expect(await screen.findByRole('button', { name: 'Gate' })).toBeInTheDocument()
      expect(sentBodies(fetchMock, 'POST /gm/locations')).toEqual([
        { name: 'Gate', world: 1, channel: 1, mapId: 0, x: 2800, y: 50, z: 5000 },
      ])
    })

    it('shows a validation error when saving without a name', async () => {
      mockApi(base())
      const { user } = renderRoute('/gm/teleport', { me: gm })
      await user.click(await screen.findByRole('button', { name: 'Save as preset' }))
      await fill(user)
      await user.click(screen.getByRole('button', { name: 'Save' }))
      expect(await screen.findByRole('alert')).toBeInTheDocument()
    })

    it('deletes a preset after confirming', async () => {
      const fetchMock = mockApi(
        base({
          'GET /gm/locations': () => json(200, [town]),
          'DELETE /gm/locations/loc1': () => json(204),
        }),
      )
      const { user } = renderRoute('/gm/teleport', { me: gm })
      await user.click(await screen.findByRole('button', { name: 'Delete Town square' }))
      expect(screen.getByText('Delete?')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Delete' }))
      await waitFor(() =>
        expect(fetchMock.mock.calls.some(([url, init]) => url === '/api/gm/locations/loc1' && init?.method === 'DELETE')).toBe(
          true,
        ),
      )
    })

    it('teleports to a character', async () => {
      const fetchMock = mockApi(base({ 'POST /gm/teleport': () => json(202, { sent: true, names: ['Kaelith'] }) }))
      const { user } = renderRoute('/gm/teleport', { me: gm })
      await user.click(await screen.findByRole('checkbox', { name: 'Select Kaelith' }))
      await user.click(screen.getByRole('tab', { name: 'Character' }))
      const target = screen.getByLabelText('Target character')
      expect(screen.queryByRole('option', { name: 'Kaelith' })).not.toBeInTheDocument()
      expect(screen.getByText('Choose a target character')).toBeInTheDocument()
      await user.selectOptions(target, 'Moosey')
      await user.click(screen.getByRole('button', { name: 'Teleport 1 player' }))
      expect(await screen.findByText(/^Sent to Kaelith/)).toBeInTheDocument()
      expect(sentBodies(fetchMock, 'POST /gm/teleport')).toEqual([
        { names: ['Kaelith'], destination: { kind: 'character', world: 1, target: 'Moosey' } },
      ])
    })
  })
})
