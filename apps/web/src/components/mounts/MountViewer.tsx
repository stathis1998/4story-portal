import { useEffect, useRef, useState } from 'react'
import { AmbientLight, Box3, DirectionalLight, type Object3D, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

type Status = 'loading' | 'ready' | 'failed' | 'unsupported'
type Stage = { load: (src: string) => Promise<void>; dispose: () => void }

const FIELD_OF_VIEW = 35
const FIT_MARGIN = 1.1
const START_ANGLE = -2.3
const START_HEIGHT = 0.2

/** Sets up one WebGL scene inside `host`, so changing mount reuses the same context. */
function createStage(host: HTMLElement): Stage {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(host.clientWidth, host.clientHeight)
  host.appendChild(renderer.domElement)

  const scene = new Scene()
  scene.add(new AmbientLight(0xffffff, 2.6))

  const camera = new PerspectiveCamera(FIELD_OF_VIEW, host.clientWidth / host.clientHeight, 0.01, 200)
  // The light moves with the camera, so the side you are looking at is always lit.
  const sun = new DirectionalLight(0xffffff, 2.2)
  sun.position.set(1, 2, 3)
  camera.add(sun)
  scene.add(camera)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enablePan = false
  controls.enableDamping = true
  controls.autoRotate = true
  controls.autoRotateSpeed = 1.5
  controls.addEventListener('start', () => {
    controls.autoRotate = false
  })

  const resize = new ResizeObserver(() => {
    renderer.setSize(host.clientWidth, host.clientHeight)
    camera.aspect = host.clientWidth / host.clientHeight
    camera.updateProjectionMatrix()
  })
  resize.observe(host)

  renderer.setAnimationLoop(() => {
    controls.update()
    renderer.render(scene, camera)
  })

  const loader = new GLTFLoader()
  let current: Object3D | null = null
  let latest = ''

  return {
    async load(src) {
      latest = src
      const { scene: model } = await loader.loadAsync(src)
      if (src !== latest) return
      if (current) scene.remove(current)
      current = model

      const box = new Box3().setFromObject(model)
      model.position.sub(box.getCenter(new Vector3()))
      scene.add(model)

      const radius = box.getSize(new Vector3()).length() / 2
      const distance = (radius / Math.sin((FIELD_OF_VIEW * Math.PI) / 360)) * FIT_MARGIN
      camera.position.set(
        Math.sin(START_ANGLE) * Math.cos(START_HEIGHT) * distance,
        Math.sin(START_HEIGHT) * distance,
        Math.cos(START_ANGLE) * Math.cos(START_HEIGHT) * distance,
      )
      controls.target.set(0, 0, 0)
      controls.minDistance = distance / 3
      controls.maxDistance = distance * 2.5
    },
    dispose() {
      latest = ''
      renderer.setAnimationLoop(null)
      resize.disconnect()
      controls.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}

function supportsWebGL(): boolean {
  try {
    return Boolean(document.createElement('canvas').getContext('webgl2'))
  } catch {
    return false
  }
}

export default function MountViewer({ src, name }: { src: string; name: string }) {
  const host = useRef<HTMLDivElement>(null)
  const stage = useRef<Stage | null>(null)
  const [unsupported, setUnsupported] = useState(() => !supportsWebGL())
  const [loaded, setLoaded] = useState<{ src: string; ok: boolean } | null>(null)

  useEffect(() => {
    if (unsupported) return
    try {
      stage.current = createStage(host.current!)
    } catch {
      void Promise.resolve().then(() => setUnsupported(true))
    }
    return () => {
      stage.current?.dispose()
      stage.current = null
    }
  }, [unsupported])

  useEffect(() => {
    if (!stage.current) return
    let active = true
    stage.current.load(src).then(
      () => active && setLoaded({ src, ok: true }),
      () => active && setLoaded({ src, ok: false }),
    )
    return () => {
      active = false
    }
  }, [src, unsupported])

  const status: Status = unsupported ? 'unsupported' : loaded?.src !== src ? 'loading' : loaded.ok ? 'ready' : 'failed'
  const message =
    status === 'unsupported'
      ? 'Your browser cannot show 3D models.'
      : status === 'failed'
        ? 'This model could not be loaded.'
        : status === 'loading'
          ? 'Loading model...'
          : null

  return (
    <div className="relative">
      <div ref={host} role="img" aria-label={`3D model of ${name}`} className="h-80 w-full cursor-grab active:cursor-grabbing" />
      {message && <p className="absolute inset-0 flex items-center justify-center text-sm text-muted">{message}</p>}
    </div>
  )
}
