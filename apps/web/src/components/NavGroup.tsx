import { Link, useRouterState } from '@tanstack/react-router'

export type NavLink = { to: string; label: string }

type Props = {
  label: string
  links: NavLink[]
  open: boolean
  onToggle(): void
  onClose(): void
}

/** A header entry that opens a short list of pages. The header decides which one is open. */
export function NavGroup({ label, links, open, onToggle, onClose }: Props) {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const current = links.some(({ to }) => pathname === to || pathname.startsWith(`${to}/`))
  const listId = `nav-${label.toLowerCase()}`

  return (
    <div className="relative" data-nav-group>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={onToggle}
        className={`flex items-center gap-1 font-bold hover:underline ${current || open ? 'text-fg' : 'text-muted'}`}
      >
        {label}
        <svg aria-hidden viewBox="0 0 10 6" className={`size-2.5 transition ${open ? 'rotate-180' : ''}`}>
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      {open && (
        <ul
          id={listId}
          aria-label={label}
          className="absolute top-full left-0 z-30 mt-2 flex min-w-48 flex-col rounded-xs border border-line bg-surface-raised py-1 shadow-lg"
        >
          {links.map((link) => (
            <li key={link.to}>
              <Link
                to={link.to}
                onClick={onClose}
                className="block px-3 py-1.5 hover:bg-surface"
                activeProps={{ className: 'text-fg' }}
                inactiveProps={{ className: 'text-muted' }}
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
