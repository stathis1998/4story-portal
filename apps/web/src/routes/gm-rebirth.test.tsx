import type { GmRebirth, RebirthLogEntry } from '@4story-portal/shared'
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { json, mockApi, sentBodies } from '../test/mock-api'
import { renderRoute } from '../test/render-route'

const gm = { userId: 1, username: 'moose', isGm: true }

const entry = (overrides: Partial<RebirthLogEntry> = {}): RebirthLogEntry => ({
  id: 1,
  at: '2026-11-14T09:05:00.000Z',
  name: 'Moosey',
  rebirth: 2,
  bonus: 4,
  priceGold: 2000,
  ...overrides,
})

const state = (overrides: Partial<GmRebirth> = {}): GmRebirth => ({
  settings: { live: false, priceGold: 1000, percent: 2, limit: 10 },
  reborn: 3,
  recent: [entry(), entry({ id: 2, at: '2026-11-13T21:30:00.000Z', name: 'Mounara', rebirth: 1, bonus: 2, priceGold: 1000 })],
  ...overrides,
})

const base = (extra: Parameters<typeof mockApi>[0] = {}, current: GmRebirth = state()) => ({
  'GET /gm/rebirth': () => json(200, current),
  ...extra,
})

const field = (name: string) => screen.findByRole('spinbutton', { name })

describe('GM rebirth page', () => {
  it('shows the saved settings and the recent rebirths', async () => {
    mockApi(base())
    renderRoute('/gm/rebirth', { me: gm })

    expect(await screen.findByRole('heading', { name: 'Rebirth', level: 1 })).toBeInTheDocument()
    expect(await screen.findByRole('switch', { name: 'Rebirth is open' })).not.toBeChecked()
    expect(await field('Price of the first rebirth (Gold)')).toHaveValue(1000)
    expect(await field('Bonus per rebirth (%)')).toHaveValue(2)
    expect(await field('Most rebirths')).toHaveValue(10)
    expect(screen.getByText('Characters reborn: 3')).toBeInTheDocument()
    expect(
      screen.getByText("A new price applies to the next rebirth. A new percent or limit changes every reborn character's bonus at its next login.", {
        exact: false,
      }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Changes apply to the next rebirth/)).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'When',
      'Character',
      'Rebirth',
      'Bonus',
      'Price',
    ])
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent))).toEqual([
      ['14 Nov, 09:05', 'Moosey', '2', '+4%', '2,000 Gold'],
      ['13 Nov, 21:30', 'Mounara', '1', '+2%', '1,000 Gold'],
    ])
  })

  it('works out the cost and the top bonus from the fields', async () => {
    mockApi(base())
    const { user } = renderRoute('/gm/rebirth', { me: gm })

    expect(
      await screen.findByText('Rebirth 2 costs twice the price, rebirth 3 three times. A character at the limit has +20% to all stats.'),
    ).toBeInTheDocument()
    const percent = await field('Bonus per rebirth (%)')
    await user.clear(percent)
    await user.type(percent, '3')
    const limit = await field('Most rebirths')
    await user.clear(limit)
    await user.type(limit, '5')

    expect(screen.getByText(/A character at the limit has \+15% to all stats\./)).toBeInTheDocument()
  })

  it('saves what was typed', async () => {
    const next = state({ settings: { live: true, priceGold: 2000, percent: 2, limit: 10 } })
    const fetchMock = mockApi(base({ 'PUT /gm/rebirth/settings': () => json(200, next) }))
    const { user } = renderRoute('/gm/rebirth', { me: gm })

    await user.click(await screen.findByRole('switch', { name: 'Rebirth is open' }))
    const price = await field('Price of the first rebirth (Gold)')
    await user.clear(price)
    await user.type(price, '2000')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(sentBodies(fetchMock, 'PUT /gm/rebirth/settings')).toHaveLength(1))
    expect(sentBodies(fetchMock, 'PUT /gm/rebirth/settings')).toEqual([{ live: true, priceGold: 2000, percent: 2, limit: 10 }])
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Rebirth is open' })).toBeChecked())
    expect(await screen.findByRole('status')).toHaveTextContent('Saved.')
  })

  it("puts the server's complaint on the price field", async () => {
    mockApi(
      base({
        'PUT /gm/rebirth/settings': () =>
          json(400, { statusCode: 400, message: 'Invalid', fieldErrors: { priceGold: ['Set a price before opening rebirth'] } }),
      }),
    )
    const { user } = renderRoute('/gm/rebirth', { me: gm })

    await user.click(await screen.findByRole('switch', { name: 'Rebirth is open' }))
    const price = await field('Price of the first rebirth (Gold)')
    await user.clear(price)
    await user.type(price, '0')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Set a price before opening rebirth')).toBeInTheDocument()
    expect(price).toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('is in the GM menu', async () => {
    mockApi(base({ 'GET /gm/logins': () => json(200, []) }))
    const { user } = renderRoute('/gm/logins', { me: gm })

    const nav = within(await screen.findByRole('navigation', { name: 'GM tools' }))
    const names = nav.getAllByRole('link').map((link) => link.textContent)
    expect(names.indexOf('Rebirth')).toBe(names.indexOf('Roulette') + 1)
    await user.click(nav.getByRole('link', { name: 'Rebirth' }))

    expect(await screen.findByRole('heading', { name: 'Rebirth', level: 1 })).toBeInTheDocument()
  })

  it('sends a non-GM to /characters', async () => {
    mockApi()
    const { router } = renderRoute('/gm/rebirth', { me: { userId: 2, username: 'plain', isGm: false } })
    await waitFor(() => expect(router.state.location.pathname).toBe('/characters'))
  })
})
