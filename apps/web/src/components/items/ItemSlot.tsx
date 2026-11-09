import type { GearItem } from '@4story-portal/shared'
import { useEffect, useId, useRef, useState } from 'react'
import { GameIcon } from '../gm/GameIcon'
import { ItemTooltip } from './ItemTooltip'
import { qualityBorder } from './quality'

export function ItemSlot({ item }: { item: GearItem }) {
  const [open, setOpen] = useState(false)
  const [button, setButton] = useState<HTMLButtonElement | null>(null)
  // A press focuses the button before its click, and a mouse has already opened it by hovering.
  const pressedWith = useRef<string | null>(null)
  const tooltipId = useId()

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onPress = (event: PointerEvent) => {
      if (!button?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPress)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPress)
    }
  }, [open, button])

  return (
    <>
      <button
        ref={setButton}
        type="button"
        aria-label={`${item.slotName}: ${item.name}`}
        aria-describedby={open ? tooltipId : undefined}
        className="flex size-[42px] items-center justify-center border border-line bg-bg transition hover:brightness-125 focus-visible:outline-1 focus-visible:outline-accent"
        style={{ borderColor: qualityBorder(item.tooltip) }}
        onPointerEnter={(event) => event.pointerType === 'mouse' && setOpen(true)}
        onPointerLeave={(event) => event.pointerType === 'mouse' && setOpen(false)}
        onPointerDown={(event) => {
          pressedWith.current = event.pointerType ?? 'touch'
        }}
        onFocus={() => {
          if (pressedWith.current === null) setOpen(true)
        }}
        onBlur={() => setOpen(false)}
        onClick={() => {
          if (pressedWith.current !== 'mouse') setOpen((value) => !value)
          pressedWith.current = null
        }}
      >
        <GameIcon spriteId={item.icon} size={38} />
      </button>
      {open && button && <ItemTooltip id={tooltipId} item={item} anchor={button} />}
    </>
  )
}
