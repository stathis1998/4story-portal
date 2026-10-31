import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { character } from '../test/characters'
import { json, mockApi } from '../test/mock-api'
import { renderRoute } from '../test/render-route'

const moose = { userId: 1, username: 'moose' }

describe('/characters', () => {
  it('shows a loading skeleton while characters load', async () => {
    mockApi({ 'GET /characters': () => new Promise<Response>(() => {}) })
    renderRoute('/characters', { me: moose })

    expect(await screen.findByRole('status')).toBeInTheDocument()
  })

  it('shows the empty state', async () => {
    mockApi({ 'GET /characters': () => json(200, []) })
    renderRoute('/characters', { me: moose })

    expect(await screen.findByText('No characters yet. Create one in the game.')).toBeInTheDocument()
  })

  it('renders one card per character in slot order', async () => {
    mockApi({
      'GET /characters': () =>
        json(200, [character({ id: 1, slot: 0, name: 'First' }), character({ id: 2, slot: 1, name: 'Second' })]),
    })
    renderRoute('/characters', { me: moose })

    await screen.findByRole('heading', { name: 'First' })
    const names = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(names).toEqual(['First', 'Second'])
  })

  it('shows an error with a Retry button that refetches', async () => {
    let calls = 0
    mockApi({
      'GET /characters': () =>
        ++calls === 1
          ? json(500, { statusCode: 500, message: 'Internal server error' })
          : json(200, [character({ name: 'Recovered' })]),
    })
    const { user } = renderRoute('/characters', { me: moose })

    await user.click(await screen.findByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('heading', { name: 'Recovered' })).toBeInTheDocument()
  })

  it('shows the username and logs out to /login', async () => {
    mockApi({ 'POST /auth/logout': () => new Response(null, { status: 204 }) })
    const { user, router } = renderRoute('/characters', { me: moose })

    expect(await screen.findByText('moose')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Log out' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  })

  it('sends an expired session back to /login', async () => {
    mockApi({ 'GET /characters': () => json(401, { statusCode: 401, message: 'Not signed in' }) })
    const { router } = renderRoute('/characters', { me: moose })

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  })
})
