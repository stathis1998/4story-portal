import type { ApiErrorBody } from '@4story-portal/shared'

export class ApiError extends Error {
  readonly status: number
  readonly fieldErrors?: Record<string, string[]>

  constructor(status: number, message: string, fieldErrors?: Record<string, string[]>) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.fieldErrors = fieldErrors
  }
}

/** Calls the API through the Vite proxy (`/api/...`) and throws ApiError for non-2xx responses. */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  if (init.body !== undefined) headers.set('Content-Type', 'application/json')

  const res = await fetch(`/api${path}`, { ...init, headers, credentials: 'same-origin' })

  if (res.status === 204) return undefined as T
  const body: unknown = await res.json().catch(() => undefined)

  if (!res.ok) {
    const error = body as Partial<ApiErrorBody> | undefined
    throw new ApiError(res.status, error?.message ?? 'Request failed', error?.fieldErrors)
  }
  return body as T
}
