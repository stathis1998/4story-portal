import { SLOT_MACHINES, silverText, slotLargestWin, slotLine, slotMachine, slotOdds, slotPrize, slotRest, slotReturn, slotWindow, walletSilver } from '@4story-portal/shared'
import type { SlotMachine, SlotMachineKey, SlotMachineState, SlotSpinResult, SlotSpinView, SlotsState, SlotStops } from '@4story-portal/shared'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useEffectEvent, useId, useRef, useState } from 'react'
import type { ReactNode, Ref } from 'react'
import { Button } from '../../components/Button'
import { FormMessage } from '../../components/FormMessage'
import { WalletCharacterPicker, WalletCoins } from '../../components/games/WalletCharacterPicker'
import { GameIcon } from '../../components/gm/GameIcon'
import { PayTable } from '../../components/slots/PayTable'
import { Reels } from '../../components/slots/Reels'
import { Tabs } from '../../components/Tabs'
import { slotsErrorMessage, slotsQueryOptions, spinSlots } from '../../lib/slots'
import { reducedMotion, useChosenCharacter, useHeldSpin } from '../../lib/wallet-game'
import { formatSpinTime } from '../../lib/wheel'

export const Route = createFileRoute('/_authed/slots')({
  component: SlotsPage,
})

const CHARACTER_KEY = 'slots.character'
const MACHINE_KEY = 'slots.machine'
const stakeKey = (machine: SlotMachineKey) => `slots.stake.${machine}`
const labelText = 'text-xs font-bold tracking-wider text-muted uppercase'
const cardFrame = 'rounded-xs border border-line bg-surface'
const card = `${cardFrame} p-4 sm:p-5`
const LAST_SPINS = 10

/** What the browser remembers under `key`, if it lets us. */
function remembered(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage is blocked: the choice still holds for this visit.
  }
}

/** A machine's switch and stakes. One the API left out cannot be played: there is nothing to say what it offers. */
const settingsOf = (state: SlotsState, machine: SlotMachine): SlotMachineState =>
  state.machines.find((entry) => entry.key === machine.key) ?? { key: machine.key, live: false, stakes: machine.stakes }

const houseLines = new Map<SlotMachineKey, string>()

/** What the machine pays back over time and how often a spin pays, counted from its strips. Counted once per machine. */
function houseLine(machine: SlotMachine): string {
  let line = houseLines.get(machine.key)
  if (!line) {
    const { combos, hits } = slotOdds(machine)
    line = `This machine pays back ${(slotReturn(machine) * 100).toFixed(1)}% of what goes into it, over time. One spin in ${Math.round(combos / hits)} pays something.`
    houseLines.set(machine.key, line)
  }
  return line
}

const rests = new Map<SlotMachineKey, SlotStops>()

/** Where the machine rests before its first spin. Found once per machine. */
function restOf(machine: SlotMachine): SlotStops {
  let rest = rests.get(machine.key)
  if (!rest) {
    rest = slotRest(machine)
    rests.set(machine.key, rest)
  }
  return rest
}

/** "Won" is everything paid back, stake included, so the stake is always shown beside it. */
function resultLine(machine: SlotMachine, spin: SlotSpinView): string {
  if (spin.payout <= 0) return `No win this time. You staked ${silverText(spin.stake)}.`
  return `${slotLine(machine, slotPrize(machine, spin.stops))} You won ${silverText(spin.payout)} on a stake of ${silverText(spin.stake)}.`
}

function SlotsPage() {
  const { data, isError } = useQuery(slotsQueryOptions)

  if (!data) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-6 md:py-10">
        <h1 className="text-4xl">Slots</h1>
        {isError ? (
          <div className="mt-6">
            <FormMessage message="Could not load the machines." />
          </div>
        ) : (
          <p role="status" className="mt-6 text-muted">
            Loading the machines...
          </p>
        )}
      </main>
    )
  }
  return <SlotsFloor data={data} />
}

