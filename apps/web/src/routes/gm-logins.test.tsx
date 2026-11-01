import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { json, mockApi } from '../test/mock-api'
import { renderRoute } from '../test/render-route'

const gm = { userId: 1, username: 'moose', isGm: true }
const player = { userId: 2, username: 'plain', isGm: false }
const status = (state: string) => () => json(200, { state, worlds: [{ id: 1, name: 'Lapiris' }], channels: [1] })

const stuck = {
  key: 7,
  account: 'friend',
  character: 'Kaelith',
  world: 1,
  channel: 2,
  blocked: true,
  loggedInAt: '2026-10-31T23:37:25.553Z',
}
const atSelect = {
  key: 8,
  account: 'other',
  character: null,
  world: 0,
  channel: 0,
  blocked: false,
  loggedInAt: '2026-11-01T09:05:00.000Z',
}

const base = (extra: Parameters<typeof mockApi>[0] = {}) => ({
  'GET /gm/status': status('connected'),
  'GET /gm/logins': () => json(200, [stuck, atSelect]),
  ...extra,
})

const clears = (fetchMock: ReturnType<typeof mockApi>, key: number) =>
  fetchMock.mock.calls.filter(([input, init]) => String(input) === `/api/gm/logins/${key}/clear` && init?.method === 'POST')

describe('logins page', () => {
  it('sends a non-GM to /characters', async () => {
    mockApi()
    const { router } = renderRoute('/gm/logins', { me: player })
    await waitFor(() => expect(router.state.location.pathname).toBe('/characters'))
  })

  it('is reachable from the teleport page and links back', async () => {
    mockApi(base({ 'GET /gm/players': () => json(200, []), 'GET /gm/locations': () => json(200, []) }))
    const { user, router } = renderRoute('/gm/teleport', { me: gm })

    await user.click(await screen.findByRole('link', { name: 'Logins' }))
    expect(await screen.findByRole('heading', { name: 'Logins' })).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'Teleport' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/gm/teleport'))
  })

  it('shows each login, with the time as stored and blocked logins marked', async () => {
    mockApi(base())
    renderRoute('/gm/logins', { me: gm })

    const row = (await screen.findByRole('cell', { name: 'friend' })).closest('tr')!
    expect(within(row).getByRole('cell', { name: 'Kaelith' })).toBeInTheDocument()
    expect(within(row).getByText('31 Oct, 23:37')).toBeInTheDocument()
    expect(within(row).getByText('Login blocked')).toBeInTheDocument()

    const other = screen.getByRole('cell', { name: 'other' }).closest('tr')!
    expect(within(other).getByRole('cell', { name: 'Not in game' })).toBeInTheDocument()
    expect(within(other).queryByText('Login blocked')).not.toBeInTheDocument()
  })

  it('says when no one is logged in', async () => {
    mockApi(base({ 'GET /gm/logins': () => json(200, []) }))
    renderRoute('/gm/logins', { me: gm })
    expect(await screen.findByText('No one is logged in.')).toBeInTheDocument()
  })

  it('says when the list cannot be loaded, rather than showing it as empty', async () => {
    mockApi(base({ 'GET /gm/logins': () => json(400, { statusCode: 400, message: 'nope' }) }))
    renderRoute('/gm/logins', { me: gm })
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load logins.')
    expect(screen.queryByText('No one is logged in.')).not.toBeInTheDocument()
  })

  it('warns before kicking and sends nothing on cancel', async () => {
    const fetchMock = mockApi(base())
    const { user } = renderRoute('/gm/logins', { me: gm })

    await user.click(await screen.findByRole('button', { name: 'Clear login for friend' }))
    expect(screen.getByText('Kick and clear Kaelith?')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByText('Kick and clear Kaelith?')).not.toBeInTheDocument()
    expect(clears(fetchMock, 7)).toEqual([])
  })

  it('reports a cleared stuck login and reloads the list', async () => {
    let cleared = false
    const fetchMock = mockApi(
      base({
        'GET /gm/logins': () => json(200, cleared ? [atSelect] : [stuck, atSelect]),
        'POST /gm/logins/7/clear': () => {
          cleared = true
          return json(200, { outcome: 'cleared' })
        },
      }),
    )
    const { user } = renderRoute('/gm/logins', { me: gm })

    await user.click(await screen.findByRole('button', { name: 'Clear login for friend' }))
    await user.click(screen.getByRole('button', { name: 'Kick and clear' }))

    expect(await screen.findByText('Stuck login cleared for Kaelith. They can log in now.')).toBeInTheDocument()
    expect(clears(fetchMock, 7)).toHaveLength(1)
    await waitFor(() => expect(screen.queryByRole('cell', { name: 'friend' })).not.toBeInTheDocument())
  })

  it('says so when the player turned out to be really online', async () => {
    mockApi(base({ 'POST /gm/logins/7/clear': () => json(200, { outcome: 'logged-out' }) }))
    const { user } = renderRoute('/gm/logins', { me: gm })

    await user.click(await screen.findByRole('button', { name: 'Clear login for friend' }))
    await user.click(screen.getByRole('button', { name: 'Kick and clear' }))

    expect(await screen.findByText('Kaelith was really online and has been logged out.')).toBeInTheDocument()
  })

  it('does not mention a kick for a login with no character', async () => {
    mockApi(base({ 'POST /gm/logins/8/clear': () => json(200, { outcome: 'cleared' }) }))
    const { user } = renderRoute('/gm/logins', { me: gm })

    await user.click(await screen.findByRole('button', { name: 'Clear login for other' }))
    expect(screen.getByText('Clear login for other?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear' }))

    expect(await screen.findByText('Stuck login cleared for other. They can log in now.')).toBeInTheDocument()
  })

  it('only allows clearing logins with no character while the game server is not connected', async () => {
    mockApi(base({ 'GET /gm/status': status('disconnected') }))
    renderRoute('/gm/logins', { me: gm })

    expect(await screen.findByRole('button', { name: 'Clear login for friend' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Clear login for other' })).toBeEnabled()
    expect(await screen.findByText(/Logins with a character can't be cleared/)).toBeInTheDocument()
  })

  it('shows why a clear was refused', async () => {
    mockApi(base({ 'POST /gm/logins/7/clear': () => json(404, { statusCode: 404, message: 'That login is already gone' }) }))
    const { user } = renderRoute('/gm/logins', { me: gm })

    await user.click(await screen.findByRole('button', { name: 'Clear login for friend' }))
    await user.click(screen.getByRole('button', { name: 'Kick and clear' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('That login is already gone')
  })

  it('hides the detail of an unexpected server error', async () => {
    mockApi(base({ 'POST /gm/logins/7/clear': () => json(500, { statusCode: 500, message: 'Internal server error' }) }))
    const { user } = renderRoute('/gm/logins', { me: gm })

    await user.click(await screen.findByRole('button', { name: 'Clear login for friend' }))
    await user.click(screen.getByRole('button', { name: 'Kick and clear' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.')
  })
})
