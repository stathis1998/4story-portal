import type { WheelSpin, WheelSpinResult } from '@4story-portal/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useId, useState } from 'react'
import { Button } from '../../components/Button'
import { FormMessage } from '../../components/FormMessage'
import { RewardSummary } from '../../components/stats/RewardSummary'
import { Wheel } from '../../components/wheel/Wheel'
import { charactersQueryOptions } from '../../lib/characters'
import {
  formatChance,
  formatCountdown,
  formatSpinTime,
  nextRotation,
  SPIN_SECONDS,
  spinWheel,
  wheelErrorMessage,
  wheelQueryOptions,
} from '../../lib/wheel'

export const Route = createFileRoute('/_authed/wheel')({
  component: WheelPage,
})

const CHARACTER_KEY = 'wheel.character'
const labelText = 'text-xs font-bold tracking-wider text-muted uppercase'
const card = 'rounded-xs border border-line bg-surface p-4 sm:p-5'

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

function WheelPage() {
  const queryClient = useQueryClient()
  const { data, isError, dataUpdatedAt } = useQuery(wheelQueryOptions)
  const characters = useQuery(charactersQueryOptions)
  const spin = useMutation({ mutationKey: ['wheel', 'spin'], mutationFn: spinWheel })
  const [chosen, setChosen] = useState(rememberedCharacter)
  const [rotation, setRotation] = useState(0)
  // The spin the wheel is still turning toward. Nothing on the page gives it away until the wheel stops.
  const [turning, setTurning] = useState<WheelSpinResult | null>(null)
  const [won, setWon] = useState<WheelSpin | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const pickerId = useId()

  const reveal = (result: WheelSpinResult) => {
    setTurning(null)
    setWon(result.spin)
    queryClient.setQueryData(wheelQueryOptions.queryKey, result.state)
  }

  // A browser that never reports the end of the turn (a hidden tab, say) still gets its result.
  useEffect(() => {
    if (!turning) return
    const timer = setTimeout(() => reveal(turning), (SPIN_SECONDS + 1) * 1000)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reveal only uses stable setters and the query client
  }, [turning])

  if (!data) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-4xl">Wheel of Fortune</h1>
        {isError ? (
          <div className="mt-6">
            <FormMessage message="Could not load the wheel." />
          </div>
        ) : (
          <p role="status" className="mt-6 text-muted">
            Loading the wheel…
          </p>
        )}
      </main>
    )
  }

  const all = [...(characters.data ?? [])].sort((a, b) => b.level - a.level || a.name.localeCompare(b.name))
  const eligible = all.filter((character) => character.level >= data.minLevel)
  const character = eligible.find((entry) => entry.id === chosen) ?? eligible[0]
  const hidden = turning?.spin.id
  const today = data.today && data.today.id !== hidden ? data.today : null
  const mine = data.mine.filter((entry) => entry.id !== hidden)
  const winners = data.winners.filter((entry) => entry.id !== hidden)
  const busy = spin.isPending || turning !== null
  const canSpin = data.live && data.prizes.length > 0 && character !== undefined && !today && !busy

  async function onSpin() {
    if (!data || !character) return
    setProblem(null)
    setWon(null)
    let result: WheelSpinResult
    try {
      result = await spin.mutateAsync(character.id)
    } catch (err) {
      setProblem(wheelErrorMessage(err))
      // The refusal usually means the page was out of date: already spun, switched off, a prize gone.
      void queryClient.invalidateQueries({ queryKey: wheelQueryOptions.queryKey })
      return
    }
    const index = data.prizes.findIndex((prize) => prize.id === result.prizeId)
    // A prize added since the page loaded has no segment to stop on.
    if (index < 0) return reveal(result)
    if (reducedMotion()) {
      setRotation((current) => nextRotation(current, index, data.prizes.length, 0))
      return reveal(result)
    }
    setRotation((current) => nextRotation(current, index, data.prizes.length))
    setTurning(result)
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-4xl">Wheel of Fortune</h1>
      <p className="mt-1 mb-6 text-muted">
        One free spin a day. Pick the character that gets the prize, and it arrives in that character's mailbox in the game.
      </p>

      <section aria-label="Spin" className={`flex flex-col gap-5 ${card}`}>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={pickerId} className={labelText}>
            Send the prize to
          </label>
          {all.length > 0 ? (
            <select
              id={pickerId}
              value={character?.id ?? ''}
              disabled={busy || eligible.length === 0}
              onChange={(event) => {
                const id = Number(event.target.value)
                setChosen(id)
                rememberCharacter(id)
              }}
              className="min-h-11 rounded-xs border border-line bg-surface-raised px-3 py-2 outline-none transition focus:border-accent focus:ring-1 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              {eligible.length === 0 && <option value="">No character at level {data.minLevel} or higher</option>}
              {all.map((entry) => {
                const allowed = entry.level >= data.minLevel
                return (
                  <option key={entry.id} value={entry.id} disabled={!allowed}>
                    {entry.name} (level {entry.level}
                    {allowed ? ` ${entry.className}` : `, needs ${data.minLevel}`})
                  </option>
                )
              })}
            </select>
          ) : (
            <p id={pickerId} className="text-sm text-muted">
              {characters.isError ? 'Could not load your characters.' : characters.data ? 'You have no characters yet.' : 'Loading your characters…'}
            </p>
          )}
        </div>

        {data.prizes.length > 0 ? (
          <Wheel prizes={data.prizes} rotation={rotation} animate={turning !== null} onStopped={() => turning && reveal(turning)} />
        ) : (
          <p className="rounded-xs border border-dashed border-line p-10 text-center text-muted">The wheel has no prizes yet.</p>
        )}

        <Button onClick={() => void onSpin()} disabled={!canSpin} className="min-h-12 w-full text-base sm:mx-auto sm:w-64">
          {busy ? 'Spinning…' : today ? 'Come back tomorrow' : 'Spin the wheel'}
        </Button>

        <FormMessage message={problem} />

        <div role="status" className="text-center">
          {busy ? (
            <p className="text-muted">Good luck…</p>
          ) : won ? (
            <Win spin={won} />
          ) : today ? (
            <p>
              Today you won <span className="font-bold">{today.prize}</span> for {today.character}.
            </p>
          ) : !data.live ? (
            <p className="text-muted">The wheel is not open yet. Have a look at the prizes: spinning starts soon.</p>
          ) : all.length > 0 && eligible.length === 0 ? (
            <p className="text-muted">You need a character at level {data.minLevel} or higher to spin.</p>
          ) : (
            character && <p className="text-muted">Your free spin is ready.</p>
          )}
          {today && !busy && (
            <p className="mt-1 text-sm text-muted">
              Next free spin in{' '}
              <Countdown
                seconds={data.secondsToReset}
                since={dataUpdatedAt}
                onDone={() => void queryClient.invalidateQueries({ queryKey: wheelQueryOptions.queryKey })}
              />
            </p>
          )}
        </div>
      </section>

      {data.prizes.length > 0 && (
        <section aria-labelledby="wheel-prizes" className={`mt-4 ${card}`}>
          <h2 id="wheel-prizes" className="text-2xl">
            Prizes
          </h2>
          <p className="mt-1 text-sm text-muted">Every segment is the same size on the wheel. This is how often each one really wins.</p>
          <ul className="mt-3">
            {data.prizes.map((prize) => (
              <li key={prize.id} className="flex items-center justify-between gap-3 border-t border-line py-2 text-sm first:border-t-0">
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-bold">
                    {prize.announce && (
                      <span className="text-accent-text" title="Announced in game">
                        ★{' '}
                      </span>
                    )}
                    {prize.name}
                  </span>
                  {prize.reward ? <RewardSummary reward={prize.reward} names /> : <span className="text-muted">No prize</span>}
                </span>
                <span className="shrink-0 font-bold tabular-nums">{formatChance(prize.chance)}</span>
              </li>
            ))}
          </ul>
          {data.prizes.some((prize) => prize.announce) && <p className="mt-2 text-xs text-muted">★ A win is announced in the game.</p>}
        </section>
      )}

      <SpinList id="wheel-mine" title="Your spins" spins={mine} empty="You have not spun yet." line={(entry) => `${entry.prize} for ${entry.character}`} />
      <SpinList id="wheel-winners" title="Big wins" spins={winners} empty="Nobody has won a big prize yet." line={(entry) => `${entry.character} won ${entry.prize}`} />
    </main>
  )
}

