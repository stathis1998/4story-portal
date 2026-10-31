import { vi } from 'vitest'

type Handler = (body: unknown) => Response | Promise<Response>

export const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

/**
 * Replaces fetch with handlers keyed by "METHOD /path" (path without the /api prefix).
 * GET /characters answers [] unless overridden; anything else unhandled answers 404.
 */
export function mockApi(handlers: Record<string, Handler> = {}) {
  const all: Record<string, Handler> = { 'GET /characters': () => json(200, []), ...handlers }
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace(/^\/api/, '')
    const key = `${init?.method ?? 'GET'} ${path}`
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    const handler = all[key]
    return handler ? handler(body) : json(404, { statusCode: 404, message: `No mock for ${key}` })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** The parsed JSON bodies sent to "METHOD /path". */
export function sentBodies(fetchMock: ReturnType<typeof mockApi>, key: string): unknown[] {
  return fetchMock.mock.calls
    .filter(([input, init]) => `${init?.method ?? 'GET'} ${String(input).replace(/^\/api/, '')}` === key)
    .map(([, init]) => JSON.parse(String(init?.body)))
}
