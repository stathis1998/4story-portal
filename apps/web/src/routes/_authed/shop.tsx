import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '../../components/Button'

export const Route = createFileRoute('/_authed/shop')({
  component: ShopPage,
})

// A joke: nothing here takes payment or gives Gold.
const PACKS = [
  {
    name: 'Pocket Lint',
    gold: '10',
    price: '€4.99',
    message: 'Payment declined: your bank has asked us to stop, for your own good. Try killing some mobs instead.',
  },
  {
    name: "Merchant's Regret",
    gold: '1,000',
    price: '€49.99',
    message: 'The merchant regrets to inform you that this Gold is not real, and neither is the merchant.',
  },
  {
    name: 'The Second Mortgage',
    gold: '1,000,000',
    price: '€9,999.99',
    message: 'Your house has been appraised at 3 Gold and a slightly used sword. Transaction cancelled.',
  },
  {
    name: 'Sell Your Firstborn',
    gold: '999,999,999',
    price: 'One (1) firstborn',
    message: 'Our warehouse is full of firstborns and they keep asking for snacks. Please pay in quests instead.',
  },
]

function ShopPage() {
  const [message, setMessage] = useState<string | null>(null)

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-4xl">Shop</h1>
      <p className="mt-1 mb-6 text-muted">Why earn Gold when you can simply pay for it?</p>

      <div role="status" className="sticky top-3 z-10 mb-4">
        {message && <p className="rounded-xs border border-accent bg-surface px-3 py-2 text-sm">{message}</p>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {PACKS.map((pack) => (
          <section key={pack.name} aria-label={pack.name} className="flex flex-col gap-3 rounded-xs border border-line bg-surface p-5">
            <h2 className="text-2xl">{pack.name}</h2>
            <p className="font-display text-xl text-accent-text">{pack.gold} Gold</p>
            <div className="mt-auto flex items-center justify-between gap-3">
              <span className="font-bold">{pack.price}</span>
              <Button aria-label={`Buy ${pack.name}`} onClick={() => setMessage(pack.message)}>
                Buy
              </Button>
            </div>
          </section>
        ))}
      </div>
    </main>
  )
}
