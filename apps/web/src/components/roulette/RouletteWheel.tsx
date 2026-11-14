import { ROULETTE_POCKETS, rouletteColour } from '@4story-portal/shared'
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import { frameAt, planSpin, pocketAngle, ROULETTE_SPIN_SECONDS } from '../../lib/roulette'

type WheelProps = {
  /** A new key starts a spin that ends with the ball in `pocket`. */
  spin: { pocket: number; key: number } | null
  /** False jumps straight to the end of the spin. */
  animate: boolean
  /** Once per spin, when the ball has come to rest. Never after unmount. */
  onStopped: () => void
}

const SIZE = 400
const C = SIZE / 2
const STEP = 360 / ROULETTE_POCKETS.length

// Radii, from the outside in. The ball runs on the track and comes to rest in the pockets.
const RIM = 198
const TRACK_OUT = 186
const TRACK_IN = 163
const NUMBERS_OUT = 160
const NUMBERS_IN = 138
const POCKETS_IN = 116
const CONE = 114
const BALL = 6.5
/** Where the ball's centre runs: the middle of the track, and the middle of a pocket. */
const BALL_TRACK = 175
const BALL_POCKET = 127

const FILL = { red: 'var(--accent)', black: '#1b1616', green: '#1f7a4a' }
const FRET = '#d8cfc0'

/** The point at `angle` degrees clockwise from the top, `radius` from the centre. */
function pointAt(angle: number, radius: number): [number, number] {
  const rad = (angle * Math.PI) / 180
  return [C + radius * Math.sin(rad), C - radius * Math.cos(rad)]
}

/** A ring segment `width` degrees wide, centred on `angle`. */
function sectorPath(angle: number, width: number, outer: number, inner: number): string {
  const [x1, y1] = pointAt(angle - width / 2, outer)
  const [x2, y2] = pointAt(angle + width / 2, outer)
  const [x3, y3] = pointAt(angle + width / 2, inner)
  const [x4, y4] = pointAt(angle - width / 2, inner)
  const f = (n: number) => n.toFixed(3)
  return `M ${f(x1)} ${f(y1)} A ${outer} ${outer} 0 0 1 ${f(x2)} ${f(y2)} L ${f(x3)} ${f(y3)} A ${inner} ${inner} 0 0 0 ${f(x4)} ${f(y4)} Z`
}

type Frame = { wheel: number; ball: number; depth: number }

/** Before the first spin the wheel has not turned and the ball sits in the zero. */
const REST: Frame = { wheel: 0, ball: pocketAngle(0), depth: 1 }

/** Turns the ring and puts the ball where `frame` says. The ball sinks from the track to the pockets with depth. */
function draw(frame: Frame, ring: SVGGElement | null, ball: SVGCircleElement | null, shadow: SVGCircleElement | null) {
  const [x, y] = pointAt(frame.ball, BALL_TRACK + (BALL_POCKET - BALL_TRACK) * frame.depth)
  ring?.setAttribute('transform', `rotate(${frame.wheel} ${C} ${C})`)
  ball?.setAttribute('cx', String(x))
  ball?.setAttribute('cy', String(y))
  // The light comes from the top left, so the shadow falls down and to the right.
  shadow?.setAttribute('cx', String(x + 1.6))
  shadow?.setAttribute('cy', String(y + 2))
}

/**
 * A European wheel seen from above: wooden rim, ball track, the ring of 37 numbered pockets and the turret.
 * The ring and the ball are moved straight on the DOM, frame by frame, so a spin does not re-render React.
 */
