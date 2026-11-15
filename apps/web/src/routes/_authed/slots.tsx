import { SLOT_MACHINES, silverText, slotMachine, walletSilver } from '@4story-portal/shared'
import type { SlotMachine, SlotMachineKey, SlotMachineState, SlotSpinResult, SlotSpinView, SlotsState } from '@4story-portal/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useEffectEvent, useId, useRef, useState } from 'react'
import type { Ref } from 'react'
import { Button } from '../../components/Button'
import { FormMessage } from '../../components/FormMessage'
import { WalletCharacterPicker, WalletCoins } from '../../components/games/WalletCharacterPicker'
import { JackpotBanner } from '../../components/slots/JackpotBanner'
import { PayTable } from '../../components/slots/PayTable'
import { cabinetLine, Reels } from '../../components/slots/Reels'
import { WinLines } from '../../components/slots/WinLines'
import { WinShow } from '../../components/slots/WinShow'
import { Tabs } from '../../components/Tabs'
import { roundLine, roundListLine, roundSpins } from '../../lib/slot-round'
import { slotsErrorMessage, slotsQueryOptions, spinSlots } from '../../lib/slots'
import { useSlotRound, useSlotSounds } from '../../lib/use-slot-round'
import { reducedMotion, useChosenCharacter, useHeldSpin } from '../../lib/wallet-game'
import { formatSpinTime } from '../../lib/wheel'

export const Route = createFileRoute('/_authed/slots')({
  component: SlotsPage,
})

const CHARACTER_KEY = 'slots.character'
const MACHINE_KEY = 'slots.machine'
const QUICK_KEY = 'slots.quick'
const stakeKey = (machine: SlotMachineKey) => `slots.stake.${machine}`
const labelText = 'text-xs font-bold tracking-wider text-muted uppercase'
const cardFrame = 'rounded-xs border border-line bg-surface'
const card = `${cardFrame} p-4 sm:p-5`
const LAST_ROUNDS = 10
/** After every round's end, how long Spin waits before it sends again: a double click is one wish. */
const END_PAUSE_MS = 400

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

