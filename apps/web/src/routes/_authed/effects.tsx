import {
  ARMOR_KINDS,
  EFFECT_KINDS,
  GRADE_EFFECTS,
  type GradeLayer,
  gradeSkin,
  layerKey,
  MAX_ITEM_LEVEL,
  MIN_GRADE_EFFECT_LEVEL,
  WEAPON_KINDS,
  type WeaponSearchResult,
} from '@4story-portal/shared'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense, useEffect, useState } from 'react'
import { Button } from '../../components/Button'
import { apiFetch } from '../../lib/api'
import { weaponEffectsQueryOptions, weaponSearchQueryOptions } from '../../lib/weapon-effects'

const WeaponViewer = lazy(() => import('../../components/weapons/WeaponViewer'))

// Optional so links may leave them out; validateSearch always fills level and effect in.
type Search = { item?: number; level?: number; effect?: number; skin?: number }

const DEFAULT_LEVEL = MIN_GRADE_EFFECT_LEVEL
const DEBOUNCE_MS = 250
const MIN_LETTERS = 2

const wholeNumber = (value: unknown) => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.trunc(number) : null
}
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export const Route = createFileRoute('/_authed/effects')({
  // Anything odd in the address is pulled back inside what the game allows.
  validateSearch: (search: Record<string, unknown>): Search => {
    const item = wholeNumber(search.item)
    const skin = wholeNumber(search.skin)
    return {
      item: item !== null && item > 0 ? item : undefined,
      level: clamp(wholeNumber(search.level) ?? DEFAULT_LEVEL, 0, MAX_ITEM_LEVEL),
      effect: clamp(wholeNumber(search.effect) ?? 1, 1, GRADE_EFFECTS.length),
      skin: skin !== null && skin > 0 ? skin : undefined,
    }
  },
  component: EffectsPage,
})

const kindName = (kind: number) => EFFECT_KINDS.find((entry) => entry.kind === kind)?.name ?? 'Item'

function tierText(level: number): string {
  if (level === 0) return 'No glow at +0.'
  if (level <= 5) return 'No glow from +1 to +5.'
  if (level <= 10) return 'From +6 to +10 every item gets the same first glow.'
  if (level <= 15) return 'From +11 to +15 every item gets the same second glow.'
  if (level === 16) return 'At +16 every item glows gold.'
  return 'From +17 the look depends only on the effect the item rolled, so a +17 and a +24 with the same effect look the same.'
}

function EffectsPage() {
  const search = Route.useSearch()
  const level = search.level ?? DEFAULT_LEVEL
  const effect = search.effect ?? 1
  const navigate = Route.useNavigate()
  // The picks live in the address, and the router scrolls to the top on every navigation unless told not to.
  const set = (changes: Partial<Search>) =>
    navigate({ search: (previous) => ({ ...previous, ...changes }), replace: true, resetScroll: false })

  const effects = useQuery(weaponEffectsQueryOptions)
  const weapon = useQuery({
    queryKey: ['weapon-effects', 'weapon', search.item],
    queryFn: () => apiFetch<WeaponSearchResult>(`/weapon-effects/weapons/${search.item}`),
    enabled: search.item !== undefined,
    staleTime: Infinity,
  })

  const skin = gradeSkin(level, effect)
  const layer: GradeLayer | null = weapon.data && skin !== null ? (effects.data?.layers[layerKey(weapon.data.kind, skin)] ?? null) : null

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-4xl">Effects</h1>
      <p className="mt-1 mb-6 text-muted">
        See any weapon or armour piece the way the game draws it at each upgrade level. The model, the glow, its colours and how it
        moves come straight from the game client. Drag to turn it.
      </p>

      <WeaponFinder onPick={(picked) => set({ item: picked.itemId, skin: undefined })} />

      {effects.isError || weapon.isError ? (
        <div className="rounded-xs border border-danger/40 bg-danger-surface p-5">
          <p className="text-danger">
            {effects.isError ? 'Weapon previews are not available right now.' : 'That item has no model in the game.'}
          </p>
        </div>
      ) : search.item === undefined ? (
        <section className="rounded-xs border border-line bg-surface p-5">
          <p className="text-muted">Pick a weapon or armour piece to see it in 3D.</p>
        </section>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[1fr_22rem]">
          <section aria-label="Preview" className="rounded-xs border border-line bg-surface p-5">
            <h2 className="text-2xl">{weapon.data?.name ?? 'Loading...'}</h2>
            {weapon.data && (
              <p className="text-sm text-muted">
                {kindName(weapon.data.kind)}, level {weapon.data.level}
              </p>
            )}
            {weapon.data && (
              <Suspense fallback={<div className="h-96" />}>
                <WeaponViewer itemId={search.item} skinId={search.skin ?? null} layer={layer} name={weapon.data.name} />
              </Suspense>
            )}
          </section>

          <section aria-label="Upgrade" className="flex flex-col gap-4 rounded-xs border border-line bg-surface p-5">
            <LevelPicker level={level} onChange={(next) => set({ level: next })} />
            <p className="text-sm text-muted">{tierText(level)}</p>
            {level >= MIN_GRADE_EFFECT_LEVEL && (
              <EffectPicker
                selected={effect}
                swatch={(candidate) => {
                  const effectSkin = gradeSkin(level, candidate)
                  return weapon.data && effectSkin !== null ? (effects.data?.layers[layerKey(weapon.data.kind, effectSkin)]?.swatch ?? null) : null
                }}
                onChange={(next) => set({ effect: next })}
              />
            )}
          </section>
        </div>
      )}

      <section className="mt-4 rounded-xs border border-line bg-surface p-5 text-sm text-muted">
        <h2 className="mb-2 text-xl text-fg">How effects work</h2>
        <p>
          When a weapon or armour piece first reaches +17 the server rolls one of 39 effects, each with the same 1 in 39 chance, and the
          item keeps it. A Change Effect scroll rolls a new one. The glow is a texture the game blends over the whole item and keeps
          moving; nothing else changes with the level from +17 to +24. Cloaks show their effect differently and aren't covered here.
        </p>
      </section>
    </main>
  )
}

