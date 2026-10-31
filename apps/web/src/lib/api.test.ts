import { describe, expect, it, vi } from 'vitest'
import { ApiError, apiFetch } from './api'

function stubFetch(status: number, body?: unknown, raw?: string) {
  const fetchMock = vi.fn(async () =>
    new Response(raw ?? (body === undefined ? null : JSON.stringify(body)), {
      status,
      headers: raw ? { 'Content-Type': 'text/html' } : { 'Content-Type': 'application/json' },
    }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('apiFetch', () => {
  it('resolves parsed JSON and calls /api with same-origin credentials', async () => {
    const fetchMock = stubFetch(200, { userId: 1, username: 'moose' })

    await expect(apiFetch('/auth/me')).resolves.toEqual({ userId: 1, username: 'moose' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/auth/me')
    expect(init.credentials).toBe('same-origin')
  })

  it('resolves undefined for 204', async () => {
    stubFetch(204)
    await expect(apiFetch('/auth/logout', { method: 'POST' })).resolves.toBeUndefined()
  })

  it('rejects with ApiError carrying status and message', async () => {
    stubFetch(409, { statusCode: 409, message: 'Username is already taken' })

    const error = await apiFetch('/auth/register').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 409, message: 'Username is already taken' })
  })

  it('exposes field errors from a 400', async () => {
    const fieldErrors = { username: ['Use 4-16 letters or digits'] }
    stubFetch(400, { statusCode: 400, message: 'Validation failed', fieldErrors })

    await expect(apiFetch('/auth/register')).rejects.toMatchObject({ status: 400, fieldErrors })
  })

  it('falls back to "Request failed" for a non-JSON error body', async () => {
    stubFetch(500, undefined, '<html>Bad gateway</html>')

    await expect(apiFetch('/characters')).rejects.toMatchObject({ status: 500, message: 'Request failed' })
  })
})
