import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { ThemeToggle } from '../components/ThemeToggle'
import { meQueryOptions, useLogout } from '../lib/session'

export const Route = createFileRoute('/_authed')({
  beforeLoad: async ({ context }) => {
    if (!(await context.queryClient.ensureQueryData(meQueryOptions))) throw redirect({ to: '/login' })
  },
  component: AuthedLayout,
})

function AuthedLayout() {
  const { data: me } = useSuspenseQuery(meQueryOptions)
  const logout = useLogout()

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <span className="font-display text-sm tracking-[0.3em] text-accent uppercase">4Story</span>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted">
              Signed in as <span className="font-medium text-fg">{me?.username}</span>
            </span>
            <ThemeToggle />
            <button
              type="button"
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
              className="rounded-md border border-line px-3 py-1.5 text-sm transition hover:border-accent disabled:opacity-60"
            >
              Log out
            </button>
          </div>
        </div>
      </header>
      <Outlet />
    </div>
  )
}
