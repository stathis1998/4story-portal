import type { VendorShop } from '@4story-portal/shared'
import { COIN_SPRITES, splitMoney } from '@4story-portal/shared'
import { Coin } from './Coin'

type Props = { price: number; shop: VendorShop }

const number = new Intl.NumberFormat('en-US')

/** A price the way the game shows it: each non-zero denomination as a number and its coin. */
export function Price({ price, shop }: Props) {
  if (price === 0) return <>Free</>
  if (shop === 'pvp') return <span className="whitespace-nowrap tabular-nums">{number.format(price)} points</span>
  const { gold, silver, bronze } = splitMoney(price)
  const parts = [
    { name: 'Gold', amount: gold, sprite: COIN_SPRITES.gold },
    { name: 'Silver', amount: silver, sprite: COIN_SPRITES.silver },
    { name: 'Bronze', amount: bronze, sprite: COIN_SPRITES.bronze },
  ].filter((part) => part.amount !== 0)
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap tabular-nums">
      {parts.map(({ name, amount, sprite }) => (
        <span key={name} className="inline-flex items-center gap-0.5">
          {number.format(amount)}
          <Coin spriteId={sprite} alt={name} />
        </span>
      ))}
    </span>
  )
}
