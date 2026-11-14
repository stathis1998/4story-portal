import { checkBets, rouletteChips, rouletteColour, silverText, walletSilver } from '@4story-portal/shared'
import type { RouletteBet, RouletteSpinResult, RouletteSpinView, RouletteSpot, RouletteState } from '@4story-portal/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useId, useState } from 'react'
import { Button } from '../../components/Button'
import { FormMessage } from '../../components/FormMessage'
import { WalletCharacterPicker, WalletCoins } from '../../components/games/WalletCharacterPicker'
import { BettingTable } from '../../components/roulette/BettingTable'
import { ChipRack } from '../../components/roulette/ChipRack'
import { RouletteWheel } from '../../components/roulette/RouletteWheel'
import { rouletteErrorMessage, rouletteQueryOptions, spinRoulette } from '../../lib/roulette'
import { formatSpinTime } from '../../lib/wheel'

export const Route = createFileRoute('/_authed/roulette')({
  component: RoulettePage,
})

const CHARACTER_KEY = 'roulette.character'
const labelText = 'text-xs font-bold tracking-wider text-muted uppercase'
const card = 'rounded-xs border border-line bg-surface p-4 sm:p-5'
const NOT_ENOUGH = 'Not enough money in that wallet'
const LAST_NUMBERS = 15
const LAST_SPINS = 10

/** The character picked last time, if the browser lets us remember. */
function rememberedCharacter(): number | null {
  try {
    const id = Number(localStorage.getItem(CHARACTER_KEY))
    return Number.isInteger(id) && id > 0 ? id : null
  } catch {
    return null
  }
}

function rememberCharacter(id: number) {
  try {
    localStorage.setItem(CHARACTER_KEY, String(id))
  } catch {
    // Storage is blocked: the choice still holds for this visit.
  }
}

/** No animation where the browser asks for none, or cannot say. */
const reducedMotion = () => typeof window.matchMedia !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** One chip put down, in the order they went on, so Undo can take back the last. */
type Chip = { spot: RouletteSpot; amount: number }

/** The chips added up per spot, in the order each spot was first bet on. */
function betsOf(chips: Chip[]): RouletteBet[] {
  const bySpot = new Map<RouletteSpot, number>()
  for (const chip of chips) bySpot.set(chip.spot, (bySpot.get(chip.spot) ?? 0) + chip.amount)
  return [...bySpot].map(([spot, amount]) => ({ spot, amount }))
}

const stakeOf = (chips: Chip[]) => chips.reduce((sum, chip) => sum + chip.amount, 0)

const pocketName = (pocket: number) => `${pocket} ${rouletteColour(pocket)}`

/** "Won" is everything paid back, stake included, so the stake is always shown beside it. */
const resultLine = (spin: RouletteSpinView) =>
  spin.payout > 0
    ? `${pocketName(spin.pocket)}. You won ${silverText(spin.payout)} on a stake of ${silverText(spin.stake)}.`
    : `${pocketName(spin.pocket)}. No win this time. You staked ${silverText(spin.stake)}.`

/** A spin the wheel is still turning toward, with what the page showed before it, so nothing gives the result away. */
type Turning = { result: RouletteSpinResult; before: RouletteState; chips: Chip[]; characterId: number }

/**
 * The state to show once the wheel stops. If the API could not read the characters back after a good spin,
 * the list from before stays, with the wallet the spin left.
 */
function afterSpin({ result, before, characterId }: Turning, current: RouletteState | undefined): RouletteState {
  const base = current ?? before
  const characters = result.state.characters.length > 0 ? result.state.characters : base.characters
  const mine = result.state.mine.some((entry) => entry.id === result.spin.id) ? result.state.mine : [result.spin, ...base.mine]
  return {
    ...result.state,
    mine,
    characters: characters.map((character) => (character.id === characterId ? { ...character, wallet: result.wallet } : character)),
  }
}

