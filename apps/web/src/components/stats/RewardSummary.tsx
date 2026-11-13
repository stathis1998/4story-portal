import { type AchievementReward, COIN_SPRITES } from '@4story-portal/shared'
import { Coin } from '../gm/Coin'
import { GameIcon } from '../gm/GameIcon'

const COINS = [
  ['gold', 'Rune', COIN_SPRITES.rune],
  ['silver', 'Luna', COIN_SPRITES.luna],
  ['copper', 'Cron', COIN_SPRITES.cron],
] as const

type Props = {
  reward: AchievementReward
  /** Write each item's name out. Without it the icon carries the name, unless there is no icon. */
  names?: boolean
}

/** What a level pays, the way the game shows money: each non-zero coin, then the items with their counts. */
export function RewardSummary({ reward, names = false }: Props) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 tabular-nums">
      {COINS.filter(([key]) => reward[key] > 0).map(([key, label, sprite]) => (
        <span key={key} className="inline-flex items-center gap-0.5 whitespace-nowrap">
          {reward[key].toLocaleString('en-US')}
          <Coin spriteId={sprite} alt={label} />
        </span>
      ))}
      {reward.items.map((item, index) => {
        const written = names || item.icon === null
        return (
          <span key={`${item.itemId}-${index}`} title={item.name} className="inline-flex items-center gap-1">
            <GameIcon spriteId={item.icon} size={20} alt={written ? '' : item.name} />
            {written && <span>{item.name}</span>}
            <span className="whitespace-nowrap">x{item.count}</span>
          </span>
        )
      })}
    </span>
  )
}