function SlotsFloor({ data }: { data: SlotsState }) {
  // What the page showed when Spin was pressed stays on screen until the last reel stops.
  const held = useHeldSpin<SlotsState, SlotSpinResult>(slotsQueryOptions.queryKey, data)
  const view = held.view ?? data
  const { busy, shown, send } = held
  // The character whose money is at stake.
  const { character, playable: characterFree, choose } = useChosenCharacter(view.characters, CHARACTER_KEY)
  const [machineKey, setMachineKey] = useState(() => remembered(MACHINE_KEY))
  // Null is no stake: the stakes went up past the one the player had, and they pick the next themselves.
  const [stakes, setStakes] = useState<Partial<Record<SlotMachineKey, number | null>>>(() =>
    Object.fromEntries(SLOT_MACHINES.map((m) => [m.key, Number(remembered(stakeKey(m.key)))])),
  )
  // The machines whose stake the player has seen chosen on this visit: only a change to one of those is told.
  const [watched, setWatched] = useState<Partial<Record<SlotMachineKey, true>>>({})
  const [stakeNote, setStakeNote] = useState<string | null>(null)
  // Each machine's latest spin while the page is open: its reels keep showing it.
  const [spins, setSpins] = useState<Partial<Record<SlotMachineKey, { stops: SlotStops; key: number }>>>({})
  const [animate, setAnimate] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const pickerId = useId()
  const playArea = useRef<HTMLDivElement>(null)
  const stakeGroup = useRef<HTMLDivElement>(null)

  const machine = slotMachine(machineKey ?? '') ?? SLOT_MACHINES[0]
  const settings = settingsOf(view, machine)
  const picked = stakes[machine.key]
  const lowest = settings.stakes[0]
  // A stake that is not offered (any more) is replaced for good: if a later refresh offers it again it must not come
  // back by itself. A stake must never go up without the player choosing it: one they were watching becomes the
  // lowest only if that is no higher, and otherwise none until they pick. One remembered from an earlier visit just
  // falls back to the lowest. The settings are held still while a spin turns, so a change waits for its result.
  const stake =
    picked === null || (picked !== undefined && settings.stakes.includes(picked))
      ? picked
      : picked !== undefined && watched[machine.key]
        ? lowest <= picked
          ? lowest
          : null
        : lowest
  if (picked !== stake) {
    setStakes((current) => ({ ...current, [machine.key]: stake }))
    if (watched[machine.key])
      setStakeNote(
        stake === null
          ? 'The stakes on this machine changed. Pick a stake to keep playing.'
          : `The stakes on this machine changed. Your stake is now ${silverText(stake)}.`,
      )
  }
  if (stake !== null && !watched[machine.key]) setWatched((current) => ({ ...current, [machine.key]: true }))
  const money = character ? walletSilver(character.wallet) : null
  const inGame = character?.online === true
  const canSpin = view.live && settings.live && characterFree && money !== null && stake !== null && money >= stake && !busy
  const reelSpin = spins[machine.key] ?? null

  async function onSpin() {
    // A second press finds the button already off: React applies a press's state before the next one.
    if (!character || !canSpin || stake === null) return
    const key = machine.key
    setProblem(null)
    let result: SlotSpinResult
    try {
      result = await send(character.id, () => spinSlots({ characterId: character.id, machine: key, stake }))
    } catch (err) {
      // The stakes come back with the reload, and a stake that went is replaced the way the page always does it.
      setProblem(slotsErrorMessage(err))
      return
    }
    const motion = !reducedMotion()
    setAnimate(motion)
    setSpins((current) => ({ ...current, [key]: { stops: result.spin.stops, key: result.spin.id } }))
    // On a phone the reels, Spin and the result line would otherwise turn partly out of sight. All of it fits on a
    // 360 x 640 screen; 'nearest' does not move a page that already shows it.
    playArea.current?.scrollIntoView?.({ block: 'nearest', behavior: motion ? 'smooth' : 'auto' })
  }

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== ' ' || event.ctrlKey || event.altKey || event.metaKey) return
    // In a field the space is typing or choosing, and on a button it presses that button. On the chosen stake it does
    // nothing, and that is where a click on a stake leaves the focus, so there it spins.
    const target = event.target
    const onChosenStake = target instanceof HTMLInputElement && target.type === 'radio' && target.checked && stakeGroup.current?.contains(target)
    if (!onChosenStake && target instanceof Element && target.closest('select, input, textarea, button, [contenteditable="true"]')) return
    if (!canSpin && !busy) return
    // The page would scroll otherwise.
    event.preventDefault()
    // A held key repeats: every spin is a press of its own.
    if (event.repeat) return
    void onSpin()
  })
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  function pickMachine(key: string) {
    // Another machine would take the turning reels off the page before they could show the result.
    if (busy) return
    setMachineKey(key)
    remember(MACHINE_KEY, key)
    setProblem(null)
    setStakeNote(null)
  }

  function pickStake(value: number) {
    setStakes((current) => ({ ...current, [machine.key]: value }))
    setProblem(null)
    setStakeNote(null)
  }

  // The stake in play is the one remembered, including a fallback to the lowest.
  useEffect(() => {
    if (stake !== null) remember(stakeKey(machine.key), String(stake))
  }, [machine.key, stake])

  const allOnline = view.characters.length > 0 && view.characters.every((entry) => entry.online)
  // Why the machine cannot be played now. A result is shown beside it, never instead: that spin moved money.
  const note = !view.live
    ? 'The slots are not open yet. Have a look at the machines: they open soon.'
    : !settings.live
      ? 'This machine is closed. Try another one.'
      : view.characters.length === 0
        ? 'You have no characters yet.'
        : allOnline
          ? 'Log out of the game to play: your characters are all in it.'
          : character && inGame
            ? `Log out of ${character.name} in the game to keep playing, or pick another character.`
            : characterFree && money !== null && stake !== null && money < stake
              ? 'Not enough money in that wallet for this stake.'
              : null
  const lastSpin = shown && !busy && shown.spin.machine === machine.key ? shown.spin : null
  const known = (entries: SlotSpinView[]) =>
    entries.flatMap((entry) => {
      const of = slotMachine(entry.machine)
      return of ? [{ entry, machine: of }] : []
    })

  return (
    // On a phone Spin has to be on screen when the page opens (360 x 560): the tagline goes, the gambling sentence
    // moves under the machine (by order, so it is still read first), and the gaps are tighter. From sm up it is a block.
    <main className="mx-auto flex max-w-2xl flex-col px-4 pt-2 pb-4 sm:block sm:py-6 md:py-10">
      <h1 className="mb-2 text-2xl sm:mb-0 sm:text-4xl">Slots</h1>
      <p className="mt-1 hidden text-muted sm:block">Three machines, one pull at a time.</p>
      <p className="order-1 mt-3 text-sm text-muted sm:mt-1 sm:mb-6">This is real gambling with your character's money. Each machine shows what it pays back.</p>

      <Tabs
        label="Machine"
        tabs={SLOT_MACHINES.map((m) => ({ id: m.key, label: m.name, note: settingsOf(view, m).live ? undefined : 'Closed' }))}
        active={machine.key}
        onChange={pickMachine}
        disabled={busy}
        oneRow
      />

      <section role="tabpanel" id={`panel-${machine.key}`} aria-labelledby={`tab-${machine.key}`} className={`mt-2 flex flex-col gap-2 p-3 sm:mt-4 sm:gap-4 sm:p-5 ${cardFrame}`}>
        {/* The wallet beside the picker even on a phone, so the reels and Spin sit higher on the screen. */}
        <div className="flex items-end justify-between gap-3 sm:gap-6">
          <div className="min-w-0 flex-1 sm:max-w-72">
            <WalletCharacterPicker
              id={pickerId}
              label="Playing with"
              characters={view.characters}
              value={character?.id ?? null}
              disabled={busy}
              onChange={(id) => {
                choose(id)
                setProblem(null)
              }}
            />
          </div>
          {character && (
            <dl className="flex max-w-[45%] flex-col gap-1.5 sm:max-w-none">
              <dt className={labelText}>Wallet</dt>
              <dd className="flex min-h-11 items-center">
                <WalletCoins wallet={character.wallet} />
              </dd>
            </dl>
          )}
        </div>

        {/* What has to be in view while the reels turn: brought into view when a spin starts. */}
        {/* The scroll margin clears the phone's sticky header (48 px). */}
        <div ref={playArea} className="flex scroll-mt-14 flex-col gap-2 sm:gap-4 md:scroll-mt-0">
          <Reels
            key={machine.key}
            machine={machine}
            rest={reelSpin?.stops ?? restOf(machine)}
            spin={reelSpin}
            animate={animate}
            won={reelSpin ? slotPrize(machine, reelSpin.stops).count : 0}
            onStopped={() => held.reveal()}
          />

          <StakePicker ref={stakeGroup} stakes={settings.stakes} value={stake} money={money} disabled={busy} onChange={pickStake} />

          <Button
            onClick={() => void onSpin()}
            disabled={!canSpin}
            className="mx-auto min-h-12 w-full max-w-xs text-base tracking-widest uppercase"
          >
            {busy ? 'Spinning...' : 'Spin'}
          </Button>

          <FormMessage message={problem} />

          {/* Room for a two-line result on a phone, so the area does not grow past the screen when the reels stop. */}
          <div role="status" className="flex min-h-20 flex-col items-center justify-center gap-1 text-center sm:min-h-14">
            {busy ? (
              <p className="text-muted">Good luck...</p>
            ) : (
              <>
                {lastSpin && <p className={`text-lg ${lastSpin.payout > 0 ? 'font-bold text-accent-text' : ''}`}>{resultLine(machine, lastSpin)}</p>}
                {stakeNote && <p className="text-muted">{stakeNote}</p>}
                {note && <p className="text-muted">{note}</p>}
                {!lastSpin && !note && !stakeNote && <p className="text-muted">Pick a stake, then press Spin.</p>}
              </>
            )}
          </div>
        </div>
      </section>

      <section aria-labelledby="slots-pays" className={`order-2 mt-4 ${card}`}>
        <h2 id="slots-pays" className="text-2xl">
          What it pays
        </h2>
        <div className="mt-3">
          {/* With no stake chosen, what the lowest pays. */}
          <PayTable machine={machine} stake={stake ?? lowest} />
        </div>
        <p className="mt-3 text-sm text-muted">{houseLine(machine)}</p>
        <p className="mt-2 text-sm text-muted">The most one spin can win at these stakes is {silverText(slotLargestWin(machine, settings.stakes))}.</p>
      </section>

      <SpinList
        id="slots-mine"
        title="Your last spins"
        spins={known(view.mine).slice(0, LAST_SPINS)}
        empty="You have not spun yet."
        line={(entry, of) => (
          <>
            {of.name}: <LineIcons machine={of} stops={entry.stops} /> staked {silverText(entry.stake)}, won{' '}
            {entry.payout > 0 ? silverText(entry.payout) : 'nothing'}
          </>
        )}
      />
      <SpinList
        id="slots-big-wins"
        title="Big wins"
        spins={known(view.bigWins)}
        empty="Nobody has had a big win yet."
        line={(entry, of) => `${entry.character} won ${silverText(entry.payout)} on ${of.name}`}
      />
    </main>
  )
}

