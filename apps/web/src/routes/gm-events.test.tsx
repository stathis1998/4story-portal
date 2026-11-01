import type { GmEvent } from '@4story-portal/shared'
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { json, mockApi, sentBodies } from '../test/mock-api'
import { renderRoute } from '../test/render-route'

const gm = { userId: 1, username: 'moose', isGm: true }
const player = { userId: 2, username: 'plain', isGm: false }
const connected = () => json(200, { state: 'connected', worlds: [{ id: 1, name: 'Lapiris' }], channels: [1] })
const SERVER_NOW = '2026-11-01T16:30'

const weekend: GmEvent = {
  index: 4,
  type: 1,
  typeName: 'EXP',
  editable: true,
  running: true,
  world: 1,
  title: 'Weekend EXP',
  bonus: 100,
  mapId: null,
  schedule: { mode: 'period', start: '2026-11-06T18:00', end: '2026-11-08T23:00' },
  startMessage: 'EXP +100% event has started!',
  endMessage: 'EXP +100% event ends in 1 minute.',
  startNoticeMinutes: 0,
  endNoticeMinutes: 1,
}

const evenings: GmEvent = {
  ...weekend,
  index: 5,
  type: 3,
  typeName: 'Item drop',
  running: false,
  title: 'Evening drops',
  bonus: 50,
  schedule: { mode: 'daily', start: '2026-11-01T20:00', end: '2026-11-07T22:00' },
}

const onOneMap: GmEvent = { ...evenings, index: 6, title: 'Sand drops', mapId: 600 }

const boss: GmEvent = {
  ...weekend,
  index: 7,
  type: 12,
  typeName: 'Monster spawn',
  editable: false,
  title: 'Boss night',
  bonus: null,
}

const places = { maps: [{ id: 0, name: 'Sand Wind' }, { id: 600, name: null }], destinations: [] }

const base = (events: GmEvent[], extra: Parameters<typeof mockApi>[0] = {}) => ({
  'GET /gm/status': connected,
  'GET /gm/places': () => json(200, places),
  'GET /gm/events': () => json(200, { serverNow: SERVER_NOW, events }),
  ...extra,
})

const rowOf = async (title: string) => (await screen.findByRole('cell', { name: title })).closest('tr')!

