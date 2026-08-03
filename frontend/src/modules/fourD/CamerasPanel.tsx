import { useState } from 'react'
import type { Camera, CameraPose } from './cameras'
import type { ElementKeyframe } from './elementKeyframes'
import { ResettableNumberInput } from './ResettableNumberInput'
import { formatTimelineValue, type TimeDisplayMode } from './timelinePlayback'

// Same bundled shape AnimationActorsList.tsx/PathsPanel.tsx already pass
// themselves (2026-08-03, per Maro: "keyframes are showing dates on the
// panel when i've changed to secs") — so this panel's own keyframe-date
// list reads in whichever of Date/Seconds/Frames the Animation Timeline's
// own toolbar toggle is set to, instead of always an absolute calendar
// string regardless of that setting.
interface DisplayFormat {
  scheduleStart: Date
  timeDisplayMode: TimeDisplayMode
  speedDaysPerSecond: number
  fps: number
}

interface Props {
  cameras: Camera[]
  activeCameraId: string | null
  error: string | null
  // All project keyframes, same full list Viewport3D.tsx's own timeline
  // playback already receives — filtered down to this camera's own
  // (source_kind="camera", element_ref=camera.id) rows below, per camera.
  elementKeyframes: ElementKeyframe[]
  // null until a schedule/keyframe-derived timeline range actually exists
  // (TimelineWindow.tsx's own "no dated activities yet" empty state) — the
  // keyframe list falls back to a raw ISO date string in that case, same
  // "can't express seconds/frames without a start date" limit every other
  // consumer of this shape already has.
  format: DisplayFormat | null
  onLookThrough: (camera: Camera) => void
  onExitLookThrough: () => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  onUpdateBase: (id: string, patch: Partial<CameraPose>) => void
  onDeleteKeyframeDate: (cameraId: string, dateIso: string) => void
  // Keyframe-click-to-seek (2026-08-03, per Maro: "clicking it doesnt take
  // me to the time/frame") — moves the Animation Timeline's own scrubber to
  // a keyframe's date, same as clicking its diamond marker there would.
  onSeekTo: (date: Date) => void
}

function LensField({ label, value, defaultValue, suffix, onChange }: {
  label: string; value: number; defaultValue: number; suffix: string; onChange: (v: number) => void
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs text-gray-600 dark:text-prosota-muted">
      <span>{label}</span>
      <span className="flex items-center gap-1">
        <ResettableNumberInput
          value={value}
          defaultValue={defaultValue}
          onChange={onChange}
          className="w-16 text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5 text-right"
        />
        <span className="w-6 text-[10px] text-gray-400 dark:text-prosota-muted shrink-0">{suffix}</span>
      </span>
    </label>
  )
}

// Distinct keyframed dates for this camera — grouped across all 9 of its
// own fields (pos_x/y/z, target_x/y/z, focal_length, clip_start,
// clip_end), since "Add Keyframe" (Viewport3D.tsx's own passepartout
// toolbar, next to Exit Camera View) always keys every field together at
// once, matching Blender's own "I > Location, Rotation & Scale" all-at-
// once convention rather than 9 separate per-field dots.
function keyframeDatesFor(keyframes: ElementKeyframe[], cameraId: string): string[] {
  const dates = new Set(
    keyframes.filter(k => k.source_kind === 'camera' && k.element_ref === cameraId).map(k => k.date)
  )
  return [...dates].sort()
}

