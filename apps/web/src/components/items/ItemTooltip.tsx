import type { GearItem } from '@4story-portal/shared'
import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { GameIcon } from '../gm/GameIcon'

const GAP = 8
const EDGE = 8

type Props = { id: string; item: GearItem; anchor: HTMLElement }

// Fixed to the viewport beside the slot, on the other side when there's no room, as in game.
export function ItemTooltip({ id, item, anchor }: Props) {
  const panel = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const { tooltip } = item

  useLayoutEffect(() => {
    const slot = anchor.getBoundingClientRect()
    const { width, height } = panel.current!.getBoundingClientRect()
    let left = slot.right + GAP
    if (left + width > window.innerWidth - EDGE) left = slot.left - GAP - width
    setPosition({
      left: Math.max(EDGE, Math.min(left, window.innerWidth - width - EDGE)),
      top: Math.max(EDGE, Math.min(slot.top, window.innerHeight - height - EDGE)),
    })
  }, [anchor])

  return createPortal(
    <div
      ref={panel}
      id={id}
      role="tooltip"
      className="game-tooltip"
      style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? 'visible' : 'hidden' }}
    >
      <div className="flex items-center gap-2.5 pb-2">
        <span className="relative shrink-0">
          <GameIcon spriteId={item.icon} size={36} />
          {tooltip.competence !== null && <span className="game-tooltip-badge">{tooltip.competence}</span>}
        </span>
        <p className="text-[13px] font-bold" style={{ color: tooltip.title.color }}>
          {tooltip.title.text}
        </p>
      </div>
      {tooltip.lines.map((line, index) => (
        <p key={index} className="min-h-4 whitespace-pre-wrap" style={{ color: line.color }}>
          {line.text}
        </p>
      ))}
    </div>,
    document.body,
  )
}
