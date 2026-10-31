import type { UseFormRegisterReturn } from 'react-hook-form'

type Props = {
  label: string
  registration: UseFormRegisterReturn
  error?: string
  options: { value: string | number; label: string }[]
}

export function Select({ label, registration, error, options }: Props) {
  const id = registration.name
  const errorId = `${id}-error`

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-bold tracking-wider text-muted uppercase">
        {label}
      </label>
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="rounded-xs border border-line bg-surface-raised px-3 py-2 outline-none transition focus:border-accent focus:ring-1 focus:ring-accent aria-invalid:border-danger aria-invalid:focus:ring-danger"
        {...registration}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error && (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