export function RouletteWheel({ spin, animate, onStopped }: WheelProps) {
  const ring = useRef<SVGGElement>(null)
  const ball = useRef<SVGCircleElement>(null)
  const shadow = useRef<SVGCircleElement>(null)
  const frame = useRef<Frame>(REST)
  // The spin that has finished, so the label can say where the ball is.
  const [stoppedKey, setStoppedKey] = useState<number | null>(null)
  // The last spin reported as stopped. React's development mode runs effects twice, and a spin ends once.
  const reported = useRef<number | null>(null)
  const stopped = useEffectEvent((spinKey: number) => {
    if (reported.current === spinKey) return
    reported.current = spinKey
    onStopped()
  })

  const show = (next: Frame) => {
    frame.current = next
    draw(next, ring.current, ball.current, shadow.current)
  }

  useLayoutEffect(() => {
    draw(frame.current, ring.current, ball.current, shadow.current)
  }, [])

  const key = spin?.key
  const pocket = spin?.pocket
  useEffect(() => {
    if (key === undefined || pocket === undefined || reported.current === key) return
    // The wheel carries on from where it stopped; the ball is picked up and launched from the top.
    const plan = planSpin(pocket, ((frame.current.wheel % 360) + 360) % 360)
    if (!animate) {
      show(frameAt(plan, ROULETTE_SPIN_SECONDS))
      stopped(key)
      return
    }
    let start: number | null = null
    let request = 0
    const step = (now: number) => {
      start ??= now
      const seconds = (now - start) / 1000
      show(frameAt(plan, seconds))
      if (seconds < ROULETTE_SPIN_SECONDS) {
        request = requestAnimationFrame(step)
        return
      }
      setStoppedKey(key)
      stopped(key)
    }
    request = requestAnimationFrame(step)
    return () => cancelAnimationFrame(request)
    // A spin is started by its key alone: a new `animate` mid-spin must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const label =
    spin === null
      ? 'Roulette wheel'
      : !animate || stoppedKey === spin.key
        ? `Roulette wheel, ball on ${spin.pocket} ${rouletteColour(spin.pocket)}`
        : 'Roulette wheel, spinning'

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={label} className="mx-auto block w-full max-w-[22rem] select-none">
      <defs>
        <radialGradient id="roulette-wood" cx="50%" cy="45%" r="55%">
          <stop offset="80%" stopColor="#6b3f22" />
          <stop offset="93%" stopColor="#8a5530" />
          <stop offset="100%" stopColor="#3d2312" />
        </radialGradient>
        <radialGradient id="roulette-track" cx="50%" cy="50%" r="50%">
          <stop offset="80%" stopColor="#120d0b" />
          <stop offset="92%" stopColor="#2c211b" />
          <stop offset="100%" stopColor="#4a382d" />
        </radialGradient>
        <radialGradient id="roulette-cone" cx="45%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#9a6a40" />
          <stop offset="100%" stopColor="#4a2c17" />
        </radialGradient>
        <radialGradient id="roulette-metal" cx="38%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#fbf6ec" />
          <stop offset="55%" stopColor="#bdb3a3" />
          <stop offset="100%" stopColor="#6e665b" />
        </radialGradient>
        <radialGradient id="roulette-ball-shine" cx="35%" cy="32%" r="70%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="70%" stopColor="#e8e2d8" />
          <stop offset="100%" stopColor="#a49c90" />
        </radialGradient>
      </defs>

      {/* The bowl: wooden rim and the ball track. They never move. */}
      <circle cx={C} cy={C} r={RIM} fill="url(#roulette-wood)" stroke="#2a170b" strokeWidth={2} />
      <circle cx={C} cy={C} r={TRACK_OUT} fill="url(#roulette-track)" stroke="#b08a5a" strokeOpacity={0.5} strokeWidth={1.5} />
      <circle cx={C} cy={C} r={TRACK_IN} fill="#0b0807" />
      {/* The eight deflectors on the lower edge of the track. */}
      {Array.from({ length: 8 }, (_, i) => {
        const angle = 22.5 + i * 45
        const [x1, y1] = pointAt(angle - 2.2, TRACK_IN + 2.5)
        const [x2, y2] = pointAt(angle, TRACK_IN + 4.5)
        const [x3, y3] = pointAt(angle + 2.2, TRACK_IN + 2.5)
        const [x4, y4] = pointAt(angle, TRACK_IN + 0.5)
        return <path key={angle} d={`M ${x1} ${y1} L ${x2} ${y2} L ${x3} ${y3} L ${x4} ${y4} Z`} fill="#c9c0b0" />
      })}

      <g ref={ring} data-testid="roulette-pockets">
        <circle cx={C} cy={C} r={NUMBERS_OUT + 2} fill="#9c8f7c" />
        {ROULETTE_POCKETS.map((n, index) => {
          const angle = index * STEP
          const [tx, ty] = pointAt(angle, (NUMBERS_OUT + NUMBERS_IN) / 2)
          return (
            <g key={n}>
              <path d={sectorPath(angle, STEP, NUMBERS_OUT, POCKETS_IN)} fill={FILL[rouletteColour(n)]} />
              {/* Written across the ring with its top outward, so each number reads upright as it passes the top. */}
              <text
                x={tx}
                y={ty}
                textAnchor="middle"
                dominantBaseline="central"
                transform={`rotate(${angle} ${tx} ${ty})`}
                fill="#ffffff"
                fontSize={14}
                fontWeight={700}
              >
                {n}
              </text>
            </g>
          )
        })}
        {/* The pockets sit lower than the numbers, so they are shaded. */}
        <circle cx={C} cy={C} r={(NUMBERS_IN + POCKETS_IN) / 2} fill="none" stroke="#000000" strokeOpacity={0.35} strokeWidth={NUMBERS_IN - POCKETS_IN} />
        <circle cx={C} cy={C} r={NUMBERS_IN} fill="none" stroke={FRET} strokeWidth={1.5} />
        {ROULETTE_POCKETS.map((n, index) => {
          const [x1, y1] = pointAt((index + 0.5) * STEP, POCKETS_IN)
          const [x2, y2] = pointAt((index + 0.5) * STEP, NUMBERS_OUT)
          return <line key={n} x1={x1} y1={y1} x2={x2} y2={y2} stroke={FRET} strokeWidth={1.4} />
        })}
        <circle cx={C} cy={C} r={CONE} fill="url(#roulette-cone)" stroke={FRET} strokeWidth={1.5} />
        {/* The turret: four arms and a knob, which show the wheel turning. */}
        {[0, 90, 180, 270].map((angle) => {
          const [x, y] = pointAt(angle, 58)
          return (
            <g key={angle}>
              <line x1={C} y1={C} x2={x} y2={y} stroke="#c9c0b0" strokeWidth={7} strokeLinecap="round" />
              <circle cx={x} cy={y} r={7} fill="url(#roulette-metal)" />
            </g>
          )
        })}
        <circle cx={C} cy={C} r={22} fill="url(#roulette-metal)" stroke="#5a5248" strokeWidth={1} />
        <circle cx={C} cy={C} r={8} fill="#d9d1c3" stroke="#6e665b" strokeWidth={1} />
      </g>

      <circle ref={shadow} r={BALL} fill="#000000" fillOpacity={0.45} />
      <circle ref={ball} data-testid="roulette-ball" r={BALL} fill="url(#roulette-ball-shine)" />
    </svg>
  )
}
