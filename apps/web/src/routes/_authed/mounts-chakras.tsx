import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense, useState } from 'react'
import { GameIcon } from '../../components/gm/GameIcon'
import { CHAKRAS, MOUNTS, type Chakra, type Mount } from '../../lib/mounts-chakras'

// three.js is large, so only this page loads it.
const MountViewer = lazy(() => import('../../components/mounts/MountViewer'))

export const Route = createFileRoute('/_authed/mounts-chakras')({
  component: MountsChakrasPage,
})

const CARD = 'flex w-full items-center gap-3 rounded-xs border bg-surface p-3 text-left'

function MountsChakrasPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-4xl">Mounts & Chakras</h1>
      <p className="mt-1 mb-6 text-muted">Every chakra and mount in the game.</p>

      <section className="mt-8">
        <SectionTitle title="Chakras" count={CHAKRAS.length} />
        <ul aria-label="Chakras" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {CHAKRAS.map((chakra) => (
            <li key={chakra.name} className={`${CARD} border-line`}>
              <Summary item={chakra} />
            </li>
          ))}
        </ul>
      </section>

      <Mounts />
    </main>
  )
}

function Mounts() {
  const [selected, setSelected] = useState(() => MOUNTS.find((mount) => mount.model !== null)!)

  return (
    <section className="mt-8">
      <SectionTitle title="Mounts" count={MOUNTS.length} />
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <aside aria-label="3D preview" className="rounded-xs border border-line bg-surface p-3 lg:sticky lg:top-4 lg:order-2 lg:w-96 lg:shrink-0">
          <h3 className="text-lg font-bold">{selected.name}</h3>
          <Suspense fallback={<p className="flex h-80 items-center justify-center text-sm text-muted">Loading model...</p>}>
            <MountViewer src={`/mount-models/${selected.model}.glb`} name={selected.name} />
          </Suspense>
          <p className="text-sm text-muted">Drag to turn it, scroll to zoom. Pick a mount from the list to see it.</p>
        </aside>

        <ul aria-label="Mounts" className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2 lg:order-1">
          {MOUNTS.map((mount) => (
            <li key={mount.name}>
              {mount.model === null ? (
                <div className={`${CARD} border-line`}>
                  <Summary item={mount} />
                </div>
              ) : (
                <button
                  type="button"
                  aria-pressed={mount.name === selected.name}
                  onClick={() => setSelected(mount)}
                  className={`${CARD} cursor-pointer hover:border-accent ${mount.name === selected.name ? 'border-accent' : 'border-line'}`}
                >
                  <Summary item={mount} />
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function SectionTitle({ title, count }: { title: string; count: number }) {
  return (
    <h2 className="mb-3 text-2xl">
      {title} <span className="text-base text-muted">{count}</span>
    </h2>
  )
}

function Summary({ item }: { item: Chakra | Mount }) {
  return (
    <>
      <GameIcon spriteId={item.icon} size={38} />
      <span className="min-w-0">
        <span className="block font-bold">{item.name}</span>
        {'durations' in item && <span className="block text-sm text-muted">{item.durations.join(' · ')}</span>}
      </span>
    </>
  )
}
