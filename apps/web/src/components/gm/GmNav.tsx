import { Link } from '@tanstack/react-router'

const link = 'text-sm font-bold hover:underline'

export function GmNav() {
  return (
    <nav aria-label="GM tools" className="mb-6 flex flex-wrap gap-x-4 gap-y-1">
      <Link to="/gm/teleport" className={link} activeProps={{ className: 'text-accent-text' }} inactiveProps={{ className: 'text-muted' }}>
        Teleport
      </Link>
      <Link to="/gm/logins" className={link} activeProps={{ className: 'text-accent-text' }} inactiveProps={{ className: 'text-muted' }}>
        Logins
      </Link>
      <Link to="/gm/vendors" className={link} activeProps={{ className: 'text-accent-text' }} inactiveProps={{ className: 'text-muted' }}>
        Vendors
      </Link>
      <Link to="/gm/mail" className={link} activeProps={{ className: 'text-accent-text' }} inactiveProps={{ className: 'text-muted' }}>
        Mail
      </Link>
      <Link to="/gm/events" className={link} activeProps={{ className: 'text-accent-text' }} inactiveProps={{ className: 'text-muted' }}>
        Events
      </Link>
      <Link to="/gm/achievements" className={link} activeProps={{ className: 'text-accent-text' }} inactiveProps={{ className: 'text-muted' }}>
        Achievements
      </Link>
    </nav>
  )
}
