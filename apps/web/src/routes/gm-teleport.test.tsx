import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { json, mockApi } from '../test/mock-api'
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
