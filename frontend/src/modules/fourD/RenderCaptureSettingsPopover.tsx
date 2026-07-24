import { useState } from 'react'
import type { RenderCaptureSettings } from './renderCaptureSettings'

interface Props {
  settings: RenderCaptureSettings
  onChange: (settings: RenderCaptureSettings) => void
  // Include Baseline (2026-07-24) — the checkbox stays visible either way
  // (so the setting itself still persists/toggles normally) but reads as
  // disabled while Compare Baseline isn't open, since there's no second
  // pane to composite in that state.
  compareBaselineOpen: boolean
}

// Small gear-triggered popover for Capture/Export Video's own render
// settings (2026-07-11, per Maro: "give me the option to show hdr
// background when rendering/capturing", then "implement the others also"
// for resolution/duration/frame rate) — sits in Viewport3D.tsx's own
// toolbar next to Capture/Export Video. Not a blocking confirmation (this
// app's existing dialogs — ImportModelDialog.tsx/UnloadModelDialog.tsx —
// are modal, centred, backdrop-dimmed, because they demand a decision
// before continuing); this is a dismissible settings panel the rest of the
// app stays fully usable around, so it's an anchored dropdown instead — a
// full-screen invisible button behind it (lower z-index than the popover,
// higher than everything else) catches an outside click to close it,
// rather than a focus-trap library.
export function RenderCaptureSettingsPopover({ settings, onChange, compareBaselineOpen }: Props) {
  const [open, setOpen] = useState(false)
  const set = <K extends keyof RenderCaptureSettings>(key: K, value: RenderCaptureSettings[K]) =>
    onChange({ ...settings, [key]: value })

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        title="Render / Capture Settings"
        className={`text-xs px-2 py-1 rounded-md border shadow-sm ${
          open ? 'bg-gray-900 text-white border-gray-900' : 'bg-white/90 text-gray-600 border-gray-300 hover:bg-gray-50'
        }`}
      >
        ⚙
      </button>
      {open && (
        <>
          <button
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
            tabIndex={-1}
            aria-label="Close render/capture settings"
          />
          <div className="absolute top-full left-0 mt-1 z-20 w-56 bg-white border border-gray-300 rounded-md shadow-lg p-2.5 space-y-2.5">
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Render / Capture</div>

            <label className="flex items-center gap-1.5 text-xs text-gray-600" title="Overrides the live viewport's own HDR Background setting just for a capture/export, then reverts">
              <input
                type="checkbox"
                checked={settings.showHdrBackground}
                onChange={e => set('showHdrBackground', e.target.checked)}
              />
              Show HDR Background
            </label>

            <div className="flex items-center justify-between gap-2 text-xs text-gray-600">
              <span title="Renders at a higher internal resolution before downsampling — a sharper still/video at some extra GPU cost">Resolution</span>
              <select
                value={settings.resolutionMultiplier}
                onChange={e => set('resolutionMultiplier', Number(e.target.value) as RenderCaptureSettings['resolutionMultiplier'])}
                className="text-xs border border-gray-300 rounded px-1 py-0.5"
              >
                <option value={1}>1×</option>
                <option value={2}>2×</option>
                <option value={4}>4×</option>
              </select>
            </div>

            <label
              className={`flex items-center gap-1.5 text-xs ${compareBaselineOpen ? 'text-gray-600' : 'text-gray-300'}`}
              title={compareBaselineOpen
                ? 'Composites the Baseline (planned) pane alongside the main viewport in the captured PNG/webm, side by side'
                : 'Open Compare Baseline first — no second pane to include yet'}
            >
              <input
                type="checkbox"
                checked={settings.includeBaseline}
                disabled={!compareBaselineOpen}
                onChange={e => set('includeBaseline', e.target.checked)}
              />
              Include Baseline (side by side)
            </label>

            <div className="border-t border-gray-100 pt-2.5 space-y-2.5">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Export Content</div>
              <label className="flex items-center gap-1.5 text-xs text-gray-600" title="Adds a compact Gantt bar strip across the top of the capture/export, showing the currently-relevant activities and a moving 'now' line">
                <input
                  type="checkbox"
                  checked={settings.includeGanttChart}
                  onChange={e => set('includeGanttChart', e.target.checked)}
                />
                Gantt Chart (top)
              </label>
              <label className="flex items-center gap-1.5 text-xs text-gray-600" title="Adds an Activity Table column down the left of the capture/export — Code/Name/Finish, highlighting whichever activities are currently active">
                <input
                  type="checkbox"
                  checked={settings.includeActivityTable}
                  onChange={e => set('includeActivityTable', e.target.checked)}
                />
                Activity Table (left)
              </label>
              <label className="flex items-center gap-1.5 text-xs text-gray-600" title="Adds an Appearance Profile legend (colour swatch + name) over the 3D view — draws nothing if the project has no animation profiles set up">
                <input
                  type="checkbox"
                  checked={settings.includeAppearanceLegend}
                  onChange={e => set('includeAppearanceLegend', e.target.checked)}
                />
                Appearance Legend
              </label>
              <label className="flex items-center gap-1.5 text-xs text-gray-600" title="Burns in the current date and elapsed week count over the 3D view">
                <input
                  type="checkbox"
                  checked={settings.includeDateOverlay}
                  onChange={e => set('includeDateOverlay', e.target.checked)}
                />
                Date Overlay
              </label>
            </div>

            <div className="border-t border-gray-100 pt-2.5 space-y-2.5">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Export Video</div>
              <label className="flex items-center justify-between gap-2 text-xs text-gray-600">
                <span>Duration (sec)</span>
                <input
                  type="number"
                  min={1}
                  max={120}
                  step={1}
                  value={settings.videoDurationSec}
                  onChange={e => set('videoDurationSec', Math.max(1, Math.round(Number(e.target.value)) || 1))}
                  className="w-14 text-xs border border-gray-300 rounded px-1 py-0.5 text-right"
                />
              </label>
              <label className="flex items-center justify-between gap-2 text-xs text-gray-600">
                <span>Frame Rate</span>
                <select
                  value={settings.videoFps}
                  onChange={e => set('videoFps', Number(e.target.value))}
                  className="text-xs border border-gray-300 rounded px-1 py-0.5"
                >
                  <option value={24}>24 fps</option>
                  <option value={30}>30 fps</option>
                  <option value={60}>60 fps</option>
                </select>
              </label>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