function RoulettePage() {
  const queryClient = useQueryClient()
  const { data, isError } = useQuery(rouletteQueryOptions)
  const [chosen, setChosen] = useState(rememberedCharacter)
  const [chip, setChip] = useState<number | null>(null)
  const [chips, setChips] = useState<Chip[]>([])
  const [lastChips, setLastChips] = useState<Chip[] | null>(null)
  const [sending, setSending] = useState(false)
  const [turning, setTurning] = useState<Turning | null>(null)
  const [wheelSpin, setWheelSpin] = useState<{ pocket: number; key: number } | null>(null)
  const [animate, setAnimate] = useState(false)
  const [shown, setShown] = useState<RouletteSpinResult | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const pickerId = useId()
  const lastNumbersId = useId()

  if (!data) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-6 md:py-10">
        <h1 className="text-4xl">Roulette</h1>
        {isError ? (
          <div className="mt-6">
            <FormMessage message="Could not load the table." />
          </div>
        ) : (
          <p role="status" className="mt-6 text-muted">
            Loading the table...
          </p>
        )}
      </main>
    )
  }

  // While the wheel turns the page keeps showing what it had, even if a poll brings the new state in.
  const view = turning?.before ?? data
  const free = view.characters.filter((entry) => !entry.online)
  const character = free.find((entry) => entry.id === chosen) ?? free[0]
  const money = character ? walletSilver(character.wallet) : 0
  const busy = sending || turning !== null
  const playable = view.live && character !== undefined && !busy
  const rack = rouletteChips(view.limits)
  const chipValue = chip !== null && rack.includes(chip) ? chip : rack[0]
  const bets = betsOf(chips)
  const stake = stakeOf(chips)
  const onFelt = Object.fromEntries(bets.map((bet) => [bet.spot, bet.amount])) as Partial<Record<RouletteSpot, number>>

  /** Why these chips cannot go on the table, or null. */
  const refusalFor = (next: Chip[], spots: RouletteBet[]) => checkBets(spots, view.limits) ?? (stakeOf(next) > money ? NOT_ENOUGH : null)

  function place(spot: RouletteSpot) {
    const next = [...chips, { spot, amount: chipValue }]
    const refusal = refusalFor(next, [{ spot, amount: (onFelt[spot] ?? 0) + chipValue }])
    setProblem(refusal)
    if (!refusal) setChips(next)
  }

  function sameAgain() {
    if (!lastChips) return
    const refusal = refusalFor(lastChips, betsOf(lastChips))
    setProblem(refusal)
    if (!refusal) setChips(lastChips)
  }

  function reveal() {
    if (!turning) return
    const { result } = turning
    setTurning(null)
    setShown(result)
    setLastChips(turning.chips)
    setChips([])
    queryClient.setQueryData<RouletteState>(rouletteQueryOptions.queryKey, (current) => afterSpin(turning, current))
    // The spin went through but its state could not be read: fetch it properly.
    if (result.state.characters.length === 0) void queryClient.invalidateQueries({ queryKey: rouletteQueryOptions.queryKey })
  }

  async function onSpin() {
    // A second tap finds the button already off: React applies a click's state before the next click.
    if (!character || busy) return
    const refusal = refusalFor(chips, bets)
    if (refusal) return setProblem(refusal)
    setProblem(null)
    setShown(null)
    setSending(true)
    let result: RouletteSpinResult
    try {
      result = await spinRoulette(character.id, bets)
    } catch (err) {
      setSending(false)
      setProblem(rouletteErrorMessage(err))
      // A refusal usually means the page was out of date: new limits, a new wallet, a character now in the game.
      void queryClient.invalidateQueries({ queryKey: rouletteQueryOptions.queryKey })
      return
    }
    // A poll that left before the spin would land after it with the old wallet; one that starts now is up to date.
    await queryClient.cancelQueries({ queryKey: rouletteQueryOptions.queryKey })
    setSending(false)
    setTurning({ result, before: view, chips, characterId: character.id })
    setAnimate(!reducedMotion())
    setWheelSpin({ pocket: result.spin.pocket, key: result.spin.id })
  }

  const allOnline = view.characters.length > 0 && free.length === 0

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 md:py-10">
      <h1 className="text-4xl">Roulette</h1>
      <p className="mt-1 text-muted">Put your coin on the felt and let the ball decide.</p>
      <p className="mt-1 mb-6 text-sm text-muted">
        This is real gambling with your character's money. The zero gives the house about 2.7% of everything staked.
      </p>

      <section aria-label="Table" className={`flex flex-col gap-5 ${card}`}>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="w-full sm:w-80">
            <WalletCharacterPicker
              id={pickerId}
              label="Playing with"
              characters={view.characters}
              value={character?.id ?? null}
              disabled={busy}
              onChange={(id) => {
                setChosen(id)
                rememberCharacter(id)
                setProblem(null)
              }}
            />
          </div>
          {character && (
            <dl className="flex flex-col gap-1.5">
              <dt className={labelText}>Wallet</dt>
              <dd className="flex min-h-11 items-center">
                <WalletCoins wallet={character.wallet} />
              </dd>
            </dl>
          )}
        </div>

        <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:grid-cols-[18rem_minmax(0,1fr)] xl:grid-cols-[21rem_minmax(0,1fr)]">
          <div className="flex flex-col gap-4">
            <RouletteWheel spin={wheelSpin} animate={animate} onStopped={reveal} />
            <div className="flex flex-col gap-1.5">
              <span id={lastNumbersId} className={labelText}>
                Last numbers
              </span>
              <ol aria-labelledby={lastNumbersId} className="flex flex-wrap gap-1">
                {view.mine.slice(0, LAST_NUMBERS).map((entry) => (
                  <li key={entry.id}>
                    <PocketBadge pocket={entry.pocket} />
                  </li>
                ))}
              </ol>
              {view.mine.length === 0 && <p className="text-sm text-muted">Your numbers show here.</p>}
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <BettingTable bets={onFelt} winning={shown?.winning ?? []} disabled={!playable} onPlace={place} />

            <div className="flex flex-col gap-1.5">
              <span className={labelText}>Chips</span>
              <ChipRack chips={rack} value={chipValue} disabled={!playable} onChange={setChip} />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" disabled={busy || chips.length === 0} onClick={() => setChips(chips.slice(0, -1))} className="min-h-11">
                Undo
              </Button>
              <Button variant="secondary" disabled={busy || chips.length === 0} onClick={() => setChips([])} className="min-h-11">
                Clear
              </Button>
              {lastChips && (
                <Button variant="secondary" disabled={!playable} onClick={sameAgain} className="min-h-11">
                  Same bets again
                </Button>
              )}
            </div>

            {/* On a phone the stake, the reason for a refused chip and Spin stay in view below the tall felt. */}
            <div className="sticky bottom-0 z-30 -mx-4 flex flex-col gap-2 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur-sm sm:-mx-5 sm:px-5 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
              <FormMessage message={problem} />
              <div className="flex items-center justify-between gap-4">
                <dl className="flex flex-col gap-0.5">
                  <dt className={labelText}>On the table</dt>
                  <dd className="text-lg font-bold tabular-nums">{silverText(stake)}</dd>
                </dl>
                <Button
                  onClick={() => void onSpin()}
                  disabled={chips.length === 0 || !playable}
                  className="min-h-12 min-w-32 text-base tracking-widest uppercase sm:min-w-40"
                >
                  {busy ? 'Spinning...' : 'Spin'}
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div role="status" className="text-center">
          {busy ? (
            <p className="text-muted">Good luck...</p>
          ) : !view.live ? (
            <p className="text-muted">The table is not open yet. Have a look around: betting starts soon.</p>
          ) : view.characters.length === 0 ? (
            <p className="text-muted">You have no characters yet.</p>
          ) : allOnline ? (
            <p className="text-muted">Log out of the game to play: your characters are all in it.</p>
          ) : shown ? (
            <div className="flex flex-col items-center gap-2">
              <PocketBadge pocket={shown.spin.pocket} large />
              <p className={shown.spin.payout > 0 ? 'text-lg font-bold text-accent-text' : 'text-lg'}>{resultLine(shown.spin)}</p>
            </div>
          ) : (
            <p className="text-muted">Pick a chip, then tap the felt to put it down.</p>
          )}
        </div>
      </section>

      <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        <HowItPays limits={view.limits} />
        <SpinList
          id="roulette-mine"
          title="Your last spins"
          spins={view.mine.slice(0, LAST_SPINS)}
          empty="You have not spun yet."
          line={(entry) => `${pocketName(entry.pocket)}, staked ${silverText(entry.stake)}, won ${entry.payout > 0 ? silverText(entry.payout) : 'nothing'}`}
        />
        <SpinList
          id="roulette-big-wins"
          title="Big wins"
          spins={view.bigWins}
          empty="Nobody has hit a number yet."
          line={(entry) => `${entry.character} hit ${entry.pocket} and won ${silverText(entry.payout)}`}
        />
      </div>
    </main>
  )
}

