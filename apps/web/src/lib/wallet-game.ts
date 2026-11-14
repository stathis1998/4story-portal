import type { Wallet, WalletCharacter } from '@4story-portal/shared'
import { useQueryClient } from '@tanstack/react-query'
import type { QueryKey } from '@tanstack/react-query'
import { useState } from 'react'

// What the games that stake an offline character's wallet share: the character played with, and holding the
// screen still while a spin is in flight.

/** No animation where the browser asks for none, or cannot say. */
export const reducedMotion = () => typeof window.matchMedia !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** The character picked last time under `key`, if the browser lets us remember. */
function rememberedCharacter(key: string): number | null {
  try {
    const id = Number(localStorage.getItem(key))
    return Number.isInteger(id) && id > 0 ? id : null
  } catch {
    return null
  }
}

function rememberCharacter(key: string, id: number) {
  try {
    localStorage.setItem(key, String(id))
  } catch {
    // Storage is blocked: the choice still holds for this visit.
  }
}

/** The character the player is playing with. `changedByPage` is true on the render where the page itself had to pick another. */
export function useChosenCharacter(
  characters: WalletCharacter[] | undefined,
  storageKey: string,
): { character: WalletCharacter | undefined; playable: boolean; choose(id: number): void; changedByPage: boolean } {
  // Once set it stays, even if a poll shows it in the game: money only comes out of a wallet the player picked or
  // saw picked.
  const [chosen, setChosen] = useState<number | null>(null)
  const [remembered] = useState(() => rememberedCharacter(storageKey))
  const list = characters ?? []
  const free = list.filter((entry) => !entry.online)
  const character = list.find((entry) => entry.id === chosen)
  // The first time someone can play, the remembered character if it is free, otherwise the first free one. A
  // chosen character that is gone from the list (deleted, say) is picked again the same way.
  const changedByPage = !character && free.length > 0
  if (changedByPage) setChosen((free.find((entry) => entry.id === remembered) ?? free[0]).id)
  return {
    character,
    playable: character !== undefined && !character.online,
    choose(id) {
      setChosen(id)
      rememberCharacter(storageKey, id)
    },
    changedByPage,
  }
}

/** The parts of a game's state a spin changes for the player. */
type GameState = { characters: WalletCharacter[]; mine: { id: number }[] }
/** A game's answer to a spin: the spin, the wallet it left and the state read after the bet. */
type GameSpinResult<S extends GameState> = { spin: { id: number }; wallet: Wallet; state: S }

/** A spin the wheel or reels are still turning toward, with what the page showed before it, so nothing gives the result away. */
type Turning<S extends GameState, R extends GameSpinResult<S>> = { result: R; before: S; characterId: number }

/**
 * The state to show once the spin stops. If the API could not read the characters back after a good spin,
 * the list from before stays, with the wallet the spin left.
 */
function afterSpin<S extends GameState, R extends GameSpinResult<S>>({ result, before, characterId }: Turning<S, R>, current: S | undefined): S {
  const base = current ?? before
  const characters = result.state.characters.length > 0 ? result.state.characters : base.characters
  const mine = result.state.mine.some((entry) => entry.id === result.spin.id) ? result.state.mine : [result.spin, ...base.mine]
  return {
    ...result.state,
    mine,
    characters: characters.map((character) => (character.id === characterId ? { ...character, wallet: result.wallet } : character)),
  }
}

/**
 * Holds what the page shows still from the press until the spin stops: `view` is what the page showed when the
 * spin was sent until `reveal` is called, so a poll answered after the bet went through cannot give the result away.
 */
export function useHeldSpin<S extends GameState, R extends GameSpinResult<S>>(queryKey: QueryKey, data: S | undefined) {
  const queryClient = useQueryClient()
  const [sending, setSending] = useState(false)
  const [frozen, setFrozen] = useState<S | null>(null)
  const [turning, setTurning] = useState<Turning<S, R> | null>(null)
  const [shown, setShown] = useState<R | null>(null)
  const view = frozen ?? data

  /**
   * Sends a spin for `characterId` from the state on screen. Resolves with the answer once the wheel can turn;
   * rejects with the refusal, after asking for the state again.
   */
  async function send(characterId: number, request: () => Promise<R>): Promise<R> {
    if (!view) throw new Error('Nothing to spin from yet')
    setShown(null)
    setFrozen(view)
    setSending(true)
    let result: R
    try {
      result = await request()
    } catch (err) {
      setSending(false)
      setFrozen(null)
      // A refusal usually means the page was out of date: new limits, a new wallet, a character now in the game.
      void queryClient.invalidateQueries({ queryKey })
      throw err
    }
    // A poll that left before the spin would land after it with the old wallet; one that starts now is up to date.
    await queryClient.cancelQueries({ queryKey })
    setSending(false)
    setTurning({ result, before: view, characterId })
    return result
  }

  /** Shows the spin that has stopped, and the state it left. Null when no spin was turning. */
  function reveal(): R | null {
    if (!turning) return null
    setTurning(null)
    setFrozen(null)
    setShown(turning.result)
    queryClient.setQueryData<S>(queryKey, (current) => afterSpin(turning, current))
    // A part of the state the API could not read after the bet comes back as a fallback (a closed table, no big
    // wins, no characters), so the page always reads it again.
    void queryClient.invalidateQueries({ queryKey })
    return turning.result
  }

  return { view, sending, busy: sending || turning !== null, shown, send, reveal }
}
