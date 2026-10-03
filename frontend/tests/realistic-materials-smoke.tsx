// Local, synthetic WebGL fixture. No backend or production writes.
import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import * as THREE from 'three'
import { RealisticMaterialsPanel } from '../src/modules/fourD/RealisticMaterialsPanel'
import { applyRealisticToBatch, classIndexForKey, getRealisticVariant, textureSettingsForKey,
  type RealisticMaterialMap, type RealisticModelInfo } from '../src/modules/fourD/realisticMaterials'
import type { BatchState } from '../src/modules/fourD/elementBatching'
import '../src/index.css'

const entries = [
  ['concrete', 'Cast concrete'], ['render', 'Smooth render'], ['metal', 'Exposed metal'],
  ['painted-metal', 'Coated metal'], ['brick', 'Brick: individual'], ['brick-batch', 'Brick: IFC batch'],
].map(([key, label]) => ({ key, label, detail: '', autoClass: (key === 'brick-batch' ? 'brick' : key) as any, candidates: [], count: 1 }))
const info: RealisticModelInfo = { entries: new Map(entries.map(e => [e.key, e])), keyByPiece: new Map([['1:1', 'brick-batch']]), keyByExpressId: new Map([[1, 'brick-batch']]) }

function Demo() {
  const mount = useRef<HTMLDivElement>(null)
  const [mapping, setMapping] = useState<RealisticMaterialMap>({})
  const [result, setResult] = useState('Compiling shaders…')
  useEffect(() => {
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    renderer.setSize(900, 500)
    renderer.setPixelRatio(1)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    mount.current!.replaceChildren(renderer.domElement)
    const failures: string[] = []
    renderer.debug.onShaderError = (gl, program) => { failures.push(gl.getProgramInfoLog(program) ?? 'Shader failed') }
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#dae1e8')
    scene.add(new THREE.HemisphereLight(0xffffff, 0x777766, 2))
    const sun = new THREE.DirectionalLight(0xffffff, 4)
    sun.position.set(2, 4, 5)
    scene.add(sun)
    const camera = new THREE.PerspectiveCamera(35, 900 / 500, 0.1, 100)
    camera.position.set(0, 0, 10)
    const geometry = new THREE.BoxGeometry(1.5, 1.5, 0.3)
    const sources: THREE.MeshStandardMaterial[] = []
    const materials: THREE.Material[] = []
    let batch: BatchState | undefined
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      const source = new THREE.MeshStandardMaterial({ color: i < 4 ? '#a9a29b' : '#ffffff' })
      sources.push(source)
      let mesh: THREE.Mesh
      if (i === 5) {
        const batched = new THREE.BatchedMesh(1, 100, 200, source)
        const geometryId = batched.addGeometry(geometry)
        const instanceId = batched.addInstance(geometryId)
        batched.setColorAt(instanceId, new THREE.Color('white'))
        batch = { mesh: batched, byExpressId: new Map([[1, [{ instanceId, geometryId, ifcGeometryId: 1, colorAlpha: 1, color: new THREE.Color('white'), matrix: new THREE.Matrix4() }]]]), geometryById: new Map([[geometryId, geometry]]) } as BatchState
        mesh = batched
        mesh.material = applyRealisticToBatch(batch, source, info, mapping, false, false, false)
      } else {
        const material = getRealisticVariant(source, classIndexForKey(entry.key, info, mapping), source.color.clone(), false, 1, null, textureSettingsForKey(entry.key, mapping))
        mesh = new THREE.Mesh(geometry, material)
      }
      materials.push(mesh.material as THREE.Material)
      mesh.position.set((i % 3 - 1) * 2.1, i < 3 ? 1 : -1, 0)
      mesh.rotation.y = 0.18
      scene.add(mesh)
    }
    renderer.render(scene, camera)
    const gl = renderer.getContext()
    const pixels = new Uint8Array(900 * 500 * 4)
    gl.readPixels(0, 0, 900, 500, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    const colours = new Set<number>()
    for (let i = 0; i < pixels.length; i += 4) colours.add((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2])
    const data = (batch!.mesh.userData.realistic.classTexture as THREE.DataTexture).image.data
    setResult(JSON.stringify({ shaderErrors: failures, distinctColours: colours.size, drawCalls: renderer.info.render.calls,
      batchTransformBytes: Array.from(data.slice(0, 4)), pass: !failures.length && colours.size > 100 && renderer.info.render.calls === 6 }, null, 2))
    return () => {
      batch?.mesh.userData.realistic.classTexture.dispose()
      batch?.mesh.dispose()
      materials.forEach(m => m.dispose())
      sources.forEach(m => m.dispose())
      geometry.dispose()
      renderer.dispose()
    }
  }, [mapping])
  return <main className="p-4 bg-white text-gray-800">
    <h1 className="font-bold">Realistic material preview — synthetic geometry</h1>
    <p>Top: concrete · render · exposed metal. Bottom: coated metal · brick · batched IFC brick.</p>
    <div className="flex gap-4"><div><div ref={mount} /><pre id="results">{result}</pre></div>
      <div className="w-80 h-[700px] border overflow-auto"><RealisticMaterialsPanel entries={entries} mapping={mapping}
        onMappingChange={setMapping} analysing={false} entryModels={{}} onSelectEntry={() => {}}
        glassTransmission={false} onGlassTransmissionChange={() => {}} /></div></div>
  </main>
}
createRoot(document.getElementById('root')!).render(<Demo />)
