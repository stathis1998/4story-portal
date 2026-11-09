import { createFileRoute } from '@tanstack/react-router'
import { GameIcon } from '../../components/gm/GameIcon'
import { CHAKRAS, MOUNTS, type Chakra, type Mount } from '../../lib/mounts-chakras'

export const Route = createFileRoute('/_authed/mounts-chakras')({
  component: MountsChakrasPage,
})

function MountsChakrasPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-4xl">Mounts & Chakras</h1>
      <p className="mt-1 mb-6 text-muted">Every chakra and mount in the game.</p>

      <Section title="Chakras" items={CHAKRAS} />
      <Section title="Mounts" items={MOUNTS} />
    </main>
  )
}

function Section({ title, items }: { title: string; items: readonly (Chakra | Mount)[] }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-2xl">
        {title} <span className="text-base text-muted">{items.length}</span>
      </h2>
      <ul aria-label={title} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <li key={item.name} className="flex items-center gap-3 rounded-xs border border-line bg-surface p-3">
            <GameIcon spriteId={item.icon} size={38} />
            <div className="min-w-0">
              <p className="font-bold">{item.name}</p>
              {'durations' in item && <p className="text-sm text-muted">{item.durations.join(' · ')}</p>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