type StakePickerProps = {
  ref?: Ref<HTMLDivElement>
  stakes: readonly number[]
  /** Null when none is chosen. */
  value: number | null
  money: number | null
  disabled: boolean
  onChange: (stake: number) => void
}

/** The machine's three stakes. One the wallet cannot cover cannot be picked. */
function StakePicker({ ref, stakes, value, money, disabled, onChange }: StakePickerProps) {
  const name = useId()
  return (
    <div ref={ref} role="radiogroup" aria-label="Stake" className="flex flex-wrap items-center justify-center gap-2">
      {/* On a phone the label is left out, so the stakes and Spin fit on the first screen; the group keeps its name. */}
      <span aria-hidden="true" className={`${labelText} hidden sm:mr-1 sm:inline`}>
        Stake
      </span>
      {stakes.map((amount) => {
        const off = disabled || (money !== null && amount > money)
        return (
          <label key={amount} className={off ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}>
            <input
              type="radio"
              name={name}
              value={amount}
              aria-label={silverText(amount)}
              checked={amount === value}
              disabled={off}
              onChange={() => onChange(amount)}
              className="peer sr-only"
            />
            <span
              aria-hidden="true"
              className="flex min-h-11 items-center rounded-full border border-line bg-surface-raised px-3 text-sm sm:px-4 font-bold whitespace-nowrap tabular-nums transition peer-checked:border-accent peer-checked:bg-accent peer-checked:text-accent-fg peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent-text"
            >
              {silverText(amount)}
            </span>
          </label>
        )
      })}
    </div>
  )
}

