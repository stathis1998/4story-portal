import {
  SLOT_LINE_COUNT,
  SLOT_PAYING,
  SLOT_POTS,
  SLOT_POT_SHARE,
  SLOT_SCATTER,
  SLOT_WILD,
  silverText,
  slotFreeRate,
  slotJackpotShare,
  slotLargestWin,
  slotLostRate,
  slotMeterRate,
  slotReturn,
} from '@4story-portal/shared'
import type { SlotMachine, SlotPot, SlotStakes } from '@4story-portal/shared'
import { potList } from '../../lib/slot-round'
import { GameIcon } from '../gm/GameIcon'
import { LineMap } from './WinLines'

type PayTableProps = {
  machine: SlotMachine
  stake: number
  stakes: SlotStakes
  /** The pots that are on: a paused pot is fed nothing, so it adds nothing to what the machine pays back. */
  livePots: readonly SlotPot[]
}

const POT_NAMES: Record<SlotPot, string> = { mini: 'Mini', major: 'Major', giga: 'Giga' }

/** A prize is in line stakes: money is the prize x the stake / SLOT_LINE_COUNT. */
const money = (prize: number, stake: number) => silverText((prize * stake) / SLOT_LINE_COUNT)
/** A share as a percentage to one decimal: 0.0312 as "3.1". */
const percent = (share: number) => (share * 100).toFixed(1)

type Figures = {
  /** R: what the reels, free spins and meter pay back. */
  back: number
  /** L: the chance a round pays nothing. */
  lost: number
  /** What a lost round adds to the three pots, as a share of its stake. */
  share: number
}

// Machines are constants and the free round programme is not free, so each machine's figures are worked out once,
// not on every draw of the page.
const figures = new WeakMap<SlotMachine, Figures>()

function figuresOf(machine: SlotMachine): Figures {
  const known = figures.get(machine)
  if (known) return known
  const { num, den } = slotJackpotShare(machine)
  const worked = { back: slotReturn(machine), lost: slotLostRate(machine), share: num / den }
  figures.set(machine, worked)
  return worked
}

function SymbolName({ machine, symbol }: { machine: SlotMachine; symbol: number }) {
  const { name, sprite } = machine.symbols[symbol]
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden="true" className="shrink-0">
        <GameIcon spriteId={sprite} size={32} className="[image-rendering:pixelated]" />
      </span>
      <span className="font-bold">{name}</span>
    </span>
  )
}

/** Everything a player reads under the machine: what each symbol pays, the lines, and the counted figures. */
export function PayTable({ machine, stake, stakes, livePots }: PayTableProps) {
  // Top prize first.
  const order = Array.from({ length: SLOT_PAYING }, (_, i) => i).sort((a, b) => machine.pays[b][2] - machine.pays[a][2])
  const scatter = machine.symbols[SLOT_SCATTER].name
  const { back, lost, share } = figuresOf(machine)
  // Mini first, as the meters show them.
  const live = SLOT_POTS.filter((pot) => livePots.includes(pot))
  const partOf = (pot: SlotPot) => (share * SLOT_POT_SHARE[pot]) / 100
  const liveShare = live.reduce((sum, pot) => sum + partOf(pot), 0)
  // Only the pots that are on pay anything back: a paused pot is fed nothing.
  const total = back + lost * liveShare
  const counting = live.length === SLOT_POTS.length ? 'the meter and the jackpots' : live.length > 0 ? 'the meter and the jackpots that are on' : 'the meter'

  return (
    <div className="space-y-4 text-sm">
      <table className="w-full text-left">
        <thead>
          <tr className="text-muted">
            <th scope="col" className="py-1 pr-2 font-bold">
              Symbol
            </th>
            {[3, 4, 5].map((n) => (
              <th key={n} scope="col" className="py-1 pr-2 font-bold">
                {n}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {order.map((symbol) => (
            <tr key={symbol} className="border-t border-line">
              <th scope="row" className="py-2 pr-2 text-left font-normal">
                <SymbolName machine={machine} symbol={symbol} />
                {symbol === 0 && <span className="mt-1 block text-xs text-muted">Two from the left: {money(machine.twoLucky, stake)}</span>}
              </th>
              {machine.pays[symbol].map((prize, k) => (
                // Free to wrap: on a phone '6 Gold 250 Silver' would push the table past the screen's edge.
                <td key={k} className="py-2 pr-2 font-bold tabular-nums">
                  {money(prize, stake)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="space-y-1">
        <SymbolName machine={machine} symbol={SLOT_WILD} />
        <p>{`Stands in for any symbol on a line, except the ${scatter}. Only on reels 2, 3 and 4.`}</p>
      </div>
      <div className="space-y-1">
        <SymbolName machine={machine} symbol={SLOT_SCATTER} />
        <p>3, 4 or 5 anywhere give 8, 12 or 20 free spins.</p>
      </div>

      <p>20 win lines, all in play on every spin. A line pays from the left reel.</p>
      <LineMap />

      <p>Cascades: winning symbols burst and new ones fall in from above. Each win in a row pays more: x1, x2, x3, x4, then x5.</p>
      <p>
        Free spins: 3, 4 or 5 scatters give 8, 12 or 20. The multiplier starts at x2 and climbs with every win, up to x10. 3 scatters during
        free spins add 5 more, up to 50.
      </p>
      <p>{`Meter: every scatter that does not win free spins fills it. At ${machine.meterSize} it pays 8 free spins. One meter for each machine and stake.`}</p>
      <p>Jackpots: every lost round feeds the Mini, the Major and the Giga. Each must drop before its cap.</p>

      <p>{`This machine pays back ${percent(total)}% of what goes into it over time, counting ${counting}. A short session can pay back less, and the meter only pays when it fills.`}</p>
      <p>{`One round in ${(1 / (1 - lost)).toFixed(1)} pays something.`}</p>
      <p>{`Free spins come about once in ${Math.round(1 / slotFreeRate(machine))} rounds; the meter fills about once every ${Math.round(1 / slotMeterRate(machine))}.`}</p>
      <p>{`The most one paid spin can win at these stakes is ${silverText(slotLargestWin(machine, stakes))}. A round with free spins can win more.`}</p>
      {live.length > 0 && (
        <p>{`A lost round adds ${percent(liveShare)}% of its stake to the jackpots: ${potList(live.map((pot) => `${percent(partOf(pot))}% to the ${POT_NAMES[pot]}`))}.`}</p>
      )}
    </div>
  )
}
