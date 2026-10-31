import type { FieldValues, Path, UseFormSetError } from 'react-hook-form'
import { ApiError } from './api'

/**
 * Puts server errors where the user will look: field errors and a 409 "taken" under their field,
 * everything else in the message box. Returns the message box text, or null if nothing goes there.
 */
export function applyServerError<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  options: { conflictField?: Path<T> } = {},
): string | null {
  if (!(error instanceof ApiError)) return 'Something went wrong. Please try again.'

  if (error.status === 409 && options.conflictField) {
    setError(options.conflictField, { message: error.message })
    return null
  }

  if (error.fieldErrors && Object.keys(error.fieldErrors).length > 0) {
    for (const [field, messages] of Object.entries(error.fieldErrors)) {
      setError(field as Path<T>, { message: messages[0] })
    }
    return null
  }

  if (error.status === 503) return error.message

  return error.status >= 500 ? 'Something went wrong. Please try again.' : error.message
}
