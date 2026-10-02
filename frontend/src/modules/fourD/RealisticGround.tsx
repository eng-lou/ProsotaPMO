import { useEffect, useMemo } from 'react'
import * as THREE from 'three'

// Visible ground for Realistic Materials mode (2026-10-02, per Maro,
// comparing against another BIM viewer's sun-lit still: buildings there sit
// on textured terrain that catches the sun's shadow, whereas ours float on
// an invisible shadow-catcher over a white or sky backdrop). Replaces the
// shadowMaterial catcher in this mode only; every other mode keeps it.
//
// The texture is generated in code (value noise + grit speckle on a canvas)
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
  const octaves = [octave(4), octave(8), octave(16), octave(32)]
  const weights = [0.45, 0.28, 0.17, 0.1]
  const image = ctx.createImageData(size, size)
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const u = px / size, v = py / size
      let n = 0
      for (let i = 0; i < octaves.length; i++) n += octaves[i](u, v) * weights[i]
      const grit = (Math.random() - 0.5) * 0.12
      const shade = 0.78 + (n - 0.5) * 0.45 + grit
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
  // One texture tile ~ 1/6 of the model's radius: fine grain up close,
  // without obvious repetition at whole-building zoom.
  const tile = Math.max(modelRadius / 6, 1)
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
