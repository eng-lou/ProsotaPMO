import { useRef, useState } from 'react'
import { ColorPickerPopover } from '@/components/ColorPickerPopover'
import type { SiteIllumination, SiteItem } from './siteScene'

const types = { point: 'Point', sun: 'Sun', spot: 'Spot', area: 'Area' } as const
const brightness = { point: 100, sun: 2, spot: 300, area: 25 }
const field = 'block w-full rounded border p-1.5 bg-white dark:bg-prosota-panel2 dark:border-prosota-line'

export function defaultSiteIllumination(type: SiteIllumination['type']): SiteIllumination {
  return { type, intensity: brightness[type], range: 30, beam_angle: 60, tilt: type === 'sun' ? 40 : 0 }
}

export function LightSettings({ item, onChange }: { item: SiteItem; onChange(patch: Partial<SiteItem>): void }) {
  const [picker, setPicker] = useState(false)
  const swatch = useRef<HTMLButtonElement>(null)
  const light = item.illumination!
  const change = (patch: Partial<SiteIllumination>) => onChange({ illumination: { ...light, ...patch } })
  function number(label: string, value: number, min: number, max: number, apply: (n: number) => void) {
    return <label>{label}<input className={field} type="number" min={min} max={max} step="any" value={value}
      onChange={e => { if (e.currentTarget.validity.valid && Number.isFinite(e.target.valueAsNumber)) apply(e.target.valueAsNumber) }} /></label>
  }
  return <>
    <label>Light type<select className={field} value={light.type} onChange={e => {
      const type = e.target.value as SiteIllumination['type']
      const name = item.name === types[light.type] + ' light' ? types[type] + ' light' : item.name
      onChange({ name, illumination: { ...light, type, intensity: brightness[type] } })
    }}>{Object.entries(types).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    <div className="flex items-center gap-2">Light colour<button type="button" ref={swatch} aria-label="Light colour"
      className="h-5 w-8 rounded border" style={{ backgroundColor: item.color }} onClick={() => setPicker(!picker)} />
      {picker && <ColorPickerPopover anchor={swatch.current} value={item.color} onChange={color => onChange({ color })}
        onClose={() => setPicker(false)} />}
    </div>
    <div className="grid grid-cols-2 gap-2">
      {number('Brightness', light.intensity, 0, 100000, intensity => change({ intensity }))}
      {(light.type === 'point' || light.type === 'spot') && number('Range (m)', light.range, .01, 10000, range => change({ range }))}
      {light.type === 'spot' && number('Beam width (°)', light.beam_angle, 1, 179, beam_angle => change({ beam_angle }))}
      {light.type !== 'point' && <>
        {number('Tilt from down (°)', light.tilt, 0, 180, tilt => change({ tilt }))}
        {number('Heading (°)', item.yaw, -360, 360, yaw => onChange({ yaw }))}
      </>}
      {light.type === 'area' && <>
        {number('Emitter width (m)', item.width, .01, 1000, width => onChange({ width }))}
        {number('Emitter height (m)', item.depth, .01, 1000, depth => onChange({ depth }))}
      </>}
    </div>
    <p>Click a surface to place the source 3 m above it. Use Exact position or Move to align it with a fixture.</p>
  </>
}
