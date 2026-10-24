import { useState } from 'react'
export const overlayLabels = { helpers: 'Editing handles / section boxes', cameras: 'Camera icons / guides', paths: 'Paths', zones: 'Zones', annotations: 'Notations / callouts', measurements: 'Measurements', grid: 'Grid / axes' } as const
export type OverlayFlags = Record<keyof typeof overlayLabels, boolean>
export type OverlaySettings = { app: OverlayFlags; render: OverlayFlags }
const all = (value: boolean): OverlayFlags => Object.fromEntries(Object.keys(overlayLabels).map(k => [k, value])) as OverlayFlags
export function loadOverlays(): OverlaySettings {
  const defaults = { app: all(true), render: { ...all(true), helpers: false, cameras: false, grid: false } }
  try {
    const saved = JSON.parse(localStorage.getItem('prosota-scene-overlays') || '{}')
    for (const mode of ['app', 'render'] as const) for (const key of Object.keys(overlayLabels) as (keyof OverlayFlags)[])
      if (typeof saved[mode]?.[key] === 'boolean') defaults[mode][key] = saved[mode][key]
  } catch { /* use defaults */ }
  return defaults
}
export function SceneOverlays({ value, onChange, disabled }: { value: OverlaySettings; onChange: (value: OverlaySettings) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false)
  return <div className="relative">
    <button className="text-xs px-2 py-1 rounded-md border bg-white/90 text-gray-600" disabled={disabled} onClick={() => setOpen(!open)}>Overlays</button>
    {open && <div role="dialog" aria-label="Scene overlays" className="absolute right-0 top-full mt-1 z-50 w-80 rounded border bg-white dark:bg-prosota-panel dark:text-prosota-paper shadow-lg p-3 text-xs">
      <div className="flex justify-between mb-2"><strong>Scene overlays</strong><button onClick={() => setOpen(false)}>Close</button></div>
      <div className="grid grid-cols-[1fr_50px_55px] gap-2 items-center">
        <span></span><strong>App</strong><strong>Render</strong>
        {(['all', ...Object.keys(overlayLabels)] as ('all' | keyof OverlayFlags)[]).map(key => <div className="contents" key={key}>
          <span>{key === 'all' ? 'All overlays' : overlayLabels[key]}</span>
          {(['app', 'render'] as const).map(mode => <input key={mode} type="checkbox" aria-label={`${mode} ${key}`} checked={key === 'all' ? Object.values(value[mode]).every(Boolean) : value[mode][key]} onChange={e => onChange({ ...value, [mode]: key === 'all' ? all(e.target.checked) : { ...value[mode], [key]: e.target.checked } })} />)}
        </div>)}
      </div>
      <p className="mt-3 text-gray-500">Render applies to captured images and exported videos. Hiding paths keeps bound objects moving.</p>
    </div>}
  </div>
}