function SlotsPage() {
  const { data, isError } = useQuery(slotsQueryOptions)

  if (!data) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-6 md:py-10">
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
  // The cache as it is now: the page above hears of new data a moment late, so a round ended by a press would
  // otherwise show the wallet from before its stake for a frame. A second query here would load the state twice.
  const current = useQueryClient().getQueryData<SlotsState>(slotsQueryOptions.queryKey) ?? data
  // What the page showed when Spin was pressed stays on screen until the whole round has been shown.
  const held = useHeldSpin<SlotsState, SlotSpinResult>(slotsQueryOptions.queryKey, current)
  const view = held.view ?? current
  const { busy, sending, shown, send } = held
  const sounds = useSlotSounds()
  // Until when Spin and the space bar send nothing. A press aimed at "Stop" can land just after the round ended,
  // by itself or by an earlier press, and a double click is one wish: so every round's end, however it came, starts
  // the pause. A time, read on the same clock as the show.
  const quietUntil = useRef(0)
  // Spin looks not ready for as long as the pause lasts.
  const [resting, setResting] = useState(false)
  const round = useSlotRound(sounds, () => {
    quietUntil.current = performance.now() + END_PAUSE_MS
    setResting(true)
    held.reveal()
  })
  const show = round.show
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
  const [quick, setQuick] = useState(() => remembered(QUICK_KEY) === 'on')
  const [soundOn, setSoundOn] = useState(() => !sounds.muted)
  const [problem, setProblem] = useState<string | null>(null)
  const pickerId = useId()
  const playArea = useRef<HTMLDivElement>(null)
  const stakeGroup = useRef<HTMLDivElement>(null)

  // Spin ready again once the pause is over: looked at on each frame, so it keeps time with the show.
  useEffect(() => {
    if (!resting) return
    let frame = 0
    const look = () => {
      if (performance.now() >= quietUntil.current) setResting(false)
      else frame = requestAnimationFrame(look)
    }
    frame = requestAnimationFrame(look)
    return () => cancelAnimationFrame(frame)
  }, [resting])

  const machine = slotMachine(machineKey ?? '') ?? SLOT_MACHINES[0]
  const settings = settingsOf(view, machine)
  const picked = stakes[machine.key]
  const lowest = settings.stakes[0]
  // A stake that is not offered (any more) is replaced for good: if a later refresh offers it again it must not come
  // back by itself. A stake must never go up without the player choosing it: one they were watching becomes the
  // lowest only if that is no higher, and otherwise none until they pick. One remembered from an earlier visit just
  // falls back to the lowest. The settings are held still while a round shows, so a change waits for its result.
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
  // The answer is in and its round is on screen: Spin now hurries it along.
  const showing = busy && !sending
  // The show belongs to the machine it was played on.
  const ours = show.machine === machine.key
  // Told with the result, when the round has been shown, like the wallet.
  const wonJackpot = shown !== null && !busy && shown.spin.jackpot > 0

  async function onSpin() {
    // While a round is on screen a press stops its reels or ends what is showing: it never sends another spin.
    if (busy) {
      round.press()
      return
    }
    // Just after a round's end a press is still the player's "Stop": it must not stake money.
    if (performance.now() < quietUntil.current) return
    // A second press finds the page already busy: React applies a press's state before the next one.
    if (!character || !canSpin || stake === null) return
    // The press is what lets the browser make sound at all.
    sounds.unlock()
    sounds.play('press')
    round.clear()
    setProblem(null)
    let result: SlotSpinResult
    try {
      result = await send(character.id, stake, () => spinSlots({ characterId: character.id, machine: machine.key, stake }))
    } catch (err) {
      // The stakes come back with the reload, and a stake that went is replaced the way the page always does it.
      sounds.play('refused')
      setProblem(slotsErrorMessage(err))
      return
    }
    const motion = !reducedMotion()
    round.start(machine, result.spin, { quick, motion })
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
    // A held key repeats: every spin, and every stop, is a press of its own.
    if (event.repeat) return
    void onSpin()
  })
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  function pickMachine(key: string) {
    // Another machine would take the round off the page before it had been shown.
    if (busy) return
    round.clear()
    sounds.stop()
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

  function switchQuick(on: boolean) {
    setQuick(on)
    remember(QUICK_KEY, on ? 'on' : 'off')
  }

  function switchSound(on: boolean) {
    // The engine remembers the switch itself.
    sounds.setMuted(!on)
    setSoundOn(on)
  }

  // The stake in play is the one remembered, including a fallback to the lowest.
  useEffect(() => {
    if (stake !== null) remember(stakeKey(machine.key), String(stake))
  }, [machine.key, stake])

  const allOnline = view.characters.length > 0 && view.characters.every((entry) => entry.online)
  // Why the machine cannot be played now. A result is shown beside it, never instead: that round moved money.
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
            : // Not while a round is in play: the wallet on screen is then already short of the stake it just paid.
              !busy && characterFree && money !== null && stake !== null && money < stake
              ? 'Not enough money in that wallet for this stake.'
              : null
  const lastRound = shown && !busy && shown.spin.machine === machine.key ? shown.spin : null
  // A win below the stake is told plainly, as what it is.
  const cheered = lastRound !== null && (lastRound.payout >= lastRound.stake || lastRound.jackpot > 0)
  const known = (entries: SlotSpinView[]) =>
    entries.flatMap((entry) => {
      const of = slotMachine(entry.machine)
      return of ? [{ entry, machine: of }] : []
    })

  return (
    // On a phone Spin has to be on screen when the page opens (360 x 560): the tagline goes, the gambling sentence and
    // the jackpot move under the machine (by order, so they are still read first), and the gaps are tighter. The side
    // padding leaves the 324 px cabinet room on a 360 px screen. From sm up it is a block.
    <main className="mx-auto flex max-w-4xl flex-col px-2 pt-2 pb-4 sm:block sm:px-4 sm:py-6 md:py-10">
      <h1 className="text-2xl sm:text-4xl">Slots</h1>
      <p className="mt-1 hidden text-muted sm:block">Three machines, one pull at a time.</p>
      <p className="order-1 mt-3 text-sm text-muted sm:mt-1 sm:mb-6">This is real gambling with your character's money. Each machine shows what it pays back.</p>

      {view.jackpot && <JackpotBanner jackpot={view.jackpot} won={wonJackpot} />}

      <Tabs
        label="Machine"
        tabs={SLOT_MACHINES.map((m) => ({ id: m.key, label: m.name, note: settingsOf(view, m).live ? undefined : 'Closed' }))}
        active={machine.key}
        onChange={pickMachine}
        disabled={busy}
        oneRow
      />

      <section
        role="tabpanel"
        id={`panel-${machine.key}`}
        aria-labelledby={`tab-${machine.key}`}
        className={`mt-2 flex flex-col gap-2 px-2 py-3 sm:mt-4 sm:gap-4 sm:p-5 ${cardFrame}`}
      >
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

        {/* What has to be in view while the reels turn: brought into view when a round starts. */}
        {/* The scroll margin clears the phone's sticky header (48 px). */}
        <div ref={playArea} className="flex scroll-mt-14 flex-col gap-2 sm:gap-4 md:scroll-mt-0">
          <Reels
            key={machine.key}
            machine={machine}
            rest={show.ends[machine.key] ?? machine.rest}
            spin={ours ? show.reel : null}
            animate={show.animate}
            lit={ours ? show.lit : []}
            stopNow={show.stopNow}
            onReelStopped={round.onReelStopped}
            onStopped={round.onStopped}
          >
            {ours && (
              <>
                <WinLines lines={show.lines} colour={cabinetLine(machine.key)} />
                <WinShow banner={show.banner} win={show.win} />
              </>
            )}
          </Reels>

          {/* On a phone the Win figure takes its own line, always there, so nothing moves when a win comes. */}
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1">
            <StakePicker ref={stakeGroup} stakes={settings.stakes} value={stake} money={money} disabled={busy} onChange={pickStake} />
            <dl className="flex h-6 min-w-44 items-baseline justify-center gap-2">
              {ours && show.win !== null && (
                <>
                  <dt className={labelText}>Win</dt>
                  <dd className="font-bold text-accent-text tabular-nums">{silverText(show.win)}</dd>
                </>
              )}
            </dl>
          </div>

          {/* The two switches sit beside Spin, so they do not push it down on a phone. */}
          <div className="flex items-stretch justify-center gap-2">
            <Button
              onClick={() => void onSpin()}
              disabled={!canSpin && !showing}
              // Resting after a round: shown not ready, but not switched off, so the focus stays on it.
              aria-disabled={resting || undefined}
              className="min-h-12 w-full max-w-xs flex-1 text-base tracking-widest uppercase aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
            >
              {showing ? 'Stop' : busy ? 'Spinning...' : 'Spin'}
            </Button>
            <Switch label="Quick spin" on={quick} onChange={switchQuick} />
            <Switch label="Sound" on={soundOn} onChange={switchSound} />
          </div>

          <FormMessage message={problem} />

          {/* Room for a two-line result on a phone, so the area does not grow past the screen when the round ends. From sm
              up, room for a line and "Skip to the total": it comes after the round has been brought into view. */}
          <div className="flex min-h-20 flex-col items-center justify-center gap-1 text-center sm:min-h-16">
            <div role="status" className="flex flex-col items-center gap-1">
              {busy ? (
                <p className="text-muted">{show.free ? `Free spin ${show.free.spin} of ${show.free.of}` : 'Good luck...'}</p>
              ) : (
                <>
                  {lastRound && <p className={`text-lg ${cheered ? 'font-bold text-accent-text' : ''}`}>{roundLine(lastRound, roundSpins(machine, lastRound))}</p>}
                  {stakeNote && <p className="text-muted">{stakeNote}</p>}
                  {note && <p className="text-muted">{note}</p>}
                  {!lastRound && !note && !stakeNote && <p className="text-muted">Pick a stake, then press Spin.</p>}
                </>
              )}
            </div>
            {/* Under Spin, not over the window: it never hides a symbol, and the cabinet's picture does not swallow it. */}
            {ours && show.skip && (
              <Button
                variant="secondary"
                size="sm"
                onClick={round.skip}
              >
                Skip to the total
              </Button>
            )}
          </div>
        </div>
      </section>

      {/* From 1024 px what it pays sits beside the two lists. */}
      <div className="order-2 mt-4 flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:items-start">
        <section aria-labelledby="slots-pays" className={`${card} lg:row-span-2`}>
          <h2 id="slots-pays" className="text-2xl">
            What it pays
          </h2>
          <div className="mt-3">
            {/* With no stake chosen, what the lowest pays. */}
            <PayTable machine={machine} stake={stake ?? lowest} stakes={settings.stakes} jackpotLive={view.jackpot?.live === true} />
          </div>
        </section>

        <RoundList
          id="slots-mine"
          title="Your last rounds"
          rounds={known(view.mine).slice(0, LAST_ROUNDS)}
          empty="You have not played yet."
          line={(entry, of) => roundListLine(of, entry)}
        />
        <RoundList
          id="slots-big-wins"
          title="Big wins"
          rounds={known(view.bigWins)}
          empty="Nobody has had a big win yet."
          line={(entry, of) =>
            entry.jackpot > 0 ? `${entry.character} won the jackpot, ${silverText(entry.jackpot)}` : `${entry.character} won ${silverText(entry.payout)} on ${of.name}`
          }
        />
      </div>
    </main>
  )
}

/** A switch the player turns on and off, as a pressed button. */
function Switch({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className={`min-h-12 w-16 shrink-0 rounded-xs border px-1 text-xs leading-tight font-bold transition outline-none focus-visible:ring-2 focus-visible:ring-accent-text sm:w-20 ${
        on ? 'border-accent bg-accent/15 text-fg' : 'border-line bg-surface-raised text-muted'
      }`}
    >
      {label}
    </button>
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

type Known = { entry: SlotSpinView; machine: SlotMachine }
type RoundListProps = { id: string; title: string; rounds: Known[]; empty: string; line: (round: SlotSpinView, machine: SlotMachine) => string }

function RoundList({ id, title, rounds, empty, line }: RoundListProps) {
  return (
    <section aria-labelledby={id} className={card}>
      <h2 id={id} className="text-2xl">
        {title}
      </h2>
      {rounds.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="mt-2">
          {rounds.map(({ entry, machine }) => (
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
