import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, Outlet, redirect } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { Button } from '../components/Button'
import { NavGroup, type NavLink } from '../components/NavGroup'
import { meQueryOptions, useLogout } from '../lib/session'

export const Route = createFileRoute('/_authed')({
  beforeLoad: async ({ context }) => {
    if (!(await context.queryClient.ensureQueryData(meQueryOptions))) throw redirect({ to: '/login' })
  },
  component: AuthedLayout,
})

// Six entries instead of eleven: the rankings and the planning tools each get a group.
const GROUPS: { label: string; links: NavLink[] }[] = [
  {
    label: 'Rankings',
    links: [
      { to: '/hall-of-fame', label: 'Hall of Fame' },
      { to: '/leaderboard', label: 'Leaderboard' },
      { to: '/upgrade-stats', label: 'Upgrade Stats' },
    ],
  },
  {
    label: 'Tools',
    links: [
      { to: '/upgrade-simulator', label: 'Upgrade Simulator' },
      { to: '/soul-lottery', label: 'Soul Lottery' },
      { to: '/effects', label: 'Effects' },
      { to: '/mounts-pets', label: 'Mounts & Pets' },
      { to: '/chakras-auras', label: 'Chakras & Auras' },
    ],
  },
]

const TOP_LINK = { className: 'hover:underline', activeProps: { className: 'text-fg' }, inactiveProps: { className: 'text-muted' } }

function AuthedLayout() {
  const { data: me } = useSuspenseQuery(meQueryOptions)
  const logout = useLogout()
  const [open, setOpen] = useState<string | null>(null)
  const nav = useRef<HTMLElement>(null)

  // An open group closes on Escape or on a click anywhere outside the menu.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!nav.current?.contains(event.target as Node)) setOpen(null)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <span className="font-display text-sm tracking-[0.35em] text-accent-text uppercase">4Story</span>
            <nav ref={nav} aria-label="Main" className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm font-bold">
              <Link to="/characters" {...TOP_LINK}>
                Characters
              </Link>
              <Link to="/online" {...TOP_LINK}>
                Online
              </Link>
              <Link to="/achievements" {...TOP_LINK}>
                Achievements
              </Link>
              {GROUPS.map((group) => (
                <NavGroup
                  key={group.label}
                  label={group.label}
                  links={group.links}
                  open={open === group.label}
                  onToggle={() => setOpen((current) => (current === group.label ? null : group.label))}
                  onClose={() => setOpen(null)}
                />
              ))}
              <Link to="/shop" {...TOP_LINK}>
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