const BADGE = { red: 'bg-accent text-accent-fg', black: 'bg-[#1b1616] text-fg', green: 'bg-[#1f7a4a] text-white' }

/** A number in its colour, as on a real table's board. The colour is written out for screen readers. */
function PocketBadge({ pocket, large = false }: { pocket: number; large?: boolean }) {
  const colour = rouletteColour(pocket)
  if (large) {
    return (
      <span
        aria-hidden="true"
        className={`inline-flex h-16 w-16 items-center justify-center rounded-full border-2 border-white/60 font-display text-3xl font-bold ${BADGE[colour]}`}
      >
        {pocket}
      </span>
    )
  }
  return (
    <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/25 text-sm font-bold tabular-nums ${BADGE[colour]}`}>
      {pocket}
      <span className="sr-only"> {colour}</span>
    </span>
  )
}

const PAYOUTS: [string, string, string][] = [
  ['A number', 'one of 0 to 36', '35 to 1'],
  ['Red, Black', '18 numbers each', '1 to 1'],
  ['Odd, Even', '18 numbers each', '1 to 1'],
  ['1 to 18, 19 to 36', '18 numbers each', '1 to 1'],
  ['A dozen (1 to 12, 13 to 24, 25 to 36)', '12 numbers', '2 to 1'],
  ['A column', '12 numbers', '2 to 1'],
]

function HowItPays({ limits }: { limits: RouletteState['limits'] }) {
  return (
    <section aria-labelledby="roulette-pays" className={card}>
      <h2 id="roulette-pays" className="text-2xl">
        How it pays
      </h2>
      <table className="mt-3 w-full text-left text-sm">
        <thead>
          <tr className="text-muted">
            <th className="py-1 pr-2 font-bold">Bet</th>
            <th className="py-1 pr-2 font-bold">Covers</th>
            <th className="py-1 text-right font-bold">Pays</th>
          </tr>
        </thead>
        <tbody>
          {PAYOUTS.map(([bet, covers, pays]) => (
            <tr key={bet} className="border-t border-line">
              <td className="py-2 pr-2">{bet}</td>
              <td className="py-2 pr-2 text-muted">{covers}</td>
              <td className="py-2 text-right font-bold whitespace-nowrap tabular-nums">{pays}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-sm text-muted">
        "35 to 1" means the stake comes back with 35 times as much on top. Zero wins only for a chip on 0, and every other spot loses
        then. That zero is the house's whole share: 1 in 37, about 2.7% of everything staked, the same on every bet.
      </p>
      <p className="mt-2 text-sm text-muted">
        Bets from {silverText(limits.minBet)}, up to {silverText(limits.maxNumber)} on a number and {silverText(limits.maxOutside)} on any other
        spot.
      </p>
    </section>
  )
}

type SpinListProps = { id: string; title: string; spins: RouletteSpinView[]; empty: string; line: (spin: RouletteSpinView) => string }

function SpinList({ id, title, spins, empty, line }: SpinListProps) {
  return (
    <section aria-labelledby={id} className={card}>
      <h2 id={id} className="text-2xl">
        {title}
      </h2>
      {spins.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="mt-2">
          {spins.map((entry) => (
            <li key={entry.id} className="flex items-baseline justify-between gap-3 border-t border-line py-2 text-sm first:border-t-0">
              <span>{line(entry)}</span>
              <span className="shrink-0 text-muted tabular-nums">{formatSpinTime(entry.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
