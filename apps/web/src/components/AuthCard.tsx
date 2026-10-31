import type { ReactNode } from 'react'
import { Button } from './Button'

/** Centered card used by the login and register pages. */
export function AuthCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <p className="mb-6 text-center font-display text-sm tracking-[0.35em] text-accent-text uppercase">4Story</p>
        <div className="rounded-xs border border-t-2 border-line border-t-accent bg-surface p-8">
          <h1 className="text-3xl">{title}</h1>
          <p className="mt-1 mb-6 text-muted">{subtitle}</p>
          {children}
        </div>
      </div>
    </main>
  )
}

export function SubmitButton({ pending, label, pendingLabel }: { pending: boolean; label: string; pendingLabel: string }) {
  return (
    <Button type="submit" disabled={pending} className="mt-2">
      {pending ? pendingLabel : label}
    </Button>
  )
}
