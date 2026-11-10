import type { GearItem } from '@4story-portal/shared'
import { ItemSlot } from './ItemSlot'

// ES_* in NetCode.h, by position.
const SLOT_NAMES = [
  'Main weapon',
  'Second weapon',
  'Long weapon',
  'Head',
  'Back',
  'Body',
  'Pants',
  'Feet',
  'Hands',
  'Neck',
  'Left ring',
  'Right ring',
  'Left earring',
  'Right earring',
  'Face',
  'Costume hat',
  'Costume dress',
  'Costume accessory',
  'Costume race',
]

const LEFT = [3, 4, 5, 8, 6, 7]
const RIGHT = [9, 12, 13, 10, 11, 14]
const WEAPONS = [0, 1, 2]
const COSTUME = [15, 16, 17, 18]

type Props = { gear: GearItem[]; caption: string }

/** The Weapon Effects page for an equipped weapon, at its own level, effect and skin. */
function weaponViewHref(item: GearItem): string {
  const params = new URLSearchParams({ item: String(item.itemId), level: String(item.upgrade), effect: String(item.gradeEffect || 1) })
  if (item.moggItemId) params.set('skin', String(item.moggItemId))
  return `/weapon-effects?${params}`
}

// A plain link, so the gear also renders outside the router.
function WeaponLinks({ gear }: { gear: GearItem[] }) {
  const weapons = gear.filter((item) => WEAPONS.includes(item.slot)).sort((a, b) => a.slot - b.slot)
  if (weapons.length === 0) return null
  return (
    <ul className="mt-2 flex flex-col items-center gap-0.5 text-xs">
      {weapons.map((item) => (
        <li key={item.slot}>
          <a href={weaponViewHref(item)} aria-label={`View ${item.name} in 3D`} className="font-bold text-accent-text hover:underline">
            View {item.name} in 3D
          </a>
        </li>
      ))}
    </ul>
  )
}

export function CharacterGear({ gear, caption }: Props) {
  const slot = (id: number) => {
    const item = gear.find(({ slot: itemSlot }) => itemSlot === id)
    if (item) return <ItemSlot key={id} item={item} />
    const name = SLOT_NAMES[id]
    return (
      <span
        key={id}
        role="img"
        aria-label={`${name}, empty`}
        className="flex size-[42px] items-center justify-center overflow-hidden border border-line bg-bg px-0.5 text-center text-[9px] leading-none text-muted"
      >
        {name}
      </span>
    )
  }

  return (
    <div role="group" aria-label="Equipped gear" className="mx-auto w-full max-w-[300px]">
      <div className="grid grid-cols-[42px_1fr_42px] gap-2">
        <div className="flex flex-col gap-1.5">{LEFT.map(slot)}</div>
        <div className="flex items-center justify-center border border-line bg-surface-raised p-2 text-center text-sm text-muted">
          {caption}
        </div>
        <div className="flex flex-col gap-1.5">{RIGHT.map(slot)}</div>
      </div>
      <p className="mt-3 text-center text-xs text-muted">Weapons</p>
      <div className="mt-1 flex justify-center gap-1.5">{WEAPONS.map(slot)}</div>
      <WeaponLinks gear={gear} />
      <p className="mt-3 text-center text-xs text-muted">Costume</p>
      <div className="mt-1 flex justify-center gap-1.5">{COSTUME.map(slot)}</div>
    </div>
  )
}
