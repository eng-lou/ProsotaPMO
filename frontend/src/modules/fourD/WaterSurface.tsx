import { useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { markRenderActivity } from './IdleRenderDriver'
export const waterTime = { value: 0 }
export const waterOptions = { value: new THREE.Vector4(1, 0.45, 0.25, 1) }
export const waterColour = { value: new THREE.Color('#236b73') }
export const waterExportTime: { current: number | null } = { current: null }
const defaults = { speed: 1, strength: 0.45, turbidity: 0.25, scale: 1, colour: '#236b73' }
function load() {
  try {
    const s = JSON.parse(localStorage.getItem('prosota-water-surface') || '{}')
    return { speed: Math.max(0, Math.min(4, Number(s.speed ?? 1) || 0)), strength: Math.max(0, Math.min(1, Number(s.strength ?? .45) || 0)), turbidity: Math.max(0, Math.min(1, Number(s.turbidity ?? .25) || 0)), scale: Math.max(.1, Math.min(5, Number(s.scale ?? 1) || 1)), colour: /^#[0-9a-f]{6}$/i.test(s.colour) ? s.colour : defaults.colour }
  } catch { return defaults }
}
function apply(s: typeof defaults) { waterOptions.value.set(s.speed, s.strength, s.turbidity, s.scale); waterColour.value.set(s.colour); markRenderActivity() }
apply(load())
export function WaterSurfaceControls() {
  const [value, setValue] = useState(load)
  const change = (next: typeof defaults) => { setValue(next); apply(next); try { localStorage.setItem('prosota-water-surface', JSON.stringify(next)) } catch {} }
  return <details className="text-xs border rounded p-2"><summary className="cursor-pointer">Water surface settings</summary>
    <p className="my-2">Apply the Water finish below. These settings affect all water surfaces on this device.</p>
    {(['speed', 'strength', 'turbidity', 'scale'] as const).map(key => <label className="block my-2 capitalize" key={key}>{key === 'strength' ? 'Ripple strength' : key === 'scale' ? 'Ripple scale (m)' : key} · {value[key].toFixed(2)}<input aria-label={`Water ${key}`} className="w-full" type="range" min={key === 'scale' ? .1 : 0} max={key === 'speed' ? 4 : key === 'scale' ? 5 : 1} step=".05" value={value[key]} onChange={e => change({ ...value, [key]: Number(e.target.value) })} /></label>)}
    <label>Water colour <input aria-label="Water colour" type="color" value={value.colour} onChange={e => change({ ...value, colour: e.target.value })} /></label>
    <button className="ml-3 underline" onClick={() => change(defaults)}>Reset water</button>
  </details>
}
export function WaterSurfaceDriver() {
  const scene = useThree(s => s.scene)
  const scan = useRef({ at: -Infinity, found: false })
  useFrame(() => {
    // Check only rendered water variants; unrelated realistic materials can idle.
    if (performance.now() - scan.current.at > 1000) {
    scan.current.at = performance.now()
    scan.current.found = false
    scene.traverse(o => {
      const m = (o as THREE.Mesh).material
      if (!m || !o.visible) return
      for (const material of Array.isArray(m) ? m : [m]) {
        const u = material.userData.realisticUniforms
        if (u?.realClass?.value === 14) scan.current.found = true
        const data = u?.realClassTex?.value?.image?.data
        if (data && !scan.current.found) for (let i = 0; i < data.length; i += 4) if (data[i] === 14) { scan.current.found = true; break }
      }
    })
    }
    waterTime.value = waterExportTime.current ?? performance.now() / 1000
    if (scan.current.found && waterOptions.value.x > 0) markRenderActivity()
  }, -90)
  return null
}
