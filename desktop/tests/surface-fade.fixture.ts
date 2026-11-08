import * as THREE from 'three'
import { applyFootprintEdges } from '../../frontend/src/modules/fourD/footprintEdges'
import { getRealisticVariant, syncRealisticVariant } from '../../frontend/src/modules/fourD/realisticMaterials'

export function measure() {
  const renderer = new THREE.WebGLRenderer({
    alpha: true, antialias: true, preserveDrawingBuffer: true, logarithmicDepthBuffer: true,
  })
  const width = 400, height = 240
  renderer.setSize(width, height)
  renderer.setClearColor(0, 0)
  const camera = new THREE.OrthographicCamera(-5, 5, 3, -3, 0.01, 300)
  camera.position.z = 10
  const scene = new THREE.Scene()
  const soil = new THREE.Mesh(new THREE.PlaneGeometry(10, 6), new THREE.MeshBasicMaterial({ color: 0x4c3829 }))
  const source = new THREE.MeshStandardMaterial({ color: 0x84785f })
  const gravel = new THREE.Mesh(new THREE.PlaneGeometry(8, 4), getRealisticVariant(source, 22, source.color.clone(), false))
  gravel.position.z = 0.1
  scene.add(soil, gravel, new THREE.HemisphereLight(0xffffff, 0xffffff, 2))

  function frame() {
    renderer.render(scene, camera)
    const gl = renderer.getContext()
    const pixels = new Uint8Array(width * height * 4)
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    return pixels
  }

  const results = []
  for (const selected of [false, true]) {
    source.emissive.setRGB(selected ? 0.14 : 0, selected ? 0.14 : 0, selected ? 0.7 : 0)
    syncRealisticVariant(source)
    soil.visible = true
    gravel.visible = false
    const background = frame()
    gravel.visible = true
    applyFootprintEdges(gravel.material, { fade: 0, radius: 0 })
    const foreground = frame()
    applyFootprintEdges(gravel.material, { fade: 2.6, radius: 0 })
    const blended = frame()
    soil.visible = false
    const empty = frame()

    let backgroundLeaks = 0, maxChannelError = 0
    const levels = new Set<number>()
    for (let i = 0; i < blended.length; i += 4) {
      if (blended[i + 3] !== 255) backgroundLeaks++
      const alpha = empty[i + 3] / 255
      if (alpha <= 0.01 || alpha >= 0.99) continue
      levels.add(empty[i + 3])
      for (let channel = i; channel < i + 3; channel++) {
        const expected = foreground[channel] * alpha + background[channel] * (1 - alpha)
        maxChannelError = Math.max(maxChannelError, Math.abs(blended[channel] - expected))
      }
    }
    results.push({ selected, backgroundLeaks, transitionLevels: levels.size, maxChannelError,
      centreAlpha: empty[(120 * width + 200) * 4 + 3], outsideAlpha: empty[(120 * width + 10) * 4 + 3] })
  }
  renderer.dispose()
  return results
}
