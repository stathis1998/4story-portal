import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, Outlet, redirect } from '@tanstack/react-router'
import { Button } from '../components/Button'
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
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <span className="font-display text-sm tracking-[0.35em] text-accent-text uppercase">4Story</span>
          <div className="flex items-center gap-4">
            {me?.isGm && (
              <Link to="/gm/teleport" className="text-sm font-bold text-accent-text hover:underline">
                GM
              </Link>
            )}
            <span className="text-sm text-muted">
              Signed in as <span className="font-bold text-fg">{me?.username}</span>
            </span>
            <Button variant="secondary" onClick={() => logout.mutate()} disabled={logout.isPending} size="sm">
              Log out
            </Button>
          </div>
        </div>
      </header>
      <Outlet />
    </div>
  )
}
