import type { ReactNode } from 'react'
import { ThemeToggle } from './ThemeToggle'

/** Centered card used by the login and register pages. */
export function AuthCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <main className="relative flex min-h-screen items-center justify-center px-4 py-12">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm">
        <p className="mb-6 text-center font-display text-sm tracking-[0.3em] text-accent uppercase">4Story</p>
        <div className="rounded-xl border border-line bg-surface p-8 shadow-xl shadow-black/10">
          <h1 className="text-2xl">{title}</h1>
          <p className="mt-1 mb-6 text-sm text-muted">{subtitle}</p>
          {children}
        </div>
      </div>
    </main>
  )
}

export function SubmitButton({ pending, label, pendingLabel }: { pending: boolean; label: string; pendingLabel: string }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-2 rounded-md bg-accent px-4 py-2.5 font-medium text-accent-fg transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? pendingLabel : label}
    </button>
  )
}
