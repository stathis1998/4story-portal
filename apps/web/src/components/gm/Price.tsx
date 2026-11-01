import type { VendorShop } from '@4story-portal/shared'
import { COIN_SPRITES, splitMoney } from '@4story-portal/shared'
import { Coin } from './Coin'

type Props = { price: number; shop: VendorShop }

const number = new Intl.NumberFormat('en-US')

/** A price the way the game shows it: each non-zero denomination as a number and its coin. */
export function Price({ price, shop }: Props) {
  if (price === 0) return <>Free</>
  if (shop === 'pvp') return <span className="whitespace-nowrap tabular-nums">{number.format(price)} points</span>
  const { rune, luna, cron } = splitMoney(price)
  const parts = [
    { name: 'Rune', amount: rune, sprite: COIN_SPRITES.rune },
    { name: 'Luna', amount: luna, sprite: COIN_SPRITES.luna },
    { name: 'Cron', amount: cron, sprite: COIN_SPRITES.cron },
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
