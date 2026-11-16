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
  settings: { live: false, priceGold: 1000, percent: 2, limit: 10, expPercent: 0, goldPercent: 0 },
  reborn: 3,
  recent: [entry(), entry({ id: 2, at: '2026-11-13T21:30:00.000Z', name: 'Mounara', rebirth: 1, bonus: 2, priceGold: 1000 })],
  rewards: [],
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
      screen.getByText(
        "A new price applies to the next rebirth. A new percent or limit changes every reborn character's bonus at its next login.",
        { exact: false },
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Changes apply to the next rebirth/)).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    const table = screen.getByRole('table')
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['When', 'Character', 'Rebirth', 'Bonus', 'Price'])
    const rows = within(table).getAllByRole('row').slice(1)
    expect(
      rows.map((row) =>
        within(row)
          .getAllByRole('cell')
          .map((cell) => cell.textContent),
      ),
    ).toEqual([
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
    const next = state({ settings: { live: true, priceGold: 2000, percent: 2, limit: 10, expPercent: 0, goldPercent: 0 } })
    const fetchMock = mockApi(base({ 'PUT /gm/rebirth/settings': () => json(200, next) }))
    const { user } = renderRoute('/gm/rebirth', { me: gm })

    await user.click(await screen.findByRole('switch', { name: 'Rebirth is open' }))
    const price = await field('Price of the first rebirth (Gold)')
    await user.clear(price)
    await user.type(price, '2000')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(sentBodies(fetchMock, 'PUT /gm/rebirth/settings')).toHaveLength(1))
    expect(sentBodies(fetchMock, 'PUT /gm/rebirth/settings')).toEqual([
      { live: true, priceGold: 2000, percent: 2, limit: 10, expPercent: 0, goldPercent: 0 },
    ])
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

  it('saves EXP and gold percents with the other settings', async () => {
    const fetchMock = mockApi(base({ 'PUT /gm/rebirth/settings': () => json(200, state()) }))
    const { user } = renderRoute('/gm/rebirth', { me: gm })

    const exp = await field('EXP per rebirth')
    await user.clear(exp)
    await user.type(exp, '10')
    const gold = await field('Monster gold per rebirth')
    await user.clear(gold)
    await user.type(gold, '5')
    expect(screen.getAllByText('0 = off')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(sentBodies(fetchMock, 'PUT /gm/rebirth/settings')).toHaveLength(1))
    expect(sentBodies(fetchMock, 'PUT /gm/rebirth/settings')).toEqual([
      { live: false, priceGold: 1000, percent: 2, limit: 10, expPercent: 10, goldPercent: 5 },
    ])
  })

  it('lists a row for every rebirth up to the limit', async () => {
    mockApi(
      base(
        {},
        state({
          settings: { live: false, priceGold: 1000, percent: 2, limit: 3, expPercent: 0, goldPercent: 0 },
          rewards: [{ rebirth: 1, reward: { gold: 2, silver: 0, copper: 0, items: [] } }],
        }),
      ),
    )
    renderRoute('/gm/rebirth', { me: gm })

    const list = within(await screen.findByRole('list', { name: 'Rebirth rewards' }))
    const rows = list.getAllByRole('listitem')
    expect(rows.map((row) => within(row).getByText(/^Rebirth \d+$/).textContent)).toEqual(['Rebirth 1', 'Rebirth 2', 'Rebirth 3'])
    expect(within(rows[0]).getByText('2')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Nothing')).toBeInTheDocument()
    expect(screen.queryByText('Beyond the limit')).not.toBeInTheDocument()
  })

  it('opens the reward editor and saves a reward', async () => {
    const next = state({ rewards: [{ rebirth: 2, reward: { gold: 7, silver: 0, copper: 0, items: [] } }] })
    const fetchMock = mockApi(base({ 'PUT /gm/rebirth/rewards/2': () => json(200, next) }))
    const { user } = renderRoute('/gm/rebirth', { me: gm })

    await user.click(await screen.findByRole('button', { name: 'Edit reward for rebirth 2' }))
    expect(screen.getByText('Saving with nothing removes this reward')).toBeInTheDocument()
    const editor = within(screen.getByRole('form', { name: 'Reward for Rebirth 2' }))
    const gold = editor.getByLabelText('Gold')
    await user.clear(gold)
    await user.type(gold, '7')
    await user.click(editor.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(sentBodies(fetchMock, 'PUT /gm/rebirth/rewards/2')).toHaveLength(1))
    expect(sentBodies(fetchMock, 'PUT /gm/rebirth/rewards/2')).toEqual([{ gold: 7, silver: 0, copper: 0, items: [] }])
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Reward for Rebirth 2' })).not.toBeInTheDocument())
    const rows = within(screen.getByRole('list', { name: 'Rebirth rewards' })).getAllByRole('listitem')
    expect(within(rows[1]).getByText('7')).toBeInTheDocument()
  })

  it('shows rewards above the limit under Beyond the limit', async () => {
    mockApi(
      base(
        {},
        state({
          settings: { live: false, priceGold: 1000, percent: 2, limit: 2, expPercent: 0, goldPercent: 0 },
          rewards: [{ rebirth: 5, reward: { gold: 9, silver: 0, copper: 0, items: [] } }],
        }),
      ),
    )
    renderRoute('/gm/rebirth', { me: gm })

    expect(await screen.findByRole('heading', { name: 'Beyond the limit' })).toBeInTheDocument()
    const rows = within(screen.getByRole('list', { name: 'Rebirth rewards' })).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    const beyond = within(screen.getByRole('list', { name: 'Rewards beyond the limit' }))
    expect(beyond.getByText('Rebirth 5')).toBeInTheDocument()
    expect(beyond.getByText('9')).toBeInTheDocument()
    expect(beyond.getByRole('button', { name: 'Edit reward for rebirth 5' })).toBeInTheDocument()
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
