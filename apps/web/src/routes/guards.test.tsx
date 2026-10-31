import { waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { mockApi } from '../test/mock-api'
import { renderRoute } from '../test/render-route'

const moose = { userId: 1, username: 'moose', isGm: false }

describe('route guards', () => {
  it.each([
    ['/characters', null, '/login'],
    ['/login', moose, '/characters'],
    ['/register', moose, '/characters'],
    ['/', null, '/login'],
    ['/', moose, '/characters'],
  ])('%s with me=%o lands on %s', async (path, me, expected) => {
    mockApi()
    const { router } = renderRoute(path, { me })

    await waitFor(() => expect(router.state.location.pathname).toBe(expected))
  })
})
