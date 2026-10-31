import type { UseFormRegisterReturn } from 'react-hook-form'

type Props = {
  label: string
  registration: UseFormRegisterReturn
  error?: string
  type?: 'text' | 'password'
  autoComplete?: string
}

export function TextField({ label, registration, error, type = 'text', autoComplete }: Props) {
  const id = registration.name
  const errorId = `${id}-error`

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        type={type}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="rounded-md border border-line bg-surface-raised px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30 aria-invalid:border-danger"
        {...registration}
      />
      {error && (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
