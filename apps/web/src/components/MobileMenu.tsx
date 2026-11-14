import { Link } from '@tanstack/react-router'
import { Button } from './Button'
import type { NavLink } from './NavGroup'

type Props = {
  id: string
  links: NavLink[]
  groups: { label: string; links: NavLink[] }[]
  username?: string
  isGm: boolean
  loggingOut: boolean
  onLogout(): void
  onClose(): void
}

const ROW = 'block px-4 py-3 font-bold'
const ACTIVE = { activeProps: { className: 'bg-surface-raised text-fg' }, inactiveProps: { className: 'text-muted' } }

/** The header menu on a phone: every page in one panel under the header, with the account at the bottom. */
export function MobileMenu({ id, links, groups, username, isGm, loggingOut, onLogout, onClose }: Props) {
  const row = (link: NavLink) => (
    <li key={link.to}>
      <Link to={link.to} onClick={onClose} className={ROW} {...ACTIVE}>
        {link.label}
      </Link>
    </li>
  )

  return (
    <div className="md:hidden">
      {/* Dims the page under the header. A tap on it closes the menu. */}
      <div data-testid="menu-backdrop" aria-hidden className="fixed inset-x-0 top-12 bottom-0 bg-black/60" onClick={onClose} />
      <nav
        id={id}
        aria-label="Menu"
        className="absolute inset-x-0 top-full max-h-[calc(100dvh-3rem)] overflow-y-auto overscroll-contain border-b border-line bg-surface shadow-lg"
      >
        <ul>{links.map(row)}</ul>
        {groups.map((group) => {
          const headingId = `${id}-${group.label.toLowerCase().replace(/\W+/g, '-')}`
          return (
            <div key={group.label} className="border-t border-line">
              <p id={headingId} className="px-4 pt-3 pb-1 text-xs font-bold tracking-wider text-muted uppercase">
                {group.label}
              </p>
              <ul aria-labelledby={headingId}>{group.links.map(row)}</ul>
            </div>
          )
        })}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <span className="min-w-0 text-sm break-words text-muted">
            Signed in as <span className="font-bold text-fg">{username}</span>
          </span>
          <span className="flex items-center gap-4">
            {isGm && (
              <Link to="/gm/teleport" onClick={onClose} className="py-2 text-sm font-bold text-accent-text">
                GM
              </Link>
            )}
            <Button variant="secondary" onClick={onLogout} disabled={loggingOut} size="sm">
              Log out
            </Button>
          </span>
        </div>
      </nav>
    </div>
  )
}
