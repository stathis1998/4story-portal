import { useAtom } from 'jotai'
import { themeAtom } from '../lib/theme'

export function ThemeToggle() {
  const [theme, setTheme] = useAtom(themeAtom)
  const next = theme === 'dark' ? 'light' : 'dark'

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      className="rounded-md border border-line px-3 py-1.5 text-sm text-muted transition hover:border-accent hover:text-fg"
      aria-label={`Switch to ${next} theme`}
    >
      {theme === 'dark' ? 'Light' : 'Dark'}
    </button>
  )
}
