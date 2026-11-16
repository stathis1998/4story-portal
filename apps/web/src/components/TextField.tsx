import type { UseFormRegisterReturn } from 'react-hook-form'

type Props = {
  label: string
  registration: UseFormRegisterReturn
  error?: string
  type?: 'text' | 'password' | 'number' | 'date' | 'time'
  autoComplete?: string
  step?: string
  /** A short note under the field. */
  hint?: string
}

export function TextField({ label, registration, error, type = 'text', autoComplete, step, hint }: Props) {
  const id = registration.name
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-bold tracking-wider text-muted uppercase">
        {label}
      </label>
      <input
        id={id}
        type={type}
        autoComplete={autoComplete}
        step={step}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className="rounded-xs border border-line bg-surface-raised px-3 py-2 outline-none transition focus:border-accent focus:ring-1 focus:ring-accent aria-invalid:border-danger aria-invalid:focus:ring-danger"
        {...registration}
      />
      {hint && (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
