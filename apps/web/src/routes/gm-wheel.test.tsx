import type { GmWheel, GmWheelPrize } from '@4story-portal/shared'
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { json, mockApi, sentBodies } from '../test/mock-api'
import { renderRoute } from '../test/render-route'

const gm = { userId: 1, username: 'moose', isGm: true }
const player = { userId: 2, username: 'plain', isGm: false }

const prize = (overrides: Partial<GmWheelPrize> = {}): GmWheelPrize => ({
  id: 1,
  name: '1 Gold',
  weight: 3,
  order: 10,
  enabled: true,
  announce: false,
  gold: 1,
  silver: 0,
  copper: 0,
  items: [],
  chance: 75,
  reward: { gold: 1, silver: 0, copper: 0, items: [] },
  ...overrides,
})

const jackpot = prize({ id: 2, name: 'Jackpot', weight: 1, order: 20, announce: true, gold: 10, chance: 25, reward: { gold: 10, silver: 0, copper: 0, items: [] } })
const off = prize({ id: 3, name: 'Old prize', weight: 50, order: 30, enabled: false, chance: 0 })

const state = (overrides: Partial<GmWheel> = {}): GmWheel => ({
  live: false,
  control: 'connected',
  spinsToday: 4,
  prizes: [prize(), jackpot, off],
  ...overrides,
})

const base = (extra: Parameters<typeof mockApi>[0] = {}, current: GmWheel = state()) => ({
  'GET /gm/wheel': () => json(200, current),
  ...extra,
})

const status = async () => within(await screen.findByRole('region', { name: 'Status' }))
const rows = () => within(screen.getByRole('list', { name: 'Prizes' })).getAllByRole('listitem')

