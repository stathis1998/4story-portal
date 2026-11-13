import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense, useState } from 'react'
import { CardList, PickCard, PreviewLayout, PreviewPanel, SectionTitle, StaticCard } from '../../components/CollectionCard'
import { MOUNTS } from '../../lib/mounts-chakras'
import { PETS, type Pet } from '../../lib/pets'

// three.js is large, so only this page loads it.
const MountViewer = lazy(() => import('../../components/mounts/MountViewer'))

export const Route = createFileRoute('/_authed/mounts-pets')({
  component: MountsPetsPage,
})

function MountsPetsPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-4xl">Mounts & Pets</h1>
      <p className="mt-1 mb-6 text-muted">Every mount in the game, and every pet a companion rune summons.</p>

      <Mounts />
      <Pets />
    </main>
  )
}

function Model({ src, name }: { src: string; name: string }) {
  return (
    <Suspense fallback={<p className="flex h-80 items-center justify-center text-sm text-muted">Loading model...</p>}>
      <MountViewer src={src} name={name} />
    </Suspense>
  )
}

function Mounts() {
  const [selected, setSelected] = useState(() => MOUNTS.find((mount) => mount.model !== null)!)

  return (
    <section className="mt-8">
      <SectionTitle title="Mounts" count={MOUNTS.length} />
      <PreviewLayout>
        <PreviewPanel label="Mount preview">
          <h3 className="text-lg font-bold">{selected.name}</h3>
          <Model src={`/mount-models/${selected.model}.glb`} name={selected.name} />
          <p className="text-sm text-muted">Drag to turn it, scroll to zoom. Pick a mount from the list to see it.</p>
        </PreviewPanel>

        <CardList label="Mounts">
          {MOUNTS.map((mount) => {
            const durations = <span className="block text-sm text-muted">{mount.durations.join(' · ')}</span>
            return (
              <li key={mount.name}>
                {mount.model === null ? (
                  <StaticCard icon={mount.icon} name={mount.name}>
                    {durations}
                  </StaticCard>
                ) : (
                  <PickCard icon={mount.icon} name={mount.name} selected={mount.name === selected.name} onPick={() => setSelected(mount)}>
                    {durations}
                  </PickCard>
                )}
              </li>
            )
          })}
        </CardList>
      </PreviewLayout>
    </section>
  )
}

function Pets() {
  const [selected, setSelected] = useState(PETS[0])
  const [look, setLook] = useState(0)

  const pick = (pet: Pet) => {
    setSelected(pet)
    setLook(0)
  }

  return (
    <section className="mt-8">
      <SectionTitle title="Pets" count={PETS.length} />
      <p className="mb-3 text-sm text-muted">Runes with the same name summon the same pet in different colours.</p>
      <PreviewLayout>
        <PreviewPanel label="Pet preview">
          <h3 className="text-lg font-bold">{selected.name}</h3>
          <Model src={`/pet-models/${selected.looks[look]}.glb`} name={selected.name} />
          {selected.looks.length > 1 && (
            <div className="mb-2 flex gap-2">
              {selected.looks.map((monsterId, index) => (
                <button
                  key={monsterId}
                  type="button"
                  aria-pressed={index === look}
                  onClick={() => setLook(index)}
                  className={`cursor-pointer rounded-xs border px-3 py-1 text-sm hover:border-accent ${index === look ? 'border-accent' : 'border-line'}`}
                >
                  Look {index + 1}
                </button>
              ))}
            </div>
          )}
          <p className="text-sm text-muted">Drag to turn it, scroll to zoom. Pick a pet from the list to see it.</p>
        </PreviewPanel>

        <CardList label="Pets">
          {PETS.map((pet) => (
            <li key={pet.name}>
              <PickCard icon={pet.icon} name={pet.name} selected={pet.name === selected.name} onPick={() => pick(pet)}>
                <span className="block text-sm text-muted">{pet.runes.join(' · ')}</span>
                {!pet.summonable && <span className="block text-sm text-danger">Not on this server: the rune does nothing</span>}
              </PickCard>
            </li>
          ))}
        </CardList>
      </PreviewLayout>
    </section>
  )
}
