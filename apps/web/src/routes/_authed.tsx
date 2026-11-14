import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, Outlet, redirect } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { Button } from '../components/Button'
import { MobileMenu } from '../components/MobileMenu'
import { NavGroup, type NavLink } from '../components/NavGroup'
import { meQueryOptions, useLogout } from '../lib/session'

export const Route = createFileRoute('/_authed')({
  beforeLoad: async ({ context }) => {
    if (!(await context.queryClient.ensureQueryData(meQueryOptions))) throw redirect({ to: '/login' })
  },
  component: AuthedLayout,
})

// Six entries instead of thirteen: the games, the rankings and the planning tools each get a group.
const GROUPS: { label: string; links: NavLink[] }[] = [
  {
    label: 'Try Your Luck',
    links: [
      { to: '/roulette', label: 'Roulette' },
      { to: '/slots', label: 'Slots' },
      { to: '/wheel', label: 'Wheel of Fortune' },
    ],
  },
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

// The pages that sit in the header on their own, ahead of the groups.
const LINKS: NavLink[] = [
  { to: '/characters', label: 'Characters' },
  { to: '/online', label: 'Online' },
  { to: '/achievements', label: 'Achievements' },
]

const TOP_LINK = { className: 'hover:underline pointer-coarse:py-2', activeProps: { className: 'text-fg' }, inactiveProps: { className: 'text-muted' } }
const MENU_ID = 'phone-menu'

function AuthedLayout() {
  const { data: me } = useSuspenseQuery(meQueryOptions)
  const logout = useLogout()
  const [open, setOpen] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const nav = useRef<HTMLElement>(null)

  // An open group closes on Escape or on a click anywhere outside the menu. Escape also closes the phone menu.
  useEffect(() => {
    if (!open && !menuOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (!nav.current?.contains(event.target as Node)) setOpen(null)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(null)
      setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, menuOpen])

  return (
    <div className="min-h-screen">
      {/* On a phone the header is one fixed-height row that stays on screen, with the pages behind a Menu button. */}
      <header className="sticky top-0 z-40 border-b border-line bg-surface md:static">
        <div className="mx-auto flex h-12 max-w-5xl items-center justify-between gap-x-4 gap-y-2 px-4 md:h-auto md:flex-wrap md:py-3">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <span className="font-display text-sm tracking-[0.35em] text-accent-text uppercase">4Story</span>
            <nav ref={nav} aria-label="Main" className="hidden flex-wrap items-center gap-x-5 gap-y-1 text-sm font-bold md:flex">
              {LINKS.map((link) => (
                <Link key={link.to} to={link.to} {...TOP_LINK}>
                  {link.label}
                </Link>
              ))}
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
            </nav>
          </div>
          <div className="hidden items-center gap-4 md:flex">
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
          <button
            type="button"
            aria-expanded={menuOpen}
            aria-controls={MENU_ID}
            onClick={() => setMenuOpen((value) => !value)}
            className="-mr-2 flex h-11 items-center gap-2 px-2 text-sm font-bold text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent-text md:hidden"
          >
            <svg aria-hidden viewBox="0 0 16 12" className="h-3 w-4">
              <path d={menuOpen ? 'M2 0l12 12M14 0L2 12' : 'M0 1h16M0 6h16M0 11h16'} fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            Menu
          </button>
        </div>
        {menuOpen && (
          <MobileMenu
            id={MENU_ID}
            links={LINKS}
            groups={GROUPS}
            username={me?.username}
            isGm={Boolean(me?.isGm)}
            loggingOut={logout.isPending}
            onLogout={() => logout.mutate()}
            onClose={() => setMenuOpen(false)}
          />
        )}
      </header>
      <Outlet />
    </div>
  )
}
