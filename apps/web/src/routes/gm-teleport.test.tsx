import { screen, waitFor, within } from '@testing-library/react'
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
  const lonbaley = { name: 'Lonbaley Training Camp', mapId: 0, x: 2850.52, y: 68.36, z: 5004.94 }
  const kokuma = { name: 'Old Kokuma (Past)', mapId: 3, x: 100, y: 5, z: 200 }
  const places = {
    maps: [
      { id: 0, name: 'Overworld' },
      { id: 3, name: 'Kobold Mines' },
      { id: 7, name: null },
    ],
    destinations: [lonbaley, kokuma],
  }
  const base = (extra: Parameters<typeof mockApi>[0] = {}) => ({
    'GET /gm/status': connected,
    'GET /gm/players': () => json(200, players),
    'GET /gm/locations': () => json(200, []),
    'GET /gm/places': () => json(200, places),
    ...extra,
  })

  async function fill(user: ReturnType<typeof renderRoute>['user']) {
    await user.selectOptions(screen.getByLabelText('Map'), '0')
    await user.type(screen.getByLabelText('X'), '2800')
    await user.type(screen.getByLabelText('Height (Y)'), '50')
    await user.type(screen.getByLabelText('Z'), '5000')
  }

  it('lists players and filters by search', async () => {
    mockApi(base())
    const { user } = renderRoute('/gm/teleport', { me: gm })
    expect(await screen.findByRole('checkbox', { name: 'Select Kaelith' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select Moosey' })).toBeInTheDocument()
    await user.type(screen.getByRole('searchbox'), 'kae')
    expect(screen.queryByRole('checkbox', { name: 'Select Moosey' })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select Kaelith' })).toBeInTheDocument()
  })

  it('shows the empty text', async () => {
    mockApi(base({ 'GET /gm/players': () => json(200, []) }))
    renderRoute('/gm/teleport', { me: gm })
    expect(await screen.findByText('No one is online right now.')).toBeInTheDocument()
  })

  it('shows an error, not the empty text, when the players fail to load', async () => {
    mockApi(base({ 'GET /gm/players': () => json(500, { statusCode: 500, message: 'Internal server error' }) }))
    renderRoute('/gm/teleport', { me: gm })
    expect(await screen.findByText('Could not load online players.')).toBeInTheDocument()
    expect(screen.queryByText('No one is online right now.')).not.toBeInTheDocument()
  })

  it('shows an error and no destination panel when the status fails to load', async () => {
    mockApi(base({ 'GET /gm/status': () => json(500, { statusCode: 500, message: 'Internal server error' }) }))
    renderRoute('/gm/teleport', { me: gm })
    expect(await screen.findByText('Could not load the game server status.')).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Coordinates' })).not.toBeInTheDocument()
  })

  it('shows the API message when the saved locations fail to load, and passes it through on save', async () => {
    const invalid = () => json(500, { statusCode: 500, message: 'Preset file is invalid' })
    mockApi(base({ 'GET /gm/locations': invalid, 'POST /gm/locations': invalid }))
    const { user } = renderRoute('/gm/teleport', { me: gm })
    expect(await screen.findByText('Preset file is invalid')).toBeInTheDocument()
    expect(screen.queryByText('No saved locations yet.')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save as preset' }))
    await fill(user)
    await user.type(screen.getByLabelText('Preset name'), 'Gate')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getAllByText('Preset file is invalid')).toHaveLength(2))
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
    expect(screen.getAllByText('Select at most 20 players').length).toBeGreaterThan(0)
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

  describe('places', () => {
    it('lists hosted maps by name in the map dropdown', async () => {
      mockApi(base())
      renderRoute('/gm/teleport', { me: gm })

      const map = await screen.findByLabelText('Map')

      const labels = within(map).getAllByRole('option').map((option) => option.textContent)
      expect(labels).toEqual(['0 – Overworld', '3 – Kobold Mines', 'Map 7'])
    })

    it('shows map names in the players table', async () => {
      const onMap7 = { charId: 3, name: 'Thornwick', level: 9, className: 'Archer', world: 1, channel: 1, mapId: 7 }
      mockApi(base({ 'GET /gm/players': () => json(200, [...players, onMap7]) }))
      renderRoute('/gm/teleport', { me: gm })

      expect(await screen.findByRole('cell', { name: 'Overworld' })).toBeInTheDocument()
      expect(screen.getByRole('cell', { name: 'Kobold Mines' })).toBeInTheDocument()
      expect(screen.getByRole('cell', { name: 'Map 7' })).toBeInTheDocument()
    })

    it('fills map and coordinates from a destination, leaving the channel alone and sending nothing', async () => {
      const fetchMock = mockApi(base())
      const { user } = renderRoute('/gm/teleport', { me: gm })
      await user.selectOptions(await screen.findByLabelText('Channel'), '2')

      await user.type(screen.getByLabelText('Find a destination'), 'lonb')
      await user.click(screen.getByRole('button', { name: /Lonbaley Training Camp/ }))

      expect(screen.getByLabelText('Map')).toHaveValue('0')
      expect(screen.getByLabelText('X')).toHaveValue(2850.52)
      expect(screen.getByLabelText('Height (Y)')).toHaveValue(68.36)
      expect(screen.getByLabelText('Z')).toHaveValue(5004.94)
      expect(screen.getByLabelText('Channel')).toHaveValue('2')
      expect(screen.getByLabelText('Find a destination')).toHaveValue('')
      expect(screen.queryByRole('button', { name: /Lonbaley Training Camp/ })).not.toBeInTheDocument()
      expect(sentBodies(fetchMock, 'POST /gm/teleport')).toEqual([])
    })

    it('sends the destination it filled in', async () => {
      const fetchMock = mockApi(base({ 'POST /gm/teleport': () => json(202, { sent: true, names: ['Kaelith'] }) }))
      const { user } = renderRoute('/gm/teleport', { me: gm })
      await user.click(await screen.findByRole('checkbox', { name: 'Select Kaelith' }))

      await user.type(await screen.findByLabelText('Find a destination'), 'kokuma')
      await user.click(screen.getByRole('button', { name: /Old Kokuma/ }))
      await user.click(screen.getByRole('button', { name: 'Teleport 1 player' }))

      await screen.findByText(/^Sent to Kaelith/)
      expect(sentBodies(fetchMock, 'POST /gm/teleport')).toEqual([
        {
          names: ['Kaelith'],
          destination: { kind: 'position', world: 1, channel: 1, mapId: 3, x: 100, y: 5, z: 200 },
        },
      ])
    })

    it('matches any part of a name, ignoring case, and shows which map it is on', async () => {
      mockApi(base())
      const { user } = renderRoute('/gm/teleport', { me: gm })

      await user.type(await screen.findByLabelText('Find a destination'), 'TRAINING')

      expect(screen.getByRole('button', { name: /Lonbaley Training Camp.*Overworld/ })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Old Kokuma/ })).not.toBeInTheDocument()
    })

    it('says when nothing matches', async () => {
      mockApi(base())
      const { user } = renderRoute('/gm/teleport', { me: gm })

      await user.type(await screen.findByLabelText('Find a destination'), 'nowhere')

      expect(screen.getByText('No matching destination.')).toBeInTheDocument()
    })

    it('shows at most 8 matches and says how many there are', async () => {
      const camps = Array.from({ length: 10 }, (_, i) => ({ ...lonbaley, name: `Camp ${i}` }))
      mockApi(base({ 'GET /gm/places': () => json(200, { ...places, destinations: camps }) }))
      const { user } = renderRoute('/gm/teleport', { me: gm })

      await user.type(await screen.findByLabelText('Find a destination'), 'camp')

      expect(screen.getAllByRole('button', { name: /^Camp \d/ })).toHaveLength(8)
      expect(screen.getByText('Showing 8 of 10. Keep typing to narrow it down.')).toBeInTheDocument()
    })

    it('keeps a preset on a map that is no longer hosted selectable', async () => {
      const old = { id: 'loc9', name: 'Old spot', world: 1, channel: 1, mapId: 700, x: 1, y: 2, z: 3 }
      mockApi(base({ 'GET /gm/locations': () => json(200, [old]) }))
      const { user } = renderRoute('/gm/teleport', { me: gm })

      await user.click(await screen.findByRole('button', { name: 'Old spot' }))

      expect(screen.getByLabelText('Map')).toHaveValue('700')
      expect(screen.getByRole('option', { name: 'Map 700 (not hosted)' })).toBeInTheDocument()
    })

    it('falls back to typing a map ID and bare IDs in the table when places fail to load', async () => {
      const fetchMock = mockApi(
        base({
          'GET /gm/places': () => json(500, { statusCode: 500, message: 'Internal server error' }),
          'POST /gm/teleport': () => json(202, { sent: true, names: ['Kaelith'] }),
        }),
      )
      const { user } = renderRoute('/gm/teleport', { me: gm })

      expect(await screen.findByRole('alert')).toHaveTextContent('Could not load map names.')
      expect(screen.queryByLabelText('Find a destination')).not.toBeInTheDocument()
      expect(await screen.findByRole('cell', { name: '3' })).toBeInTheDocument()

      await user.click(screen.getByRole('checkbox', { name: 'Select Kaelith' }))
      await user.type(await screen.findByLabelText('Map ID'), '13')
      await user.type(screen.getByLabelText('X'), '2800')
      await user.type(screen.getByLabelText('Height (Y)'), '50')
      await user.type(screen.getByLabelText('Z'), '5000')
      await user.click(screen.getByRole('button', { name: 'Teleport 1 player' }))

      await screen.findByText(/^Sent to Kaelith/)
      expect(sentBodies(fetchMock, 'POST /gm/teleport')).toEqual([
        { names: ['Kaelith'], destination: expect.objectContaining({ mapId: 13 }) },
      ])
    })
  })

  describe('presets and character target', () => {
    const town = { id: 'loc1', name: 'Town square', world: 1, channel: 2, mapId: 7, x: 2800, y: 50, z: 5000 }

    it('fills the fields from a preset', async () => {
      mockApi(base({ 'GET /gm/locations': () => json(200, [town]) }))
      const { user } = renderRoute('/gm/teleport', { me: gm })
      await user.click(await screen.findByRole('button', { name: 'Town square' }))
      expect(screen.getByLabelText('Map')).toHaveValue('7')
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

    it('shows an error when deleting a preset fails', async () => {
      mockApi(
        base({
          'GET /gm/locations': () => json(200, [town]),
          'DELETE /gm/locations/loc1': () => json(404, { statusCode: 404, message: 'Preset not found' }),
        }),
      )
      const { user } = renderRoute('/gm/teleport', { me: gm })
      await user.click(await screen.findByRole('button', { name: 'Delete Town square' }))
      await user.click(screen.getByRole('button', { name: 'Delete' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('Preset not found')
    })

    it('keeps typed coordinates when switching tabs', async () => {
      mockApi(base())
      const { user } = renderRoute('/gm/teleport', { me: gm })
      await user.type(await screen.findByLabelText('X'), '2800')
      await user.click(screen.getByRole('tab', { name: 'Character' }))
      await user.click(screen.getByRole('tab', { name: 'Coordinates' }))
      expect(screen.getByLabelText('X')).toHaveValue(2800)
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
