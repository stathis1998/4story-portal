import type { InputHTMLAttributes } from 'react'

type Props = InputHTMLAttributes<HTMLInputElement> & { label: string; hideLabel?: boolean }

export function Checkbox({ label, hideLabel, className = '', ...props }: Props) {
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        className={`size-4 accent-accent outline-none focus-visible:ring-2 focus-visible:ring-accent-text focus-visible:ring-offset-2 focus-visible:ring-offset-bg ${className}`}
        {...props}
      />
      <span className={hideLabel ? 'sr-only' : undefined}>{label}</span>
    </label>
  )
}
