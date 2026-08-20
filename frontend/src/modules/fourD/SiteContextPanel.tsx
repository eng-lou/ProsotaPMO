import { useState } from 'react'
import type { SiteContext } from './siteContext'

type SiteContextPatch = Partial<Pick<SiteContext,
  'enabled' | 'lat' | 'lon' | 'label' | 'offset_x' | 'offset_y' | 'offset_z' | 'offset_yaw_deg' | 'scale'
>>

interface Props {
  ctx: SiteContext
  error: string | null
  apiKey: string | null
  onUpdate: (patch: SiteContextPatch) => void
  onSaveApiKey: (key: string) => Promise<void>
}

// "Site Context" dockable panel — real-world Google Photorealistic 3D
// Tiles embedded in the main viewport (SiteTilesLayer.tsx). Same "single
// settings form, no create/delete/rename" shape as TimelineStripPanel.tsx
// (site_context.py's own docstring explains why: a project only ever has
// one real-world location).
//
// Numeric fields here are deliberately plain typed inputs, not a drag
// gizmo (2026-08-19, per the plan agreed with Maro) — a lower-risk v1
// than wiring the existing Move gizmo to a layer that isn't an "imported
// object." Worth revisiting only if nudging numbers turns out too fiddly
// in practice.
export function SiteContextPanel({ ctx, error, apiKey, onUpdate, onSaveApiKey }: Props) {
  const [keyDraft, setKeyDraft] = useState(apiKey ?? '')
  const [savingKey, setSavingKey] = useState(false)

  const handleSaveKey = async () => {
    setSavingKey(true)
    try {
      await onSaveApiKey(keyDraft.trim())
    } finally {
      setSavingKey(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      <div className="px-3 py-2 border-b border-gray-100 dark:border-prosota-line sticky top-0 bg-white dark:bg-prosota-panel">
        <span className="text-xs text-gray-500 dark:text-prosota-muted">Site Context</span>
      </div>
      {error && <p className="px-3 py-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

      <div className="px-3 py-2 space-y-1.5">
        <div className="space-y-1 bg-gray-50 dark:bg-prosota-panel2 border border-gray-100 dark:border-prosota-line rounded px-2 py-1.5">
          <label className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-prosota-muted">
            <span className="w-20 shrink-0">API Key</span>
            <input
              type="password" placeholder="AIza…" value={keyDraft}
              onChange={e => setKeyDraft(e.target.value)}
              autoComplete="off"
              className="flex-1 w-0 border border-gray-200 dark:border-prosota-line rounded px-1.5 py-0.5"
            />
          </label>
          <div className="flex items-center gap-2 pl-[86px]">
            <button
              onClick={handleSaveKey}
              disabled={savingKey || keyDraft === apiKey}
              className="text-[11px] px-2 py-0.5 rounded bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {savingKey ? 'Saving…' : 'Save Key'}
            </button>
            {apiKey && <span className="text-[11px] text-gray-400 dark:text-prosota-muted">configured ✓</span>}
          </div>
        </div>

        <label className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-prosota-muted">
          <input type="checkbox" checked={ctx.enabled} onChange={e => onUpdate({ enabled: e.target.checked })} />
          Show Google Tiles
        </label>
        {ctx.enabled && !apiKey && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400">No Google Maps API key configured yet.</p>
        )}

        <div className="space-y-1 bg-gray-50 dark:bg-prosota-panel2 border border-gray-100 dark:border-prosota-line rounded px-2 py-1.5">
          <label className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-prosota-muted">
            <span className="w-20 shrink-0">Label</span>
            <input
              type="text" placeholder="Site boundary" value={ctx.label ?? ''}
              onChange={e => onUpdate({ label: e.target.value === '' ? null : e.target.value })}
              className="flex-1 w-0 border border-gray-200 dark:border-prosota-line rounded px-1.5 py-0.5"
            />
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-prosota-muted">
            <span className="w-20 shrink-0">Latitude</span>
            <input
              type="number" step="any" value={ctx.lat ?? ''}
              onChange={e => onUpdate({ lat: e.target.value === '' ? null : Number(e.target.value) })}
              className="flex-1 w-0 border border-gray-200 dark:border-prosota-line rounded px-1.5 py-0.5"
            />
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-prosota-muted">
            <span className="w-20 shrink-0">Longitude</span>
            <input
              type="number" step="any" value={ctx.lon ?? ''}
              onChange={e => onUpdate({ lon: e.target.value === '' ? null : Number(e.target.value) })}
              className="flex-1 w-0 border border-gray-200 dark:border-prosota-line rounded px-1.5 py-0.5"
            />
          </label>
        </div>

        <p className="text-[11px] text-gray-400 dark:text-prosota-muted">
          The tiles land near the model automatically; nudge these until they line up.
        </p>
        <div className="space-y-1 bg-gray-50 dark:bg-prosota-panel2 border border-gray-100 dark:border-prosota-line rounded px-2 py-1.5">
          {(['offset_x', 'offset_y', 'offset_z'] as const).map((field, i) => (
            <label key={field} className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-prosota-muted">
              <span className="w-20 shrink-0">Offset {['X', 'Y', 'Z'][i]}</span>
              <input
                type="number" step={0.5} value={ctx[field]}
                onChange={e => onUpdate({ [field]: Number(e.target.value) } as SiteContextPatch)}
                className="flex-1 w-0 border border-gray-200 dark:border-prosota-line rounded px-1.5 py-0.5"
              />
            </label>
          ))}
          <label className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-prosota-muted">
            <span className="w-20 shrink-0">Rotation</span>
            <input
              type="number" step={1} value={ctx.offset_yaw_deg}
              onChange={e => onUpdate({ offset_yaw_deg: Number(e.target.value) })}
              className="flex-1 w-0 border border-gray-200 dark:border-prosota-line rounded px-1.5 py-0.5"
            />
            <span className="text-gray-400 dark:text-prosota-muted">°</span>
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-prosota-muted">
            <span className="w-20 shrink-0">Scale</span>
            <input
              type="number" step={0.01} min={0.01} value={ctx.scale}
              onChange={e => onUpdate({ scale: Number(e.target.value) })}
              className="flex-1 w-0 border border-gray-200 dark:border-prosota-line rounded px-1.5 py-0.5"
            />
          </label>
        </div>
      </div>
    </div>
  )
}
