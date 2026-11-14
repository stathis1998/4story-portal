import { COIN_SPRITES } from '@4story-portal/shared'
import type { UseFormRegister } from 'react-hook-form'
import { PRICE_FIELDS } from '../../lib/upgrade-prices'
import { Coin } from '../gm/Coin'
import type { UpgradeForm } from './StrategyTable'

type Props = { register: UseFormRegister<UpgradeForm>; onChange: () => void }

const COINS = [
  { key: 'rune', label: 'Rune', sprite: COIN_SPRITES.rune },
  { key: 'luna', label: 'Luna', sprite: COIN_SPRITES.luna },
  { key: 'cron', label: 'Cron', sprite: COIN_SPRITES.cron },
] as const

/** What each upgrade item costs, in the game's three coins as on the GM mail page. */
export function PriceFields({ register, onChange }: Props) {
  return (
    <div className="overflow-x-auto">
      <table className="text-left text-sm">
        <thead>
          <tr>
            <th scope="col" className="px-2 pb-2 text-xs font-bold tracking-wider text-muted uppercase">
              Item
            </th>
            {COINS.map(({ key, label, sprite }) => (
              <th key={key} scope="col" className="px-2 pb-2 text-xs font-bold tracking-wider text-muted uppercase">
                <span className="inline-flex items-center gap-1.5">
                  <Coin spriteId={sprite} />
                  {label}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PRICE_FIELDS.map((item) => (
            <tr key={item.key} className="border-t border-line">
              <th scope="row" className="px-2 py-1.5 font-bold">
                {item.label}
              </th>
              {COINS.map((coin) => (
                <td key={coin.key} className="px-2 py-1.5">
                  <input
                    type="number"
                    min={0}
                    aria-label={`${item.label} ${coin.label}`}
                    className="w-24 rounded-xs border border-line bg-surface-raised px-2 py-1 outline-none transition focus:border-accent focus:ring-1 focus:ring-accent"
                    {...register(`prices.${item.key}.${coin.key}`, { valueAsNumber: true, onChange })}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