describe('GM wheel page', () => {
  it('sends a non-GM to /characters', async () => {
    mockApi()
    const { router } = renderRoute('/gm/wheel', { me: player })
    await waitFor(() => expect(router.state.location.pathname).toBe('/characters'))
  })

  it('is reachable from the other GM pages', async () => {
    mockApi(base({ 'GET /gm/logins': () => json(200, []) }))
    const { user } = renderRoute('/gm/logins', { me: gm })

    await user.click(within(await screen.findByRole('navigation', { name: 'GM tools' })).getByRole('link', { name: 'Wheel' }))

    expect(await screen.findByRole('region', { name: 'Status' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Wheel of Fortune', level: 1 })).toBeInTheDocument()
  })

  it('shows the wheel at a glance', async () => {
    mockApi(base())
    renderRoute('/gm/wheel', { me: gm })

    const row = await status()
    expect(row.getByRole('switch', { name: 'Wheel open' })).not.toBeChecked()
    expect(row.getByText(/cannot spin/)).toBeInTheDocument()
    expect(row.getByRole('status')).toHaveTextContent('Connected')
    expect(row.getByText('Spins today').nextElementSibling).toHaveTextContent('4')
    expect(row.getByText('On the wheel').nextElementSibling).toHaveTextContent('2 of 3 prizes')
    expect(row.getByText('Total weight').nextElementSibling).toHaveTextContent('4')
  })

  it('lists every prize with its weight and chance, and marks the ones off the wheel', async () => {
    mockApi(base())
    renderRoute('/gm/wheel', { me: gm })
    await status()

    expect(rows().map((row) => row.textContent)).toEqual([
      expect.stringMatching(/^#101 Gold1.*Weight 3 \(75%\)EditDelete$/),
      expect.stringMatching(/^#20★ Jackpot10.*Weight 1 \(25%\)EditDelete$/),
      expect.stringMatching(/^#30Old prize1.*Off the wheelEditDelete$/),
    ])
  })

  describe('opening the wheel', () => {
    it('asks first, because players can spin straight away', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
      const fetchMock = mockApi(base({ 'PUT /gm/wheel/live': () => json(200, state({ live: true })) }))
      const { user } = renderRoute('/gm/wheel', { me: gm })

      await user.click((await status()).getByRole('switch', { name: 'Wheel open' }))

      await waitFor(() => expect(screen.getByRole('switch', { name: 'Wheel open' })).toBeChecked())
      expect(confirm.mock.calls[0][0]).toMatch(/Players can spin for these prizes straight away/)
      expect(sentBodies(fetchMock, 'PUT /gm/wheel/live')).toEqual([{ live: true }])
      expect(screen.getByText('Players can spin once a day.')).toBeInTheDocument()
    })

    it('stays closed when the GM says no', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false)
      const fetchMock = mockApi(base())
      const { user } = renderRoute('/gm/wheel', { me: gm })

      await user.click((await status()).getByRole('switch', { name: 'Wheel open' }))

      expect(sentBodies(fetchMock, 'PUT /gm/wheel/live')).toEqual([])
    })

    it('closes without asking', async () => {
      const confirm = vi.spyOn(window, 'confirm')
      const fetchMock = mockApi(base({ 'PUT /gm/wheel/live': () => json(200, state()) }, state({ live: true })))
      const { user } = renderRoute('/gm/wheel', { me: gm })

      await user.click((await status()).getByRole('switch', { name: 'Wheel open' }))

      await waitFor(() => expect(screen.getByRole('switch', { name: 'Wheel open' })).not.toBeChecked())
      expect(confirm).not.toHaveBeenCalled()
      expect(sentBodies(fetchMock, 'PUT /gm/wheel/live')).toEqual([{ live: false }])
    })

    it('shows why the switch could not be saved', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      mockApi(base({ 'PUT /gm/wheel/live': () => json(503, { statusCode: 503, message: 'The wheel is not available right now' }) }))
      const { user } = renderRoute('/gm/wheel', { me: gm })

      await user.click((await status()).getByRole('switch', { name: 'Wheel open' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('The wheel is not available right now')
    })
  })

  describe('prizes', () => {
    it('adds a prize after the last one', async () => {
      const added = prize({ id: 4, name: '500 Silver', weight: 12, order: 40, gold: 0, silver: 500, chance: 75 })
      const fetchMock = mockApi(base({ 'POST /gm/wheel/prizes': () => json(200, state({ prizes: [prize(), jackpot, off, added] })) }))
      const { user } = renderRoute('/gm/wheel', { me: gm })

      await user.click(await screen.findByRole('button', { name: 'Add prize' }))
      const form = within(screen.getByRole('form', { name: 'New prize' }))
      expect(form.getByRole('textbox', { name: 'Name' })).toHaveFocus()
      expect(form.getByRole('spinbutton', { name: 'Position' })).toHaveValue(40)
      await user.type(form.getByRole('textbox', { name: 'Name' }), '500 Silver')
      await user.clear(form.getByRole('spinbutton', { name: 'Weight' }))
      await user.type(form.getByRole('spinbutton', { name: 'Weight' }), '12')
      await user.clear(form.getByRole('spinbutton', { name: 'Silver' }))
      await user.type(form.getByRole('spinbutton', { name: 'Silver' }), '500')
      await user.click(form.getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(rows()).toHaveLength(4))
      expect(sentBodies(fetchMock, 'POST /gm/wheel/prizes')).toEqual([
        { name: '500 Silver', weight: 12, order: 40, enabled: true, announce: false, gold: 0, silver: 500, copper: 0, items: [] },
      ])
      expect(screen.queryByRole('form', { name: 'New prize' })).not.toBeInTheDocument()
    })

    it.each([
      ['no name', async () => undefined, 'Name: Give the prize a name'],
      [
        'no weight',
        async (form: ReturnType<typeof within>, user: ReturnType<typeof renderRoute>['user']) => {
          await user.type(form.getByRole('textbox', { name: 'Name' }), 'Something')
          await user.clear(form.getByRole('spinbutton', { name: 'Weight' }))
        },
        'Weight: Enter a whole number',
      ],
    ])('does not save a prize with %s', async (_, fill, message) => {
      const fetchMock = mockApi(base())
      const { user } = renderRoute('/gm/wheel', { me: gm })
      await user.click(await screen.findByRole('button', { name: 'Add prize' }))
      const form = within(screen.getByRole('form', { name: 'New prize' }))

      await fill(form, user)
      await user.click(form.getByRole('button', { name: 'Save' }))

      expect(form.getByRole('alert')).toHaveTextContent(message)
      expect(sentBodies(fetchMock, 'POST /gm/wheel/prizes')).toEqual([])
    })

    it('changes a prize, starting from what it has', async () => {
      const changed = prize({ id: 2, name: 'Jackpot', weight: 2, order: 20, announce: false, enabled: false, gold: 10, chance: 0 })
      const fetchMock = mockApi(base({ 'PUT /gm/wheel/prizes/2': () => json(200, state({ prizes: [prize(), changed, off] })) }))
      const { user } = renderRoute('/gm/wheel', { me: gm })

      await user.click(await screen.findByRole('button', { name: 'Edit prize Jackpot' }))
      const form = within(screen.getByRole('form', { name: 'Prize Jackpot' }))
      expect(form.getByRole('textbox', { name: 'Name' })).toHaveValue('Jackpot')
      expect(form.getByRole('spinbutton', { name: 'Gold' })).toHaveValue(10)
      expect(form.getByRole('checkbox', { name: 'Announce a win in the game' })).toBeChecked()
      await user.clear(form.getByRole('spinbutton', { name: 'Weight' }))
      await user.type(form.getByRole('spinbutton', { name: 'Weight' }), '2')
      await user.click(form.getByRole('checkbox', { name: 'Announce a win in the game' }))
      await user.click(form.getByRole('checkbox', { name: 'On the wheel' }))
      await user.click(form.getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(screen.queryByRole('form', { name: 'Prize Jackpot' })).not.toBeInTheDocument())
      expect(sentBodies(fetchMock, 'PUT /gm/wheel/prizes/2')).toEqual([
        { name: 'Jackpot', weight: 2, order: 20, enabled: false, announce: false, gold: 10, silver: 0, copper: 0, items: [] },
      ])
      expect(rows()[1]).toHaveTextContent('Off the wheel')
    })

    it('keeps the editor open with the reason when the server refuses', async () => {
      mockApi(base({ 'PUT /gm/wheel/prizes/1': () => json(422, { statusCode: 422, message: 'Unknown items: 31999' }) }))
      const { user } = renderRoute('/gm/wheel', { me: gm })

      await user.click(await screen.findByRole('button', { name: 'Edit prize 1 Gold' }))
      const form = within(screen.getByRole('form', { name: 'Prize 1 Gold' }))
      await user.click(form.getByRole('button', { name: 'Save' }))

      expect(await form.findByRole('alert')).toHaveTextContent('Unknown items: 31999')
    })

    it('closes the editor on Cancel without saving', async () => {
      const fetchMock = mockApi(base())
      const { user } = renderRoute('/gm/wheel', { me: gm })

      await user.click(await screen.findByRole('button', { name: 'Edit prize 1 Gold' }))
      await user.click(within(screen.getByRole('form', { name: 'Prize 1 Gold' })).getByRole('button', { name: 'Cancel' }))

      expect(screen.queryByRole('form', { name: 'Prize 1 Gold' })).not.toBeInTheDocument()
      expect(sentBodies(fetchMock, 'PUT /gm/wheel/prizes/1')).toEqual([])
    })

    it('deletes a prize after asking', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
      const fetchMock = mockApi(base({ 'DELETE /gm/wheel/prizes/3': () => json(200, state({ prizes: [prize(), jackpot] })) }))
      const { user } = renderRoute('/gm/wheel', { me: gm })

      await user.click(await screen.findByRole('button', { name: 'Delete prize Old prize' }))

      await waitFor(() => expect(rows()).toHaveLength(2))
      expect(confirm.mock.calls[0][0]).toMatch(/Delete the prize "Old prize"/)
      expect(fetchMock.mock.calls.some(([input, init]) => String(input) === '/api/gm/wheel/prizes/3' && init?.method === 'DELETE')).toBe(true)
    })

    it('keeps the prize when the GM says no', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false)
      const fetchMock = mockApi(base())
      const { user } = renderRoute('/gm/wheel', { me: gm })

      await user.click(await screen.findByRole('button', { name: 'Delete prize Old prize' }))

      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
      expect(rows()).toHaveLength(3)
    })

    it('takes no more than 20 prizes', async () => {
      const full = Array.from({ length: 20 }, (_, index) => prize({ id: index + 1, name: `Prize ${index + 1}`, order: index }))
      mockApi(base({}, state({ prizes: full })))
      renderRoute('/gm/wheel', { me: gm })

      expect(await screen.findByRole('button', { name: 'Add prize' })).toBeDisabled()
      expect(screen.getByText('The wheel holds at most 20 prizes.')).toBeInTheDocument()
    })

    it('says so when there are none', async () => {
      mockApi(base({}, state({ prizes: [] })))
      renderRoute('/gm/wheel', { me: gm })

      expect(await screen.findByText('The wheel has no prizes yet.')).toBeInTheDocument()
    })
  })

  it('says so when it cannot be loaded', async () => {
    mockApi({ 'GET /gm/wheel': () => json(500, { statusCode: 500, message: 'Down' }) })
    renderRoute('/gm/wheel', { me: gm })

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the wheel.')
  })
})