function Item({ camera, active, keyframes, format, onLookThrough, onExitLookThrough, onRename, onDelete, onUpdateBase, onDeleteKeyframeDate, onSeekTo }: {
  camera: Camera
  active: boolean
  keyframes: ElementKeyframe[]
  format: DisplayFormat | null
  onLookThrough: () => void
  onExitLookThrough: () => void
  onRename: (name: string) => void
  onDelete: () => void
  onUpdateBase: (patch: Partial<CameraPose>) => void
  onDeleteKeyframeDate: (dateIso: string) => void
  onSeekTo: (date: Date) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(camera.name)
  const [expanded, setExpanded] = useState(false)

  const commitRename = () => {
    setEditing(false)
    const trimmed = draftName.trim()
    if (trimmed && trimmed !== camera.name) onRename(trimmed)
    else setDraftName(camera.name)
  }

  const dates = keyframeDatesFor(keyframes, camera.id)

  return (
    <div className={active ? 'bg-amber-50 dark:bg-amber-500/10' : ''}>
      <div className="flex items-center gap-1.5 px-3 py-2">
        <button
          onClick={() => setExpanded(v => !v)}
          title={expanded ? 'Collapse' : 'Expand — lens settings and keyframes'}
          className="text-xs text-gray-400 dark:text-prosota-muted w-3 shrink-0"
        >
          {expanded ? '▾' : '▸'}
        </button>
        <button
          onClick={active ? onExitLookThrough : onLookThrough}
          title={active ? 'Looking through this camera — click to exit back to free orbit' : 'Look through this camera'}
          className={`shrink-0 text-xs ${active ? 'text-amber-600 dark:text-amber-400' : 'text-gray-300 dark:text-prosota-line hover:text-gray-500 dark:hover:text-prosota-muted'}`}
        >
          👁
        </button>
        {editing ? (
          <input
            autoFocus
            value={draftName}
            onChange={e => setDraftName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={e => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') { setDraftName(camera.name); setEditing(false) }
            }}
            className="flex-1 text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1 py-0.5 min-w-0"
          />
        ) : (
          <span
            onDoubleClick={() => setEditing(true)}
            className="flex-1 text-xs text-gray-700 dark:text-prosota-muted truncate cursor-default"
            title="Double-click to rename"
          >
            {camera.name}
          </span>
        )}
        <button onClick={onDelete} title="Delete" className="text-xs text-gray-400 dark:text-prosota-muted hover:text-red-600 dark:hover:text-red-400 shrink-0">✕</button>
      </div>
      {expanded && (
        <div className="px-3 pb-3 pl-8 space-y-2">
          <LensField
            label="Focal Length" suffix="mm"
            value={camera.base_focal_length} defaultValue={50}
            onChange={v => onUpdateBase({ base_focal_length: v })}
          />
          <LensField
            label="Clip Start" suffix="m"
            value={camera.base_clip_start} defaultValue={0.1}
            onChange={v => onUpdateBase({ base_clip_start: v })}
          />
          <LensField
            label="Clip End" suffix="m"
            value={camera.base_clip_end} defaultValue={10000}
            onChange={v => onUpdateBase({ base_clip_end: v })}
          />
          <div className="pt-1">
            <div className="text-[10px] font-semibold text-gray-400 dark:text-prosota-muted uppercase tracking-wide mb-1">Keyframes</div>
            {dates.length === 0 ? (
              <p className="text-[11px] text-gray-400 dark:text-prosota-muted">
                {active ? 'Frame a shot, then click "🔑 Add Keyframe" above the viewport.' : 'Look through this camera to add keyframes.'}
              </p>
            ) : (
              <ul className="space-y-0.5">
                {dates.map(dateIso => (
                  <li key={dateIso} className="flex items-center justify-between text-[11px] text-gray-600 dark:text-prosota-muted">
                    <button
                      onClick={() => onSeekTo(new Date(dateIso))}
                      title="Jump the timeline to this keyframe"
                      className="hover:text-sky-600 dark:hover:text-prosota-cyan text-left"
                    >
                      {format
                        ? formatTimelineValue(new Date(dateIso), format.scheduleStart, format.timeDisplayMode, format.speedDaysPerSecond, format.fps)
                        : new Date(dateIso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                    </button>
                    <button onClick={() => onDeleteKeyframeDate(dateIso)} title="Delete this keyframe" className="text-gray-400 dark:text-prosota-muted hover:text-red-600 dark:hover:text-red-400">✕</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// "Cameras" tab of the right-side dockable panel (2026-08-03, per Maro:
// "add separate cameras and play the animation and see the transitions")
// — a Blender-style cinematic camera list, structurally mirroring
// CameraViewPanel.tsx's own list (add/rename/delete), extended with a
// "look through" toggle per row instead of one-shot "jump to" apply: a
// Camera is a real, keyframeable actor the viewport can lock onto, not a
// bookmark you jump to once (see camera.py's own docstring on how the two
// features differ).
//
// No "Add Camera" button *here*, same reasoning CameraViewPanel.tsx's own
// header comment gives for "Save Current" — it needs direct access to the
// live camera/controls refs, which only Viewport3D.tsx's own toolbar
// holds ("+ Camera", next to "Save View"). "Add Keyframe" is the same
// story, one level further in — it needs the live camera/controls too,
// so it lives in the passepartout overlay itself (only shown while
// looking through a camera, right next to "Exit Camera View"), not here.
export function CamerasPanel({ cameras, activeCameraId, error, elementKeyframes, format, onLookThrough, onExitLookThrough, onRename, onDelete, onUpdateBase, onDeleteKeyframeDate, onSeekTo }: Props) {
  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      <div className="px-3 py-2 border-b border-gray-100 dark:border-prosota-line sticky top-0 bg-white dark:bg-prosota-panel">
        <span className="text-xs text-gray-500 dark:text-prosota-muted">Cameras</span>
      </div>
      {error && <p className="px-3 py-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      {cameras.length === 0 ? (
        <p className="px-3 py-3 text-xs text-gray-400 dark:text-prosota-muted">
          Line up the shot you want in the viewport, then click "+ Camera" in the toolbar above it to create a named camera from it — click 👁 on any camera here to look through it.
        </p>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-prosota-line">
          {cameras.map(camera => (
            <Item
              key={camera.id}
              camera={camera}
              active={camera.id === activeCameraId}
              keyframes={elementKeyframes}
              format={format}
              onLookThrough={() => onLookThrough(camera)}
              onExitLookThrough={onExitLookThrough}
              onRename={name => onRename(camera.id, name)}
              onDelete={() => onDelete(camera.id)}
              onUpdateBase={patch => onUpdateBase(camera.id, patch)}
              onDeleteKeyframeDate={dateIso => onDeleteKeyframeDate(camera.id, dateIso)}
              onSeekTo={onSeekTo}
            />
          ))}
        </div>
      )}
    </div>
  )
}
