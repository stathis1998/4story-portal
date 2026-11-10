import { useEffect, useRef } from 'react'
import { addSigned, EFFECTS, fadeAt, multiply, PARTICLE_LIFE, spawn, toShadow, type ChakraEffect, type Particle, type SpriteLook } from './chakra-effects'

const WIDTH = 320
const HEIGHT = 320
const SCALE = HEIGHT / 4.2 // pixels per game unit: the figure is about two units tall
const MIDDLE = HEIGHT / 2 + 0.25 * SCALE // the figure's middle sits low, since particles rise
const RISE = 0.35 // game units per second; the game's own motion paths aren't copied
const TURN = 0.4 // radians per second the view swings round the figure
const VIEW_HEIGHT = 0.35 // radians the view looks down, which decides how flat a level ring looks

type Images = Map<string, CanvasImageSource>

const lookKey = (look: SpriteLook) => `${look.sprite}|${look.color ?? ''}|${look.darken ? 'dark' : ''}`

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = src
  })
}

/** The sprites this effect uses, coloured by their colour key, and by the chakra's tint the way the game does it. */
async function loadSprites(effect: ChakraEffect, tint: string | null): Promise<Images> {
  const images: Images = new Map()
  for (const { look } of EFFECTS[effect]) {
    if (!('sprite' in look) || images.has(lookKey(look))) continue
    const image = await loadImage(`/chakra-sprites/${look.sprite}.png`)
    if (!tint && !look.color && !look.darken) {
      images.set(lookKey(look), image)
      continue
    }
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    const pixels = context.getImageData(0, 0, image.width, image.height)
    if (look.color) multiply(pixels.data, look.color)
    if (look.darken) toShadow(pixels.data)
    else if (tint) addSigned(pixels.data, tint)
    context.putImageData(pixels, 0, 0)
    images.set(lookKey(look), canvas)
  }
  return images
}

function drawFigure(context: CanvasRenderingContext2D) {
  const at = (y: number) => MIDDLE - y * SCALE
  context.globalCompositeOperation = 'source-over'
  // A faintly lit floor, so effects that darken have something to darken.
  context.save()
  context.translate(WIDTH / 2, at(-1))
  context.scale(1, Math.sin(VIEW_HEIGHT))
  const floor = context.createRadialGradient(0, 0, 0, 0, 0, 1.6 * SCALE)
  floor.addColorStop(0, 'rgba(140, 145, 160, 0.6)')
  floor.addColorStop(1, 'transparent')
  context.fillStyle = floor
  context.fillRect(-1.6 * SCALE, -1.6 * SCALE, 3.2 * SCALE, 3.2 * SCALE)
  context.restore()
  context.fillStyle = 'rgba(150, 155, 170, 0.28)'
  context.beginPath()
  context.arc(WIDTH / 2, at(0.78), 0.14 * SCALE, 0, Math.PI * 2)
  context.fill()
  context.beginPath()
  context.roundRect(WIDTH / 2 - 0.24 * SCALE, at(0.6), 0.48 * SCALE, 0.78 * SCALE, 0.12 * SCALE)
  context.fill()
  context.beginPath()
  context.roundRect(WIDTH / 2 - 0.2 * SCALE, at(-0.1), 0.17 * SCALE, 0.9 * SCALE, 0.06 * SCALE)
  context.roundRect(WIDTH / 2 + 0.03 * SCALE, at(-0.1), 0.17 * SCALE, 0.9 * SCALE, 0.06 * SCALE)
  context.fill()
}

