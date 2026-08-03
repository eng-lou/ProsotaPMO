import { useState } from 'react'
import { RESOLUTION_PRESETS, type ResolutionPreset, type RenderCaptureSettings } from './renderCaptureSettings'

interface Props {
  settings: RenderCaptureSettings
  onChange: (settings: RenderCaptureSettings) => void
  // Include Baseline (2026-07-24, generalized 2026-08-03 for up to 3
  // comparison panes at once — see Viewport3D.tsx's own comparisonCanvasRefs
  // header) — the checkbox stays visible either way (so the setting itself
  // still persists/toggles normally) but reads as disabled while no
  // comparison pane is open, since there's nothing to composite in that
  // state. Every currently-open pane gets composited when this is on —
  // there's no per-pane opt-out.
  comparisonPanesOpen: boolean
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
export function RenderCaptureSettingsPopover({ settings, onChange, comparisonPanesOpen }: Props) {
  const [open, setOpen] = useState(false)
  const set = <K extends keyof RenderCaptureSettings>(key: K, value: RenderCaptureSettings[K]) =>
    onChange({ ...settings, [key]: value })

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        title="Render / Capture Settings"
        className={`text-xs px-2 py-1 rounded-md border shadow-sm ${
          open ? 'bg-gray-900 text-white border-gray-900' : 'bg-white/90 text-gray-600 dark:text-prosota-muted border-gray-300 dark:border-prosota-line hover:bg-gray-50 dark:hover:bg-prosota-panel2'
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
          <div className="absolute top-full left-0 mt-1 z-20 w-56 bg-white dark:bg-prosota-panel border border-gray-300 dark:border-prosota-line rounded-md shadow-lg p-2.5 space-y-2.5">
            <div className="text-[10px] font-bold text-gray-400 dark:text-prosota-muted uppercase tracking-wide">Render / Capture</div>

            <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-prosota-muted" title="Overrides the live viewport's own HDR Background setting just for a capture/export, then reverts">
              <input
                type="checkbox"
                checked={settings.showHdrBackground}
                onChange={e => set('showHdrBackground', e.target.checked)}
              />
              Show HDR Background
            </label>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-xs text-gray-600 dark:text-prosota-muted">
                <span title="The exact output pixel dimensions for Capture/Export Video — independent of how big this browser window happens to be. If the on-screen 3D pane's own aspect ratio doesn't match, the content is cropped to fill, never stretched.">Resolution</span>
                <select
                  value={settings.resolutionPreset}
                  onChange={e => {
                    const preset = e.target.value as ResolutionPreset
                    onChange(
                      preset === 'custom'
                        ? { ...settings, resolutionPreset: preset }
                        : { ...settings, resolutionPreset: preset, resolutionWidth: RESOLUTION_PRESETS[preset].width, resolutionHeight: RESOLUTION_PRESETS[preset].height },
                    )
                  }}
                  className="text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1 py-0.5"
                >
                  {Object.entries(RESOLUTION_PRESETS).map(([key, preset]) => (
                    <option key={key} value={key}>{preset.label}</option>
                  ))}
                  <option value="custom">Custom</option>
                </select>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-prosota-muted">
                <input
                  type="number"
                  min={1}
                  value={settings.resolutionWidth}
                  onChange={e => onChange({ ...settings, resolutionWidth: Math.max(1, Math.round(Number(e.target.value)) || 1), resolutionPreset: 'custom' })}
                  className="w-16 text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1 py-0.5 text-right"
                />
                <span>×</span>
                <input
                  type="number"
                  min={1}
                  value={settings.resolutionHeight}
                  onChange={e => onChange({ ...settings, resolutionHeight: Math.max(1, Math.round(Number(e.target.value)) || 1), resolutionPreset: 'custom' })}
                  className="w-16 text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1 py-0.5 text-right"
                />
                <span>px</span>
              </div>
            </div>

            <label
              className={`flex items-center gap-1.5 text-xs ${comparisonPanesOpen ? 'text-gray-600 dark:text-prosota-muted' : 'text-gray-300 dark:text-prosota-line'}`}
              title={comparisonPanesOpen
                ? 'Composites every open comparison pane alongside the main viewport in the captured PNG/webm, side by side'
                : 'Open Compare Baseline first — no comparison pane to include yet'}
            >
              <input
                type="checkbox"
                checked={settings.includeBaseline}
                disabled={!comparisonPanesOpen}
                onChange={e => set('includeBaseline', e.target.checked)}
              />
              Include Comparison Panes (side by side)
            </label>

            <div className="border-t border-gray-100 dark:border-prosota-line pt-2.5 space-y-2.5">
              <div className="text-[10px] font-bold text-gray-400 dark:text-prosota-muted uppercase tracking-wide">Export Content</div>
              <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-prosota-muted" title="Adds a compact Gantt bar strip across the top of the capture/export, showing the currently-relevant activities and a moving 'now' line">
                <input
                  type="checkbox"
                  checked={settings.includeGanttChart}
                  onChange={e => set('includeGanttChart', e.target.checked)}
                />
                Gantt Chart (top)
              </label>
              <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-prosota-muted" title="Adds an Activity Table column down the left of the capture/export — Code/Name/Finish, highlighting whichever activities are currently active">
                <input
                  type="checkbox"
                  checked={settings.includeActivityTable}
                  onChange={e => set('includeActivityTable', e.target.checked)}
                />
                Activity Table (left)
              </label>
              <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-prosota-muted" title="Adds an Appearance Profile legend (colour swatch + name) over the 3D view — draws nothing if the project has no animation profiles set up">
                <input
                  type="checkbox"
                  checked={settings.includeAppearanceLegend}
                  onChange={e => set('includeAppearanceLegend', e.target.checked)}
                />
                Appearance Legend
              </label>
              <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-prosota-muted" title="Burns in the current date and elapsed week count over the 3D view">
                <input
                  type="checkbox"
                  checked={settings.includeDateOverlay}
                  onChange={e => set('includeDateOverlay', e.target.checked)}
                />
                Date Overlay
              </label>
              <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-prosota-muted" title="Bakes in every visible Radial Chart ring at its own dragged position — hidden rings (Radial Charts panel) stay hidden even with this on">
                <input
                  type="checkbox"
                  checked={settings.includeRadialCharts}
                  onChange={e => set('includeRadialCharts', e.target.checked)}
                />
                Radial Charts
              </label>
              <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-prosota-muted" title="Bakes in the Timeline Strip at its own dragged position if it's visible (Timeline Strip panel)">
                <input
                  type="checkbox"
                  checked={settings.includeTimelineStrip}
                  onChange={e => set('includeTimelineStrip', e.target.checked)}
                />
                Timeline Strip
              </label>
              <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-prosota-muted" title="Adds a monthly cost bar chart along the bottom — the same figures as the Resource Usage tab's own 'Cost' unit">
                <input
                  type="checkbox"
                  checked={settings.includeCostProfile}
                  onChange={e => set('includeCostProfile', e.target.checked)}
                />
                Cost Profile (bottom)
              </label>
            </div>

            <div className="border-t border-gray-100 dark:border-prosota-line pt-2.5 space-y-2.5">
              <div className="text-[10px] font-bold text-gray-400 dark:text-prosota-muted uppercase tracking-wide">View Titles</div>
              <label className="flex items-center justify-between gap-2 text-xs text-gray-600 dark:text-prosota-muted" title="Label shown over the main viewport — clear it to hide the label entirely">
                <span>Left (main)</span>
                <input
                  type="text"
                  value={settings.mainViewTitle}
                  onChange={e => set('mainViewTitle', e.target.value)}
                  className="w-24 text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5"
                />
              </label>
              <label
                className={`flex items-center justify-between gap-2 text-xs ${comparisonPanesOpen ? 'text-gray-600 dark:text-prosota-muted' : 'text-gray-300 dark:text-prosota-line'}`}
                title={comparisonPanesOpen
                  ? 'Label shown over every comparison pane — clear it to hide the label entirely'
                  : 'Only shows once Compare Baseline is open and Include Comparison Panes is on'}
              >
                <span>Right (comparison)</span>
                <input
                  type="text"
                  value={settings.baselineViewTitle}
                  disabled={!comparisonPanesOpen}
                  onChange={e => set('baselineViewTitle', e.target.value)}
                  className="w-24 text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5 disabled:bg-gray-50"
                />
              </label>
            </div>

            <div className="border-t border-gray-100 dark:border-prosota-line pt-2.5 space-y-2.5">
              <div className="text-[10px] font-bold text-gray-400 dark:text-prosota-muted uppercase tracking-wide">Title &amp; Narrative</div>
              {(() => {
                const cornerAvailable = settings.includeGanttChart && settings.includeActivityTable
                const cornerTitle = cornerAvailable
                  ? undefined
                  : 'Needs both Gantt Chart and Activity Table on — together they leave the top-left corner this fills'
                return (
                  <>
                    <label className={`flex flex-col gap-1 text-xs ${cornerAvailable ? 'text-gray-600 dark:text-prosota-muted' : 'text-gray-300 dark:text-prosota-line'}`} title={cornerTitle}>
                      <span>Project Title</span>
                      <input
                        type="text"
                        value={settings.exportTitle}
                        disabled={!cornerAvailable}
                        onChange={e => set('exportTitle', e.target.value)}
                        className="text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5 disabled:bg-gray-50"
                      />
                    </label>
                    <label className={`flex flex-col gap-1 text-xs ${cornerAvailable ? 'text-gray-600 dark:text-prosota-muted' : 'text-gray-300 dark:text-prosota-line'}`} title={cornerTitle}>
                      <span>Narrative</span>
                      <textarea
                        value={settings.exportNarrative}
                        disabled={!cornerAvailable}
                        onChange={e => set('exportNarrative', e.target.value)}
                        rows={3}
                        className="text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5 resize-none disabled:bg-gray-50"
                      />
                    </label>
                  </>
                )
              })()}
            </div>

            <div className="border-t border-gray-100 dark:border-prosota-line pt-2.5 space-y-2.5">
              <div className="text-[10px] font-bold text-gray-400 dark:text-prosota-muted uppercase tracking-wide">Export Video</div>
              <label className="flex items-center justify-between gap-2 text-xs text-gray-600 dark:text-prosota-muted">
                <span>Duration (sec)</span>
                <input
                  type="number"
                  min={1}
                  max={120}
                  step={1}
                  value={settings.videoDurationSec}
                  onChange={e => set('videoDurationSec', Math.max(1, Math.round(Number(e.target.value)) || 1))}
                  className="w-14 text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1 py-0.5 text-right"
                />
              </label>
              <label className="flex items-center justify-between gap-2 text-xs text-gray-600 dark:text-prosota-muted">
                <span>Frame Rate</span>
                <select
                  value={settings.videoFps}
                  onChange={e => set('videoFps', Number(e.target.value))}
                  className="text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1 py-0.5"
                >
                  <option value={24}>24 fps</option>
                  <option value={30}>30 fps</option>
                  <option value={60}>60 fps</option>
                </select>
              </label>
              <label className="flex items-center justify-between gap-2 text-xs text-gray-600 dark:text-prosota-muted">
                <span>Format</span>
                <select
                  value={settings.videoFormat}
                  onChange={e => set('videoFormat', e.target.value as 'mp4' | 'webm')}
                  className="text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1 py-0.5"
                  title="MP4 plays everywhere (PowerPoint, phones, social) — falls back to WebM automatically if this browser can't encode MP4"
                >
                  <option value="mp4">MP4</option>
                  <option value="webm">WebM</option>
                </select>
              </label>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