function WeaponFinder({ onPick }: { onPick: (weapon: WeaponSearchResult) => void }) {
  const [text, setText] = useState('')
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<number | undefined>(undefined)

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [text])

  const searching = query.length >= MIN_LETTERS || kind !== undefined
  const { data, isError } = useQuery({ ...weaponSearchQueryOptions(query.length >= MIN_LETTERS ? query : '', kind), enabled: searching })

  return (
    <section aria-label="Item search" className="mb-6 rounded-xs border border-line bg-surface p-5">
      <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
        <div>
          <label htmlFor="weapon-search" className="text-xs font-bold tracking-wider text-muted uppercase">
            Find an item
          </label>
          <input
            id="weapon-search"
            type="search"
            autoComplete="off"
            maxLength={40}
            placeholder="Type a name"
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="mt-1.5 w-full rounded-xs border border-line bg-surface-raised px-3 py-2 outline-none transition focus:border-accent focus:ring-1 focus:ring-accent"
          />
        </div>
        <div>
          <label htmlFor="weapon-kind" className="text-xs font-bold tracking-wider text-muted uppercase">
            Kind
          </label>
          <select
            id="weapon-kind"
            value={kind ?? ''}
            onChange={(event) => setKind(event.target.value ? Number(event.target.value) : undefined)}
            className="mt-1.5 w-full rounded-xs border border-line bg-surface-raised px-3 py-2 outline-none transition focus:border-accent focus:ring-1 focus:ring-accent"
          >
            <option value="">Any kind</option>
            <optgroup label="Weapons">
              {WEAPON_KINDS.filter(({ kind: id }) => id !== 10 && id !== 11).map((entry) => (
                <option key={entry.kind} value={entry.kind}>
                  {entry.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Armour">
              {ARMOR_KINDS.map((entry) => (
                <option key={entry.kind} value={entry.kind}>
                  {entry.name}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
      </div>
      {searching && isError && <p className="mt-3 text-sm text-danger">Could not search right now.</p>}
      {searching && data?.length === 0 && <p className="mt-3 text-sm text-muted">Nothing found.</p>}
      {searching && data && data.length > 0 && (
        <ul aria-label="Items found" className="mt-3 flex max-h-56 flex-wrap gap-2 overflow-y-auto">
          {data.map((weapon) => (
            <li key={weapon.itemId}>
              <button
                type="button"
                onClick={() => onPick(weapon)}
                className="rounded-xs border border-line px-2.5 py-1 text-left text-sm font-bold text-muted transition hover:text-fg"
              >
                {weapon.name}
                <span className="ml-1.5 text-xs font-normal">
                  {kindName(weapon.kind)}, {weapon.level}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function LevelPicker({ level, onChange }: { level: number; onChange: (level: number) => void }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <label htmlFor="weapon-level" className="text-xs font-bold tracking-wider text-muted uppercase">
          Upgrade level
        </label>
        <span className="font-display text-3xl text-accent-text">+{level}</span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => onChange(Math.max(0, level - 1))} disabled={level === 0} aria-label="One level lower">
          −
        </Button>
        <input
          id="weapon-level"
          type="range"
          min={0}
          max={MAX_ITEM_LEVEL}
          value={level}
          onChange={(event) => onChange(Number(event.target.value))}
          className="w-full accent-[var(--accent)]"
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onChange(Math.min(MAX_ITEM_LEVEL, level + 1))}
          disabled={level === MAX_ITEM_LEVEL}
          aria-label="One level higher"
        >
          +
        </Button>
      </div>
    </div>
  )
}

function EffectPicker({ selected, swatch, onChange }: { selected: number; swatch: (effect: number) => string | null; onChange: (effect: number) => void }) {
  const current = GRADE_EFFECTS.find((effect) => effect.id === selected)
  return (
    <div>
      <p className="text-xs font-bold tracking-wider text-muted uppercase">Effect</p>
      <p className="mt-1 text-lg font-bold">{current?.name}</p>
      <div role="group" aria-label="Effects" className="mt-2 grid max-h-96 grid-cols-2 gap-1.5 overflow-y-auto pr-1">
        {GRADE_EFFECTS.map((effect) => {
          const color = swatch(effect.id)
          const pressed = effect.id === selected
          return (
            <button
              key={effect.id}
              type="button"
              aria-pressed={pressed}
              onClick={() => onChange(effect.id)}
              className={`flex flex-col items-start rounded-xs border px-2 py-1 text-left text-sm transition ${pressed ? 'border-accent bg-accent/15 text-fg' : 'border-line text-muted hover:text-fg'}`}
            >
              <span className="flex items-center gap-1.5 font-bold">
                <span
                  aria-hidden
                  className="size-3 shrink-0 rounded-[3px] border border-line"
                  style={{ background: color ?? 'transparent' }}
                />
                {effect.name}
              </span>
              {effect.note && <span className="text-[11px] leading-tight">{effect.note}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
