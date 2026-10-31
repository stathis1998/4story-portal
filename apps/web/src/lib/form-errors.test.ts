import { describe, expect, it, vi } from 'vitest'
import { ApiError } from './api'
import { applyServerError } from './form-errors'

describe('applyServerError', () => {
  it('shows the message of a 503', () => {
    const error = new ApiError(503, 'Game server is not connected')
    expect(applyServerError(error, vi.fn())).toBe('Game server is not connected')
  })

  it('keeps the generic text for other 5xx', () => {
    const error = new ApiError(500, 'boom')
    expect(applyServerError(error, vi.fn())).toBe('Something went wrong. Please try again.')
  })
})
