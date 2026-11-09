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
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <span className="font-display text-sm tracking-[0.35em] text-accent-text uppercase">4Story</span>
            <nav aria-label="Main" className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-bold">
              <Link to="/characters" className="hover:underline" activeProps={{ className: 'text-fg' }} inactiveProps={{ className: 'text-muted' }}>
                Characters
              </Link>
              <Link to="/hall-of-fame" className="hover:underline" activeProps={{ className: 'text-fg' }} inactiveProps={{ className: 'text-muted' }}>
                Hall of Fame
              </Link>
              <Link to="/leaderboard" className="hover:underline" activeProps={{ className: 'text-fg' }} inactiveProps={{ className: 'text-muted' }}>
                Leaderboard
              </Link>
              <Link to="/soul-lottery" className="hover:underline" activeProps={{ className: 'text-fg' }} inactiveProps={{ className: 'text-muted' }}>
                Soul Lottery
              </Link>
              <Link to="/upgrade-simulator" className="hover:underline" activeProps={{ className: 'text-fg' }} inactiveProps={{ className: 'text-muted' }}>
                Upgrades
              </Link>
              <Link to="/mounts-chakras" className="hover:underline" activeProps={{ className: 'text-fg' }} inactiveProps={{ className: 'text-muted' }}>
                Mounts &amp; Chakras
              </Link>
              <Link to="/shop" className="hover:underline" activeProps={{ className: 'text-fg' }} inactiveProps={{ className: 'text-muted' }}>
                Shop
              </Link>
            </nav>
          </div>
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