function Win({ spin }: { spin: WheelSpin }) {
  if (!spin.reward) {
    return (
      <div>
        <p className="text-2xl font-bold">{spin.prize}</p>
        <p className="mt-1 text-sm text-muted">Nothing this time. Come back tomorrow for another free spin.</p>
      </div>
    )
  }
  return (
    <div className="flex flex-col items-center gap-1">
      <p className="text-2xl font-bold text-accent-text">You won {spin.prize}!</p>
      <RewardSummary reward={spin.reward} names />
      <p className="text-sm text-muted">It is on its way to {spin.character}'s mailbox in the game.</p>
    </div>
  )
}

type CountdownProps = { seconds: number; since: number; onDone: () => void }

/** Counts down from `seconds`, which was true at `since` (a Date.now() value). */
function Countdown({ seconds, since, onDone }: CountdownProps) {
  const [now, setNow] = useState(since)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const left = seconds - Math.max(0, now - since) / 1000
  const done = left <= 0
  useEffect(() => {
    if (done) onDone()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the countdown runs out
  }, [done])
  return <span className="font-bold tabular-nums text-fg">{formatCountdown(left)}</span>
}

type SpinListProps = { id: string; title: string; spins: WheelSpin[]; empty: string; line: (spin: WheelSpin) => string }

function SpinList({ id, title, spins, empty, line }: SpinListProps) {
  return (
    <section aria-labelledby={id} className={`mt-4 ${card}`}>
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