function drawParticle(context: CanvasRenderingContext2D, particle: Particle, now: number, view: number, images: Images, tint: string | null) {
  const age = now - particle.born
  const { emitter } = particle
  const alpha = fadeAt(emitter.fade, age)
  if (alpha <= 0) return
  const seconds = age / 1000
  const x = particle.x * Math.cos(view) - particle.z * Math.sin(view)
  const depth = particle.x * Math.sin(view) + particle.z * Math.cos(view)
  const perspective = 1 + depth * 0.08
  const px = WIDTH / 2 + x * SCALE * perspective
  let py = MIDDLE - (particle.y + seconds * RISE) * SCALE
  const size = emitter.size * SCALE * perspective
  context.globalAlpha = alpha

  if ('sprite' in emitter.look) {
    const image = images.get(lookKey(emitter.look))
    if (!image) return
    context.save()
    context.globalCompositeOperation = emitter.look.darken ? 'source-over' : 'lighter'
    context.translate(px, py)
    if (emitter.look.flat) context.scale(1, Math.max(0.15, Math.abs(Math.sin(VIEW_HEIGHT + particle.tilt))))
    context.rotate(particle.spin + seconds * (emitter.look.flat ? 3 : 1))
    context.drawImage(image, -size / 2, -size / 2, size, size)
    context.restore()
    return
  }

  const color = tint ?? emitter.look.color
  if (emitter.look.shape === 'streak') {
    py -= seconds * RISE * SCALE * 1.5 // strands climb faster than the sprites
    const glow = context.createLinearGradient(px, py - size * 0.6, px, py + size * 0.6)
    glow.addColorStop(0, 'transparent')
    glow.addColorStop(0.5, color)
    glow.addColorStop(1, 'transparent')
    context.fillStyle = glow
    context.fillRect(px - size * 0.05, py - size * 0.6, size * 0.1, size * 1.2)
  } else if (emitter.look.shape === 'orb') {
    const glow = context.createRadialGradient(px, py, 0, px, py, size / 2)
    glow.addColorStop(0, '#ffffff')
    glow.addColorStop(0.3, color)
    glow.addColorStop(1, 'transparent')
    context.fillStyle = glow
    context.fillRect(px - size / 2, py - size / 2, size, size)
  } else {
    const radius = (0.15 + seconds * 0.9) * SCALE
    context.strokeStyle = color
    context.lineWidth = 3
    context.beginPath()
    context.ellipse(WIDTH / 2, MIDDLE + 0.2 * SCALE, radius, radius * 0.3, 0, 0, Math.PI * 2)
    context.stroke()
  }
}

/** An animated, approximate preview of a chakra on a plain figure. */
export function ChakraPreview({ effect, tint, name }: { effect: ChakraEffect; tint: string | null; name: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const context = canvas.current?.getContext('2d')
    if (!context) return
    let frame = 0
    let stopped = false
    let images: Images = new Map()
    loadSprites(effect, tint).then(
      (loaded) => (images = loaded),
      () => undefined, // without its sprites the effect still shows its shapes
    )

    const emitters = EFFECTS[effect]
    const nextSpawn = emitters.map(() => 0)
    let particles: Particle[] = []
    const start = performance.now()

    const draw = (now: number) => {
      if (stopped) return
      emitters.forEach((emitter, i) => {
        // Catch up after a hidden tab, but never fill the screen in one frame.
        if (now - nextSpawn[i] > PARTICLE_LIFE) nextSpawn[i] = now - PARTICLE_LIFE
        for (; nextSpawn[i] <= now; nextSpawn[i] += emitter.every) {
          for (let n = 0; n < emitter.count; n++) particles.push(spawn(emitter, nextSpawn[i], Math.random))
        }
      })
      particles = particles.filter((particle) => now - particle.born < PARTICLE_LIFE)

      context.globalAlpha = 1
      context.globalCompositeOperation = 'source-over'
      context.clearRect(0, 0, WIDTH, HEIGHT)
      drawFigure(context)
      context.globalCompositeOperation = 'lighter'
      const view = ((now - start) / 1000) * TURN
      for (const particle of particles) drawParticle(context, particle, now, view, images, tint)
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)

    return () => {
      stopped = true
      cancelAnimationFrame(frame)
    }
  }, [effect, tint])

  return (
    <canvas
      ref={canvas}
      width={WIDTH}
      height={HEIGHT}
      role="img"
      aria-label={`Preview of ${name}`}
      className="mx-auto block h-80 w-80 max-w-full rounded-xs bg-[#0b0d14]"
    />
  )
}