/** The three symbols a spin left on the win line, at the icons' own size. */
function LineIcons({ machine, stops }: { machine: SlotMachine; stops: SlotStops }) {
  return (
    <span className="inline-flex gap-0.5 align-middle">
      {slotWindow(machine, stops).map((rows, reel) => {
        const symbol = machine.symbols[rows[1]]
        return <GameIcon key={reel} spriteId={symbol.sprite} size={32} alt={symbol.name} className="[image-rendering:pixelated]" />
      })}
    </span>
  )
}

type Known = { entry: SlotSpinView; machine: SlotMachine }
type SpinListProps = { id: string; title: string; spins: Known[]; empty: string; line: (spin: SlotSpinView, machine: SlotMachine) => ReactNode }

function SpinList({ id, title, spins, empty, line }: SpinListProps) {
  return (
    <section aria-labelledby={id} className={`order-2 mt-4 ${card}`}>
      <h2 id={id} className="text-2xl">
        {title}
      </h2>
      {spins.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="mt-2">
          {spins.map(({ entry, machine }) => (
            <li key={entry.id} className="flex items-center justify-between gap-3 border-t border-line py-2 text-sm first:border-t-0">
              <span>{line(entry, machine)}</span>
              <span className="shrink-0 text-muted tabular-nums">{formatSpinTime(entry.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
