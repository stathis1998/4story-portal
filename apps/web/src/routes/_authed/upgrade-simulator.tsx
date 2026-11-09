import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { Tabs } from '../../components/Tabs'
import { GemPanel } from '../../components/upgrades/GemPanel'
import { UpgradePanel } from '../../components/upgrades/UpgradePanel'

export const Route = createFileRoute('/_authed/upgrade-simulator')({
  component: UpgradeSimulatorPage,
})

const TABS = [
  { id: 'upgrades', label: 'Upgrades' },
  { id: 'gemstones', label: 'Gemstones' },
]

function UpgradeSimulatorPage() {
  const [active, setActive] = useState(TABS[0].id)

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-4xl">Upgrade Simulator</h1>
      <p className="mt-1 mb-6 text-muted">
        Same chances and rules as the game, using its current rates. Just for fun, nothing here changes your items. Server events and
        NPC bonuses are not included.
      </p>
      <Tabs tabs={TABS} active={active} onChange={setActive} />
      <div role="tabpanel" id={`panel-${active}`} aria-labelledby={`tab-${active}`} className="mt-4">
        {active === 'upgrades' ? <UpgradePanel /> : <GemPanel />}
      </div>
    </main>
  )
}
