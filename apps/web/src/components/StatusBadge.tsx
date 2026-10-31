import type { ControlState } from '@4story-portal/shared'

const BADGES: Record<ControlState, { label: string; className: string }> = {
  connected: { label: 'Connected', className: 'text-accent-text' },
  connecting: { label: 'Connecting…', className: 'text-muted' },
  disconnected: { label: 'Disconnected', className: 'text-danger' },
  'login-failed': { label: 'Login failed', className: 'text-danger' },
}

export function StatusBadge({ state }: { state: ControlState }) {
  const { label, className } = BADGES[state]
  return (
    <span role="status" className={`text-xs tracking-[0.2em] uppercase ${className}`}>
      {label}
    </span>
  )
}