describe('events page', () => {
  it('sends a non-GM to /characters', async () => {
    mockApi()
    const { router } = renderRoute('/gm/events', { me: player })
    await waitFor(() => expect(router.state.location.pathname).toBe('/characters'))
  })

  it('is reachable from the other GM pages', async () => {
    mockApi(base([], { 'GET /gm/logins': () => json(200, []) }))
    const { user } = renderRoute('/gm/logins', { me: gm })

    await user.click(await screen.findByRole('link', { name: 'Events' }))

    expect(await screen.findByRole('heading', { name: 'Events' })).toBeInTheDocument()
  })

  it('shows a one period event', async () => {
    mockApi(base([weekend]))
    renderRoute('/gm/events', { me: gm })

    const row = within(await rowOf('Weekend EXP'))
    expect(row.getByRole('cell', { name: 'EXP' })).toBeInTheDocument()
    expect(row.getByRole('cell', { name: '+100%' })).toBeInTheDocument()
    expect(row.getByRole('cell', { name: '6 Nov 18:00 → 8 Nov 23:00' })).toBeInTheDocument()
    expect(row.getByRole('cell', { name: 'Running' })).toBeInTheDocument()
  })

  it('shows a daily event as waiting', async () => {
    mockApi(base([evenings]))
    renderRoute('/gm/events', { me: gm })

    const row = within(await rowOf('Evening drops'))
    expect(row.getByRole('cell', { name: 'Daily 20:00–22:00, 1–7 Nov' })).toBeInTheDocument()
    expect(row.getByRole('cell', { name: 'Waiting' })).toBeInTheDocument()
  })

  it('names the month on both sides of a daily range crossing months', async () => {
    const schedule = { mode: 'daily' as const, start: '2026-11-28T20:00', end: '2026-12-03T22:00' }
    mockApi(base([{ ...evenings, schedule }]))
    renderRoute('/gm/events', { me: gm })

    expect(await screen.findByRole('cell', { name: 'Daily 20:00–22:00, 28 Nov – 3 Dec' })).toBeInTheDocument()
  })

  it('shows one date for a daily event on a single day', async () => {
    const schedule = { mode: 'daily' as const, start: '2026-11-01T20:00', end: '2026-11-01T22:00' }
    mockApi(base([{ ...evenings, schedule }]))
    renderRoute('/gm/events', { me: gm })

    expect(await screen.findByRole('cell', { name: 'Daily 20:00–22:00, 1 Nov' })).toBeInTheDocument()
  })

  it('shows the map only for drop types', async () => {
    mockApi(base([weekend, evenings, onOneMap]))
    renderRoute('/gm/events', { me: gm })

    expect(within(await rowOf('Evening drops')).getByRole('cell', { name: 'All maps' })).toBeInTheDocument()
    expect(within(await rowOf('Sand drops')).getByRole('cell', { name: 'Map 600' })).toBeInTheDocument()
    expect(within(await rowOf('Weekend EXP')).queryByRole('cell', { name: 'All maps' })).not.toBeInTheDocument()
  })

  it('lets a special event be stopped but not edited, with no bonus', async () => {
    mockApi(base([boss]))
    renderRoute('/gm/events', { me: gm })

    const row = within(await rowOf('Boss night'))
    expect(row.getByRole('button', { name: 'Stop Boss night' })).toBeInTheDocument()
    expect(row.queryByRole('button', { name: 'Edit Boss night' })).not.toBeInTheDocument()
    expect(row.queryByText(/\+\d+%/)).not.toBeInTheDocument()
  })

  it('stops a running event only after confirming, saying the bonus ends now', async () => {
    const fetchMock = mockApi(base([weekend], { 'DELETE /gm/events/4': () => json(204) }))
    const { user } = renderRoute('/gm/events', { me: gm })
    const deletes = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE')

    await user.click(await screen.findByRole('button', { name: 'Stop Weekend EXP' }))
    expect(screen.getByText(/Stop Weekend EXP\? The bonus ends now\./)).toBeInTheDocument()
    expect(deletes()).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Stop' }))

    await waitFor(() => expect(deletes()).toHaveLength(1))
    expect(String(deletes()[0][0])).toBe('/api/gm/events/4')
  })

  it('can cancel stopping', async () => {
    mockApi(base([weekend]))
    const { user } = renderRoute('/gm/events', { me: gm })

    await user.click(await screen.findByRole('button', { name: 'Stop Weekend EXP' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByRole('button', { name: 'Stop Weekend EXP' })).toBeInTheDocument()
  })

  it('offers Delete for an event that is not running, without talking about a bonus ending', async () => {
    mockApi(base([evenings]))
    const { user } = renderRoute('/gm/events', { me: gm })

    await user.click(await screen.findByRole('button', { name: 'Delete Evening drops' }))

    expect(screen.getByText(/Delete Evening drops\? It will not run\./)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it('says a running special event ends now, not its bonus', async () => {
    mockApi(base([boss]))
    const { user } = renderRoute('/gm/events', { me: gm })

    await user.click(await screen.findByRole('button', { name: 'Stop Boss night' }))

    expect(screen.getByText(/Stop Boss night\? It ends now\./)).toBeInTheDocument()
  })

  it('shows why a stop failed', async () => {
    mockApi(
      base([weekend], {
        'DELETE /gm/events/4': () => json(404, { statusCode: 404, message: 'That event has already ended or been removed' }),
      }),
    )
    const { user } = renderRoute('/gm/events', { me: gm })

    await user.click(await screen.findByRole('button', { name: 'Stop Weekend EXP' }))
    await user.click(screen.getByRole('button', { name: 'Stop' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('That event has already ended or been removed')
  })

  it('says when there are no events', async () => {
    mockApi(base([]))
    renderRoute('/gm/events', { me: gm })

    expect(await screen.findByText('No events are scheduled.')).toBeInTheDocument()
  })

  it('says so and offers no changes while the game server is disconnected', async () => {
    mockApi(
      base([], {
        'GET /gm/status': () => json(200, { state: 'disconnected', worlds: [], channels: [] }),
        'GET /gm/events': () => json(503, { statusCode: 503, message: 'Game server is not connected' }),
      }),
    )
    renderRoute('/gm/events', { me: gm })

    expect(await screen.findByRole('status')).toHaveTextContent('Disconnected')
    expect(
      await screen.findByText("The game server isn't connected, so events can't be listed or changed."),
    ).toBeInTheDocument()
    expect(screen.queryByText('No events are scheduled.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New event' })).not.toBeInTheDocument()
  })
})

describe('event form', () => {
  type User = ReturnType<typeof renderRoute>['user']

  const open = async (user: User) => user.click(await screen.findByRole('button', { name: 'New event' }))

  const replace = async (user: User, label: string | RegExp, text: string) => {
    const field = screen.getByLabelText(label)
    await user.clear(field)
    await user.type(field, text)
  }

  const fillPeriod = async (user: User) => {
    await replace(user, 'Start date', '2026-11-06')
    await replace(user, 'Start time', '18:00')
    await replace(user, 'End date', '2026-11-08')
    await replace(user, 'End time', '23:00')
  }

  const saved = (body: unknown) => json(201, { ...weekend, ...(body as object), index: 9 })

  it('creates a one period EXP event with generated messages', async () => {
    const fetchMock = mockApi(base([], { 'POST /gm/events': saved }))
    const { user } = renderRoute('/gm/events', { me: gm })

    await open(user)
    await replace(user, 'Title', 'Weekend EXP')
    await replace(user, 'Bonus (%)', '100')
    await fillPeriod(user)
    await user.click(screen.getByRole('button', { name: 'Save event' }))

    await waitFor(() => expect(sentBodies(fetchMock, 'POST /gm/events')).toHaveLength(1))
    expect(sentBodies(fetchMock, 'POST /gm/events')[0]).toEqual({
      type: 1,
      world: 1,
      title: 'Weekend EXP',
      bonus: 100,
      mapId: null,
      schedule: { mode: 'period', start: '2026-11-06T18:00', end: '2026-11-08T23:00' },
      startMessage: 'EXP +100% event has started!',
      endMessage: 'EXP +100% event ends in 1 minute.',
      startNoticeMinutes: 0,
      endNoticeMinutes: 1,
    })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save event' })).not.toBeInTheDocument())
  })

  it('sends a daily event as first day with the from time and last day with the to time', async () => {
    const fetchMock = mockApi(base([], { 'POST /gm/events': saved }))
    const { user } = renderRoute('/gm/events', { me: gm })

    await open(user)
    await replace(user, 'Title', 'Evenings')
    await replace(user, 'Bonus (%)', '50')
    await user.selectOptions(screen.getByLabelText('Schedule'), 'Daily')
    await replace(user, 'First day', '2026-11-01')
    await replace(user, 'From', '20:00')
    await replace(user, 'Last day', '2026-11-07')
    await replace(user, 'To', '22:00')
    await user.click(screen.getByRole('button', { name: 'Save event' }))

    await waitFor(() => expect(sentBodies(fetchMock, 'POST /gm/events')).toHaveLength(1))
    expect(sentBodies(fetchMock, 'POST /gm/events')[0]).toMatchObject({
      schedule: { mode: 'daily', start: '2026-11-01T20:00', end: '2026-11-07T22:00' },
    })
  })

  it('shows the map only for drop types, defaulting to all maps', async () => {
    const fetchMock = mockApi(base([], { 'POST /gm/events': saved }))
    const { user } = renderRoute('/gm/events', { me: gm })

    await open(user)
    expect(screen.queryByLabelText('Map')).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Type'), 'Item drop')
    expect(screen.getByLabelText('Map')).toHaveDisplayValue('All maps')

    await replace(user, 'Title', 'Drops')
    await replace(user, 'Bonus (%)', '50')
    await fillPeriod(user)
    await user.click(screen.getByRole('button', { name: 'Save event' }))

    await waitFor(() => expect(sentBodies(fetchMock, 'POST /gm/events')).toHaveLength(1))
    expect(sentBodies(fetchMock, 'POST /gm/events')[0]).toMatchObject({ type: 3, mapId: null })
  })

  it('sends a chosen map, including map 0', async () => {
    const fetchMock = mockApi(base([], { 'POST /gm/events': saved }))
    const { user } = renderRoute('/gm/events', { me: gm })

    await open(user)
    await user.selectOptions(screen.getByLabelText('Type'), 'Money drop')
    await user.selectOptions(await screen.findByLabelText('Map'), '0 – Sand Wind')
    await replace(user, 'Title', 'Money')
    await replace(user, 'Bonus (%)', '50')
    await fillPeriod(user)
    await user.click(screen.getByRole('button', { name: 'Save event' }))

    await waitFor(() => expect(sentBodies(fetchMock, 'POST /gm/events')).toHaveLength(1))
    expect(sentBodies(fetchMock, 'POST /gm/events')[0]).toMatchObject({ type: 11, mapId: 0 })
  })

  it('explains the bonus in terms of the type', async () => {
    mockApi(base([]))
    const { user } = renderRoute('/gm/events', { me: gm })

    await open(user)
    expect(screen.getByText('+100% = double EXP from kills')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Type'), 'Refine')
    expect(screen.getByText('+100% = double the chance of success, up to 100%')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Type'), 'Money drop')
    expect(screen.getByText('+100% = double the money monsters drop')).toBeInTheDocument()
  })

  it('keeps generated messages in step until the GM edits one', async () => {
    mockApi(base([]))
    const { user } = renderRoute('/gm/events', { me: gm })

    await open(user)
    await replace(user, 'Bonus (%)', '50')
    await user.selectOptions(screen.getByLabelText('Type'), 'Item drop')
    expect(screen.getByLabelText('Start message')).toHaveValue('Item drop +50% event has started!')

    await replace(user, 'Minutes before start', '5')
    expect(screen.getByLabelText('Start message')).toHaveValue('Item drop +50% event starts in 5 minutes.')

    await replace(user, 'Minutes before end', '10')
    expect(screen.getByLabelText('End message')).toHaveValue('Item drop +50% event ends in 10 minutes.')

    await replace(user, 'Start message', 'Happy drops!')
    await replace(user, 'Bonus (%)', '75')
    expect(screen.getByLabelText('Start message')).toHaveValue('Happy drops!')
    expect(screen.getByLabelText('End message')).toHaveValue('Item drop +75% event ends in 10 minutes.')
  })

  it('fills the start with the server clock on Start now', async () => {
    mockApi(base([]))
    const { user } = renderRoute('/gm/events', { me: gm })

    await open(user)
    await user.click(screen.getByRole('button', { name: 'Start now' }))

    expect(screen.getByLabelText('Start date')).toHaveValue('2026-11-01')
    expect(screen.getByLabelText('Start time')).toHaveValue('16:30')
  })

  it('offers Start now only for one period events', async () => {
    mockApi(base([]))
    const { user } = renderRoute('/gm/events', { me: gm })

    await open(user)
    await user.selectOptions(screen.getByLabelText('Schedule'), 'Daily')

    expect(screen.queryByRole('button', { name: 'Start now' })).not.toBeInTheDocument()
  })

  it('says times are the server clock, and shows it', async () => {
    mockApi(base([]))
    const { user } = renderRoute('/gm/events', { me: gm })

    await open(user)

    expect(screen.getByText('Server time, now 1 Nov 16:30')).toBeInTheDocument()
  })

  it('shows field errors without sending', async () => {
    const fetchMock = mockApi(base([], { 'POST /gm/events': saved }))
    const { user } = renderRoute('/gm/events', { me: gm })

    await open(user)
    await user.click(screen.getByRole('button', { name: 'Save event' }))

    expect(await screen.findByText('Enter a title')).toBeInTheDocument()
    expect(screen.getByText('Enter a bonus')).toBeInTheDocument()
    expect(screen.getAllByText('Enter a valid date and time').length).toBeGreaterThan(0)
    expect(sentBodies(fetchMock, 'POST /gm/events')).toHaveLength(0)
  })

  it('refuses a long title and a window crossing midnight', async () => {
    const fetchMock = mockApi(base([], { 'POST /gm/events': saved }))
    const { user } = renderRoute('/gm/events', { me: gm })

    await open(user)
    await replace(user, 'Title', 'x'.repeat(51))
    await replace(user, 'Bonus (%)', '50')
    await user.selectOptions(screen.getByLabelText('Schedule'), 'Daily')
    await replace(user, 'First day', '2026-11-01')
    await replace(user, 'From', '22:00')
    await replace(user, 'Last day', '2026-11-07')
    await replace(user, 'To', '02:00')
    await user.click(screen.getByRole('button', { name: 'Save event' }))

    expect(await screen.findByText('Use 50 characters or fewer')).toBeInTheDocument()
    expect(sentBodies(fetchMock, 'POST /gm/events')).toHaveLength(0)
  })

  it('names a midnight crossing on the end field', async () => {
    mockApi(base([]))
    const { user } = renderRoute('/gm/events', { me: gm })

    await open(user)
    await replace(user, 'Title', 'Nights')
    await replace(user, 'Bonus (%)', '50')
    await user.selectOptions(screen.getByLabelText('Schedule'), 'Daily')
    await replace(user, 'First day', '2026-11-01')
    await replace(user, 'From', '22:00')
    await replace(user, 'Last day', '2026-11-07')
    await replace(user, 'To', '02:00')
    await user.click(screen.getByRole('button', { name: 'Save event' }))

    expect(await screen.findByText('The daily window cannot cross midnight')).toBeInTheDocument()
  })

  it('keeps what was typed and shows the message when the server refuses', async () => {
    mockApi(
      base([], {
        'POST /gm/events': () =>
          json(409, { statusCode: 409, message: 'Overlaps Weekend EXP: only one EXP event can be on at a time.' }),
      }),
    )
    const { user } = renderRoute('/gm/events', { me: gm })

    await open(user)
    await replace(user, 'Title', 'Second')
    await replace(user, 'Bonus (%)', '50')
    await fillPeriod(user)
    await user.click(screen.getByRole('button', { name: 'Save event' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Overlaps Weekend EXP')
    expect(screen.getByLabelText('Title')).toHaveValue('Second')
  })

  it('can be cancelled', async () => {
    mockApi(base([]))
    const { user } = renderRoute('/gm/events', { me: gm })

    await open(user)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('button', { name: 'Save event' })).not.toBeInTheDocument()
  })

  it('hides the world with one, and sends the chosen one with two', async () => {
    const worlds = [
      { id: 1, name: 'Lapiris' },
      { id: 2, name: 'Other' },
    ]
    const fetchMock = mockApi(
      base([], {
        'GET /gm/status': () => json(200, { state: 'connected', worlds, channels: [1] }),
        'POST /gm/events': saved,
      }),
    )
    const { user } = renderRoute('/gm/events', { me: gm })

    await open(user)
    await user.selectOptions(screen.getByLabelText('World'), 'Other')
    await replace(user, 'Title', 'Other world')
    await replace(user, 'Bonus (%)', '50')
    await fillPeriod(user)
    await user.click(screen.getByRole('button', { name: 'Save event' }))

    await waitFor(() => expect(sentBodies(fetchMock, 'POST /gm/events')).toHaveLength(1))
    expect(sentBodies(fetchMock, 'POST /gm/events')[0]).toMatchObject({ world: 2 })
  })

  it('has no world field with one world', async () => {
    mockApi(base([]))
    const { user } = renderRoute('/gm/events', { me: gm })

    await open(user)

    expect(screen.queryByLabelText('World')).not.toBeInTheDocument()
  })

  describe('editing', () => {
    it('fills the form and sends the edit to that event', async () => {
      const fetchMock = mockApi(base([evenings], { 'PUT /gm/events/5': (body) => json(200, { ...evenings, ...(body as object) }) }))
      const { user } = renderRoute('/gm/events', { me: gm })

      await user.click(await screen.findByRole('button', { name: 'Edit Evening drops' }))

      expect(screen.getByLabelText('Title')).toHaveValue('Evening drops')
      expect(screen.getByLabelText('Bonus (%)')).toHaveValue(50)
      expect(screen.getByLabelText('Schedule')).toHaveDisplayValue('Daily')
      expect(screen.getByLabelText('First day')).toHaveValue('2026-11-01')
      expect(screen.getByLabelText('From')).toHaveValue('20:00')
      expect(screen.getByLabelText('Last day')).toHaveValue('2026-11-07')
      expect(screen.getByLabelText('To')).toHaveValue('22:00')

      await replace(user, 'Bonus (%)', '75')
      await user.click(screen.getByRole('button', { name: 'Save event' }))

      await waitFor(() => expect(sentBodies(fetchMock, 'PUT /gm/events/5')).toHaveLength(1))
      expect(sentBodies(fetchMock, 'PUT /gm/events/5')[0]).toEqual({
        type: 3,
        world: 1,
        title: 'Evening drops',
        bonus: 75,
        mapId: null,
        schedule: evenings.schedule,
        startMessage: evenings.startMessage,
        endMessage: evenings.endMessage,
        startNoticeMinutes: 0,
        endNoticeMinutes: 1,
      })
    })

    it('keeps the map of an event on a map that is not hosted', async () => {
      const unhosted = { ...onOneMap, mapId: 1234 }
      mockApi(base([unhosted]))
      const { user } = renderRoute('/gm/events', { me: gm })

      await user.click(await screen.findByRole('button', { name: 'Edit Sand drops' }))

      expect(await screen.findByLabelText('Map')).toHaveDisplayValue('Map 1234 (not hosted)')
    })

    it('locks the type and says how to change it', async () => {
      mockApi(base([evenings]))
      const { user } = renderRoute('/gm/events', { me: gm })

      await user.click(await screen.findByRole('button', { name: 'Edit Evening drops' }))

      expect(screen.queryByLabelText('Type')).not.toBeInTheDocument()
      expect(screen.getByText(/Item drop\. To change the type, stop this event and create a new one\./)).toBeInTheDocument()
    })

    it('does not rewrite messages that came with the event', async () => {
      mockApi(base([{ ...evenings, startMessage: 'Custom start' }]))
      const { user } = renderRoute('/gm/events', { me: gm })

      await user.click(await screen.findByRole('button', { name: 'Edit Evening drops' }))
      await replace(user, 'Bonus (%)', '75')

      expect(screen.getByLabelText('Start message')).toHaveValue('Custom start')
    })

    it('warns that saving restarts a running event', async () => {
      mockApi(base([weekend, evenings]))
      const { user } = renderRoute('/gm/events', { me: gm })
      const warning = /Saving restarts this event/

      await user.click(await screen.findByRole('button', { name: 'Edit Evening drops' }))
      expect(screen.queryByText(warning)).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Edit Weekend EXP' }))
      expect(screen.getByText(warning)).toBeInTheDocument()
    })

    it('shows when the event ended while the form was open, and refreshes the list', async () => {
      let lists = 0
      mockApi(
        base([], {
          'GET /gm/events': () => {
            lists++
            return json(200, { serverNow: SERVER_NOW, events: lists === 1 ? [evenings] : [] })
          },
          'PUT /gm/events/5': () =>
            json(404, { statusCode: 404, message: 'That event has already ended or been removed' }),
        }),
      )
      const { user } = renderRoute('/gm/events', { me: gm })

      await user.click(await screen.findByRole('button', { name: 'Edit Evening drops' }))
      await user.click(screen.getByRole('button', { name: 'Save event' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('That event has already ended or been removed')
      expect(await screen.findByText('No events are scheduled.')).toBeInTheDocument()
      expect(screen.getByLabelText('Title')).toHaveValue('Evening drops')
    })
  })
})
