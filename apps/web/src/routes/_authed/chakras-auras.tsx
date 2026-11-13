import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { ChakraPreview } from '../../components/chakras/ChakraPreview'
import { CardList, PickCard, PreviewLayout, PreviewPanel, SectionTitle } from '../../components/CollectionCard'
import { AURAS, CHAKRAS, type Chakra } from '../../lib/mounts-chakras'

export const Route = createFileRoute('/_authed/chakras-auras')({
  component: ChakrasAurasPage,
})

function ChakrasAurasPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-4xl">Chakras & Auras</h1>
      <p className="mt-1 mb-6 text-muted">Every chakra and aura in the game.</p>

      <Effects title="Chakras" preview="Chakra preview" items={CHAKRAS} />
      <Effects title="Auras" preview="Aura preview" items={AURAS} />
    </main>
  )
}

/** A list of chakras or auras, with an animated preview of the one picked. */
function Effects({ title, preview, items }: { title: string; preview: string; items: readonly Chakra[] }) {
  const [selected, setSelected] = useState(items[0])

  return (
    <section className="mt-8">
      <SectionTitle title={title} count={items.length} />
      <PreviewLayout>
        <PreviewPanel label={preview}>
          <h3 className="mb-2 text-lg font-bold">{selected.name}</h3>
          <ChakraPreview effect={selected.effect} tint={selected.tint} name={selected.name} />
          <p className="mt-2 text-sm text-muted">A rough preview made from the game's own sprites and colours. In game it moves differently.</p>
        </PreviewPanel>

        <CardList label={title}>
          {items.map((chakra) => (
            <li key={chakra.name}>
              <PickCard icon={chakra.icon} name={chakra.name} selected={chakra.name === selected.name} onPick={() => setSelected(chakra)} />
            </li>
          ))}
        </CardList>
      </PreviewLayout>
    </section>
  )
}
