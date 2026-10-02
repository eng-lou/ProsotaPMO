import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { BatchState } from './elementBatching'

// Visible ground for Realistic Materials mode (2026-10-02, per Maro,
// comparing against another BIM viewer's sun-lit still: buildings there sit
// on textured terrain that catches the sun's shadow, whereas ours float on
// an invisible shadow-catcher over a white or sky backdrop). Replaces the
// shadowMaterial catcher in this mode only; every other mode keeps it.
//
// The texture is generated in code (low-contrast value noise on a canvas)
// so nothing is downloaded, same reasoning as DefaultEnvironment. Tiled at a
// size relative to the model rather than a fixed metre value, because scene
// units are the IFC file's own (feet or metres; geometry is never rescaled).

function makeGroundTexture(): THREE.CanvasTexture {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  // Tileable value noise: a coarse random lattice sampled with wraparound,
  // smoothly interpolated, summed over a few octaves.
  const octave = (cells: number) => {
    const grid = Array.from({ length: cells * cells }, () => Math.random())
    const at = (x: number, y: number) => grid[((y + cells) % cells) * cells + ((x + cells) % cells)]
    return (u: number, v: number) => {
      const x = u * cells, y = v * cells
      const x0 = Math.floor(x), y0 = Math.floor(y)
      const fx = x - x0, fy = y - y0
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy)
      const top = at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx
      const bottom = at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx
      return top * (1 - sy) + bottom * sy
    }
  }
  const octaves = [octave(4), octave(8), octave(16)]
  const weights = [0.55, 0.3, 0.15]
  const image = ctx.createImageData(size, size)
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const u = px / size, v = py / size
      let n = 0
      for (let i = 0; i < octaves.length; i++) n += octaves[i](u, v) * weights[i]
      // Low-contrast, low-frequency only (2026-10-02, per Maro live:
      // "ground is flashing colors") — the first version's per-pixel grit
      // plus fine octaves, tiled hundreds of times across the plane,
      // aliased into shimmering moire at grazing angles while orbiting.
      const shade = 0.8 + (n - 0.5) * 0.22
      // Warm, dusty earth/gravel tone (sRGB).
      const i = (py * size + px) * 4
      image.data[i] = Math.max(0, Math.min(255, 172 * shade))
      image.data[i + 1] = Math.max(0, Math.min(255, 158 * shade))
      image.data[i + 2] = Math.max(0, Math.min(255, 138 * shade))
      image.data[i + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.anisotropy = 8
  return texture
}

// Where the ground should sit, on the world up axis.
//
// 2026-10-02, second pass (per Maro live: the building still floated far
// above the ground). The first version took a low percentile of each
// visible *mesh's* bottom — but nearly every IFC element lives inside one
// shared THREE.BatchedMesh per model (elementBatching.ts), so a 5-model
// scene gave only a handful of samples, each spanning a whole model, and
// the "percentile" collapsed back to the single lowest thing loaded.
//
// Now: one sample per *element* — each visible batch instance's own world
// bounding-box bottom, plus every individual (materialized/mirrored) mesh —
// bucketed into height bins. The ground goes at the lowest bin holding at
// least ~1% of all elements, i.e. the lowest level where the building
// genuinely starts, so a few deep piles, a misplaced family or a stray
// element far below can't drag it down, however far away they are.
export function computeGroundElevation(objects: THREE.Object3D[], zUp: boolean, fallback: number): number {
  const bottoms: number[] = []
  const box = new THREE.Box3()
  const matrix = new THREE.Matrix4()
  const push = (b: THREE.Box3) => { if (!b.isEmpty()) bottoms.push(zUp ? b.min.z : b.min.y) }
  for (const root of objects) {
    if (!root.visible) continue
    root.updateMatrixWorld(true)
    root.traverseVisible(child => {
      if (child instanceof THREE.BatchedMesh) {
        // The model root holding userData.batch (ifcModel.ts) may sit below
        // whatever wrapper groups the caller passed in, so walk up from the
        // batch itself rather than assuming it's `root`.
        let owner: THREE.Object3D | null = child.parent
        while (owner && !owner.userData.batch) owner = owner.parent
        const batch = owner?.userData.batch as BatchState | undefined
        if (batch && batch.mesh === child) {
          for (const infos of batch.byExpressId.values()) {
            for (const { instanceId } of infos) {
              if (!child.getVisibleAt(instanceId)) continue
              child.getBoundingBoxAt(child.getGeometryIdAt(instanceId), box)
              child.getMatrixAt(instanceId, matrix)
              push(box.applyMatrix4(matrix.premultiply(child.matrixWorld)))
            }
          }
          return
        }
        // Any other batch (Realistic mode's glass-only mirror batches) only
        // duplicates instances already counted above, and its raw geometry
        // bounding box isn't in instance-placed space anyway.
        return
      }
      if (child instanceof THREE.Mesh) {
        const geometry = child.geometry as THREE.BufferGeometry
        if (!geometry.boundingBox) geometry.computeBoundingBox()
        if (geometry.boundingBox) push(box.copy(geometry.boundingBox).applyMatrix4(child.matrixWorld))
      }
    })
  }
  if (bottoms.length === 0) return fallback
  let min = Infinity, max = -Infinity
  for (const b of bottoms) { if (b < min) min = b; if (b > max) max = b }
  if (!(max > min)) return min
  const BINS = 400
  const binSize = (max - min) / BINS
  const counts = new Array<number>(BINS + 1).fill(0)
  const lowest = new Array<number>(BINS + 1).fill(Infinity)
  for (const b of bottoms) {
    const i = Math.floor((b - min) / binSize)
    counts[i]++
    if (b < lowest[i]) lowest[i] = b
  }
  const threshold = Math.max(3, bottoms.length * 0.01)
  for (let i = 0; i <= BINS; i++) if (counts[i] >= threshold) return lowest[i]
  return min
}

export function RealisticGround({ position, rotation, modelRadius }: {
  position: [number, number, number]
  rotation: [number, number, number]
  modelRadius: number
}) {
  const texture = useMemo(() => makeGroundTexture(), [])
  useEffect(() => () => texture.dispose(), [texture])
  // Large enough to reach the visible horizon from any normal orbit
  // distance, so the sky's dark below-horizon half never shows as a gap.
  const size = modelRadius * 60
  // One texture tile ~ the model's own radius: broad, soft variation that
  // reads as terrain without the fine repeats that aliased into flicker.
  const tile = Math.max(modelRadius, 1)
  useEffect(() => {
    texture.repeat.set(size / tile, size / tile)
    texture.needsUpdate = true
  }, [texture, size, tile])
  return (
    <mesh position={position} rotation={rotation} receiveShadow>
      <planeGeometry args={[size, size]} />
      <meshStandardMaterial map={texture} roughness={0.95} metalness={0} envMapIntensity={0.6} />
    </mesh>
  )
}
