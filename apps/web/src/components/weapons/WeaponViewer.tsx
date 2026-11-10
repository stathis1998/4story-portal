import type { GradeLayer } from '@4story-portal/shared'
import { useEffect, useRef, useState } from 'react'
import {
  AmbientLight,
  Box3,
  DataTexture,
  DirectionalLight,
  type Material,
  Matrix3,
  type Mesh,
  type Object3D,
  PerspectiveCamera,
  RepeatWrapping,
  Scene,
  type Texture,
  TextureLoader,
  Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { blendGlsl, GRADE_OPS, gradeTextureUrl, uvAt, uvMatrix, weaponModelUrl } from '../../lib/weapon-effects'

type Status = 'loading' | 'ready' | 'failed' | 'unsupported'
type Stage = { load: (src: string) => Promise<void>; setLayer: (layer: GradeLayer | null) => void; dispose: () => void }

const FIELD_OF_VIEW = 35
const FIT_MARGIN = 1.15
const START_ANGLE = -2.3
const START_HEIGHT = 0.15

// The client draws the effect as texture stage 1 over the lit weapon (CTachyonObject::Render), in
// display colours, so it is mixed in after three.js converts the result to sRGB.
const GRADE_FRAGMENT = `
#include <colorspace_fragment>
if (gradeOp > 0) {
  vec3 base = gl_FragColor.rgb;
  vec3 g = texture2D(gradeMap, (gradeUv * vec3(vGradeUv, 1.0)).xy).rgb;
  gl_FragColor.rgb = gradeBlend(base, g);
}`

const GRADE_FUNCTION = `
uniform sampler2D gradeMap;
uniform mat3 gradeUv;
uniform int gradeOp;
varying vec2 vGradeUv;
vec3 gradeBlend(vec3 base, vec3 g) {
${GRADE_OPS.map((op) => `  if (gradeOp == ${op}) return ${blendGlsl(op)};`).join('\n')}
  return base;
}`

/** One WebGL scene inside `host`, so changing weapon or effect reuses the same context. */
function createStage(host: HTMLElement): Stage {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(host.clientWidth, host.clientHeight)
  host.appendChild(renderer.domElement)

  const scene = new Scene()
  scene.add(new AmbientLight(0xffffff, 2.6))
  const camera = new PerspectiveCamera(FIELD_OF_VIEW, host.clientWidth / host.clientHeight, 0.01, 200)
  // The light moves with the camera, so the side you look at is always lit.
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

  // Shared by every material of the weapon, so a new effect only changes these values.
  const blank = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1)
  blank.needsUpdate = true
  const uniforms = { gradeMap: { value: blank as Texture }, gradeUv: { value: new Matrix3() }, gradeOp: { value: 0 } }
  const textures = new Map<number, Texture>()
  const textureLoader = new TextureLoader()
  let layer: GradeLayer | null = null

  const effectTexture = (id: number) => {
    let texture = textures.get(id)
    if (!texture) {
      texture = textureLoader.load(gradeTextureUrl(id))
      // The client samples with D3D's top-left origin, like the model's own UVs in the GLB.
      texture.flipY = false
      texture.wrapS = RepeatWrapping
      texture.wrapT = RepeatWrapping
      textures.set(id, texture)
    }
    return texture
  }

  const withGradeLayer = (material: Material) => {
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms)
      shader.vertexShader = `varying vec2 vGradeUv;\n${shader.vertexShader}`.replace('#include <uv_vertex>', '#include <uv_vertex>\nvGradeUv = uv;')
      shader.fragmentShader = `${GRADE_FUNCTION}\n${shader.fragmentShader}`.replace('#include <colorspace_fragment>', GRADE_FRAGMENT)
    }
    material.needsUpdate = true
  }

  renderer.setAnimationLoop((time) => {
    if (layer) uniforms.gradeUv.value.fromArray(uvMatrix(uvAt(layer.keys, layer.loopMs, time)))
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
      model.traverse((child) => {
        const mesh = child as Mesh
        if (!mesh.isMesh) return
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) withGradeLayer(material)
      })

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
    setLayer(next) {
      layer = next
      uniforms.gradeOp.value = next ? next.op : 0
      uniforms.gradeMap.value = next ? effectTexture(next.texture) : blank
      if (!next) uniforms.gradeUv.value.identity()
    },
    dispose() {
      latest = ''
      renderer.setAnimationLoop(null)
      resize.disconnect()
      controls.dispose()
      textures.forEach((texture) => texture.dispose())
      blank.dispose()
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

type Props = {
  itemId: number
  /** A skin the weapon wears: its model is shown with the weapon's own effect, as in game. */
  skinId: number | null
  /** The effect to draw, or null for none. */
  layer: GradeLayer | null
  name: string
}

export default function WeaponViewer({ itemId, skinId, layer, name }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const stage = useRef<Stage | null>(null)
  const [unsupported, setUnsupported] = useState(() => !supportsWebGL())
  const [loaded, setLoaded] = useState<{ src: string; ok: boolean } | null>(null)
  const src = weaponModelUrl(itemId, skinId)

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

  useEffect(() => {
    stage.current?.setLayer(layer)
  }, [layer, unsupported])

  const status: Status = unsupported ? 'unsupported' : loaded?.src !== src ? 'loading' : loaded.ok ? 'ready' : 'failed'
  const message =
    status === 'unsupported'
      ? 'Your browser cannot show 3D models.'
      : status === 'failed'
        ? 'This weapon could not be loaded.'
        : status === 'loading'
          ? 'Loading weapon...'
          : null

  return (
    <div className="relative">
      <div ref={host} role="img" aria-label={`3D model of ${name}`} className="h-96 w-full cursor-grab active:cursor-grabbing" />
      {message && <p className="absolute inset-0 flex items-center justify-center text-sm text-muted">{message}</p>}
    </div>
  )
}
