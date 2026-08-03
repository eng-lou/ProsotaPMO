import { useState } from 'react'
import type { Path, PathLineStyle, PathPoint } from './paths'
import type { PathFollower, PathFollowerTargetKind } from './pathFollowers'
import type { UpAxis } from './upAxis'
import { formatTimelineValue, type TimeDisplayMode } from './timelinePlayback'

interface BindTarget {
  kind: Exclude<PathFollowerTargetKind, 'camera'>
  ref: string
  label: string
}

// Threaded down for the Start/End fields' own frames/seconds/date display
// (2026-07-30, per Maro: "I want frames or seconds not dates here") — same
// bundling AnimationActorsList.tsx's own DisplayFormat uses, reusing
// FourD.tsx's one shared speed/mode/fps rather than each panel owning an
// independent copy (that lifted state's own header, FourD.tsx).
interface DisplayFormat {
  scheduleStart: Date
  timeDisplayMode: TimeDisplayMode
  speedDaysPerSecond: number
  fps: number
}

interface Props {
  paths: Path[]
  error: string | null
  addingPointsForPathId: string | null
  // Needed only for the Elevation field below (2026-07-29) — to read/write
  // "up" it has to know which raw coordinate that actually is.
  upAxis: UpAxis
  bindTarget: BindTarget | null
  followers: PathFollower[]
  // Resolved anim_start/anim_end per path (2026-07-30, ElementKeyframe-
  // based — see paths.ts's own header) plus the shared display format,
  // both passed straight through to Item below for its Start/End fields
  // and Key buttons.
  animWindows: Map<string, { start: Date | null; end: Date | null }>
  format: DisplayFormat | null
  onCreate: () => void
  onRename: (id: string, name: string) => void
  onToggleClosed: (id: string) => void
  onToggleVisible: (id: string) => void
  onDelete: (id: string) => void
  onToggleAddPoints: (id: string) => void
  onRemoveLastPoint: (id: string) => void
  onBind: (pathId: string) => void
  onUnbind: (followerId: string) => void
  onToggleOrient: (followerId: string) => void
  // Heading offset (2026-08-06, per Maro: "when i hit bind it changed the
  // rotation of the car") — see FourD.tsx's own matching handler header:
  // compensates for an imported model's own authored forward axis not
  // matching three.js's lookAt convention (-Z), in degrees.
  onSetHeadingOffset: (followerId: string, headingOffsetDeg: number) => void
  onUpdateStyle: (id: string, patch: Partial<Pick<Path, 'color' | 'line_style' | 'show_arrow' | 'show_label' | 'line_width' | 'dash_size' | 'gap_size' | 'animate' | 'animation_loop'>>) => void
  // "Key" buttons (2026-07-30, per Maro: "add a key frame buttons to the
  // side. so i can key frame the start and end") — keys the *current
  // playhead* (FourD.tsx's own timelineDateRef) as this path's anim_start/
  // anim_end ElementKeyframe, replacing whichever one was there before.
  onKeyAnimStart: (id: string) => void
  onKeyAnimEnd: (id: string) => void
  // Elevation (2026-07-29, per Maro: "as a failsafe give me the elevation
  // controls like in zones", after "Trace on ground" still wasn't reliably
  // landing on a real sidewalk's own true surface — see this handler's own
  // header in FourD.tsx for the full incident). Unlike Zone's own single
  // `elevation` column, a Path has no dedicated field for this — it's a raw
  // points array, computed here as those points' own average up-coordinate
  // and written back as a uniform shift of the whole array, so a sloped
  // path's own relative shape survives a nudge, only its overall height
  // moves.
  onSetElevation: (id: string, elevation: number) => void
}

function pathElevation(points: PathPoint[], upAxis: UpAxis): number {
  if (points.length === 0) return 0
  const key = upAxis === 'z' ? 'z' : 'y'
  return points.reduce((sum, p) => sum + p[key], 0) / points.length
}

// Same compact color-swatch row AnnotationsPanel.tsx's own ColorField uses.
function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-prosota-muted">
      <span className="w-16 shrink-0">{label}</span>
      <input type="color" value={value} onChange={e => onChange(e.target.value)} className="w-6 h-6 border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded shrink-0" />
    </label>
  )
}

function Item({
  path, upAxis, addingPoints, binding, error: _error, onRename, onToggleClosed, onToggleVisible, onDelete, onToggleAddPoints, onRemoveLastPoint, onBind, onUnbind, onToggleOrient, onSetHeadingOffset, bindTarget, onUpdateStyle, onSetElevation, animWindow, format, onKeyAnimStart, onKeyAnimEnd,
}: {
  path: Path
  upAxis: UpAxis
  addingPoints: boolean
  binding: PathFollower | undefined
  error: string | null
  onRename: (name: string) => void
  onToggleClosed: () => void
  onToggleVisible: () => void
  onDelete: () => void
  onToggleAddPoints: () => void
  onRemoveLastPoint: () => void
  onBind: () => void
  onUnbind: () => void
  onToggleOrient: () => void
  onSetHeadingOffset: (headingOffsetDeg: number) => void
  bindTarget: BindTarget | null
  onUpdateStyle: (patch: Partial<Pick<Path, 'color' | 'line_style' | 'show_arrow' | 'show_label' | 'line_width' | 'dash_size' | 'gap_size' | 'animate' | 'animation_loop'>>) => void
  onSetElevation: (elevation: number) => void
  animWindow: { start: Date | null; end: Date | null } | undefined
  format: DisplayFormat | null
  onKeyAnimStart: () => void
  onKeyAnimEnd: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(path.name)
  const [styleOpen, setStyleOpen] = useState(false)

  const commitRename = () => {
    setEditing(false)
    const trimmed = draftName.trim()
    if (trimmed && trimmed !== path.name) onRename(trimmed)
    else setDraftName(path.name)
  }

  return (
    <div className="px-3 py-2 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <input type="checkbox" checked={path.visible} onChange={onToggleVisible} title={path.visible ? 'Visible — click to hide the curve' : 'Hidden — click to show the curve'} />
        {editing ? (
          <input
            autoFocus
            value={draftName}
            onChange={e => setDraftName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={e => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') { setDraftName(path.name); setEditing(false) }
            }}
            className="flex-1 text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1 py-0.5 min-w-0"
          />
        ) : (
          <span onDoubleClick={() => setEditing(true)} className="flex-1 text-xs text-gray-700 dark:text-prosota-muted truncate cursor-text" title="Double-click to rename">
            {path.name}
          </span>
        )}
        <button onClick={onDelete} title="Delete" className="text-xs text-gray-400 dark:text-prosota-muted hover:text-red-600 dark:hover:text-red-400 shrink-0">✕</button>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          onClick={onToggleAddPoints}
          className={`text-xs px-2 py-0.5 rounded border font-medium ${
            addingPoints ? 'bg-sky-600 text-white border-sky-600' : 'bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted border-gray-300 dark:border-prosota-line hover:bg-gray-50 dark:hover:bg-prosota-panel2'
          }`}
          title={addingPoints ? 'Click in the viewport to add points — click again to stop' : 'Click points in the viewport to add to this curve'}
        >
          {addingPoints ? 'Adding… (click viewport)' : '+ Point'}
        </button>
        <button
          onClick={onRemoveLastPoint}
          disabled={path.points.length === 0}
          className="text-xs px-2 py-0.5 rounded border border-gray-300 dark:border-prosota-line text-gray-600 dark:text-prosota-muted disabled:text-gray-300 disabled:border-gray-200 hover:bg-gray-50 dark:hover:bg-prosota-panel2 disabled:hover:bg-transparent"
        >
          Undo last point
        </button>
        <label className="flex items-center gap-1 text-xs text-gray-500 dark:text-prosota-muted">
          <input type="checkbox" checked={path.closed} onChange={onToggleClosed} />
          Closed
        </label>
        <span className="text-xs text-gray-400 dark:text-prosota-muted">{path.points.length} pt{path.points.length === 1 ? '' : 's'}</span>
      </div>
      <button onClick={() => setStyleOpen(v => !v)} className="text-[11px] text-sky-600 hover:text-sky-800">
        {styleOpen ? '▾' : '▸'} Style
      </button>
      {styleOpen && (
        // Mirrors AnnotationsPanel.tsx's own Style section (2026-07-29, per
        // Maro's site-logistics reference — a colored, dashed, arrowed,
        // labeled route like "RIG 1"/"RIG 2") — see PathGizmo.tsx for how
        // each of these actually renders.
        <div className="space-y-1 bg-gray-50 dark:bg-prosota-panel2 border border-gray-100 dark:border-prosota-line rounded px-2 py-1.5">
          <ColorField label="Color" value={path.color} onChange={v => onUpdateStyle({ color: v })} />
          <label className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-prosota-muted">
            <span className="w-16 shrink-0">Line style</span>
            <select
              value={path.line_style}
              onChange={e => onUpdateStyle({ line_style: e.target.value as PathLineStyle })}
              className="flex-1 border border-gray-200 dark:border-prosota-line rounded px-1.5 py-0.5"
            >
              <option value="solid">Solid</option>
              <option value="dashed">Dashed</option>
            </select>
          </label>
          {path.line_style === 'dashed' && (
            <>
              <label className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-prosota-muted">
                <span className="w-16 shrink-0">Dash size</span>
                <input
                  type="number" min={0.05} step={0.05}
                  value={path.dash_size}
                  onChange={e => onUpdateStyle({ dash_size: Number(e.target.value) })}
                  className="flex-1 w-0 border border-gray-200 dark:border-prosota-line rounded px-1.5 py-0.5"
                />
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-prosota-muted">
                <span className="w-16 shrink-0">Gap size</span>
                <input
                  type="number" min={0.05} step={0.05}
                  value={path.gap_size}
                  onChange={e => onUpdateStyle({ gap_size: Number(e.target.value) })}
                  className="flex-1 w-0 border border-gray-200 dark:border-prosota-line rounded px-1.5 py-0.5"
                />
              </label>
            </>
          )}
          <label className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-prosota-muted">
            <span className="w-16 shrink-0">Line width</span>
            <input
              type="number" min={1} max={20} step={1}
              value={path.line_width}
              onChange={e => onUpdateStyle({ line_width: Number(e.target.value) })}
              className="flex-1 w-0 border border-gray-200 dark:border-prosota-line rounded px-1.5 py-0.5"
            />
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-prosota-muted">
            <input type="checkbox" checked={path.show_arrow} onChange={e => onUpdateStyle({ show_arrow: e.target.checked })} />
            Show direction arrow
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-prosota-muted">
            <input type="checkbox" checked={path.show_label} onChange={e => onUpdateStyle({ show_label: e.target.checked })} />
            Show label
          </label>
          <label
            className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-prosota-muted"
            title="Draws the line (and its arrow, if enabled) growing from the first point to the last over the Start/End window below, instead of always fully drawn"
          >
            <input type="checkbox" checked={path.animate} onChange={e => onUpdateStyle({ animate: e.target.checked })} />
            Animate line
          </label>
          {path.animate && (
            <>
              {/* Frames/Seconds/Date, not a raw datetime-local field
                  (2026-07-30, per Maro: "I want frames or seconds not
                  dates here") — reads the same shared display format
                  TimelineWindow.tsx's own scrubber uses (FourD.tsx's
                  lifted speed/mode/fps). The "Key" button keys the
                  *current playhead*, not whatever this field displays —
                  there's deliberately no way to type an exact value
                  here, matching Blender's own "keyframe the playhead"
                  workflow this whole feature is modeled on. */}
              <label className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-prosota-muted">
                <span className="w-16 shrink-0">Start</span>
                <span className="flex-1 truncate" title={animWindow?.start ? animWindow.start.toLocaleString() : 'Not keyed yet'}>
                  {animWindow?.start && format ? formatTimelineValue(animWindow.start, format.scheduleStart, format.timeDisplayMode, format.speedDaysPerSecond, format.fps) : 'Not keyed'}
                </span>
                <button
                  onClick={onKeyAnimStart}
                  title="Key the current playhead as this path's reveal Start"
                  className="text-[11px] px-1.5 py-0.5 rounded border border-gray-300 dark:border-prosota-line bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2 shrink-0"
                >
                  Key
                </button>
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-prosota-muted">
                <span className="w-16 shrink-0">End</span>
                <span className="flex-1 truncate" title={animWindow?.end ? animWindow.end.toLocaleString() : 'Not keyed yet'}>
                  {animWindow?.end && format ? formatTimelineValue(animWindow.end, format.scheduleStart, format.timeDisplayMode, format.speedDaysPerSecond, format.fps) : 'Not keyed'}
                </span>
                <button
                  onClick={onKeyAnimEnd}
                  title="Key the current playhead as this path's reveal End"
                  className="text-[11px] px-1.5 py-0.5 rounded border border-gray-300 dark:border-prosota-line bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2 shrink-0"
                >
                  Key
                </button>
              </label>
              <label
                className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-prosota-muted"
                title="Repeats the reveal every time the playhead passes End, instead of holding fully-drawn"
              >
                <input type="checkbox" checked={path.animation_loop} onChange={e => onUpdateStyle({ animation_loop: e.target.checked })} />
                Loop
              </label>
            </>
          )}
          <label
            className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-prosota-muted"
            title="Shifts every point of this path up or down by the same amount — a manual failsafe for when a click didn't land exactly on the real surface. Preserves any slope; only the overall height moves."
          >
            <span className="w-16 shrink-0">Elevation</span>
            <input
              type="number" step={0.1}
              value={pathElevation(path.points, upAxis)}
              disabled={path.points.length === 0}
              onChange={e => onSetElevation(Number(e.target.value))}
              className="flex-1 w-0 border border-gray-200 dark:border-prosota-line rounded px-1.5 py-0.5 disabled:bg-gray-100 dark:disabled:bg-prosota-panel2 disabled:text-gray-400 dark:disabled:text-prosota-muted"
            />
          </label>
        </div>
      )}
      {binding ? (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-prosota-muted bg-sky-50 border border-sky-100 rounded px-2 py-1">
            <span className="flex-1 truncate">Bound: {binding.target_kind} · {binding.element_ref || '(whole)'}</span>
            <label className="flex items-center gap-1 shrink-0">
              <input type="checkbox" checked={binding.orient_to_path} onChange={onToggleOrient} />
              Orient
            </label>
            <button onClick={onUnbind} className="text-gray-400 dark:text-prosota-muted hover:text-red-600 dark:hover:text-red-400 shrink-0">✕</button>
          </div>
          {binding.orient_to_path && (
            // Heading offset (2026-08-06, per Maro: "when i hit bind it
            // changed the rotation of the car" — see FourD.tsx's own
            // handleSetPathFollowerHeadingOffset header for the full "why":
            // not every imported model was authored with three.js's own
            // -Z-is-forward convention, so Orient's lookAt can land 90°/180°
            // off a model's real visual front. -90/+90 cover the common
            // case in one click; the number field is there for anything
            // else (a mirrored import, etc).
            <div className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-prosota-muted pl-1">
              <span className="w-16 shrink-0">Heading</span>
              <button
                onClick={() => onSetHeadingOffset(binding.heading_offset_deg - 90)}
                title="Nudge -90°"
                className="px-1.5 py-0.5 rounded border border-gray-300 dark:border-prosota-line bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2"
              >
                -90°
              </button>
              <input
                type="number" step={1}
                value={binding.heading_offset_deg}
                onChange={e => onSetHeadingOffset(Number(e.target.value))}
                className="flex-1 w-0 border border-gray-200 dark:border-prosota-line rounded px-1.5 py-0.5"
              />
              <button
                onClick={() => onSetHeadingOffset(binding.heading_offset_deg + 90)}
                title="Nudge +90°"
                className="px-1.5 py-0.5 rounded border border-gray-300 dark:border-prosota-line bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2"
              >
                +90°
              </button>
            </div>
          )}
        </div>
      ) : (
        <button
          onClick={onBind}
          disabled={!bindTarget || path.points.length < 2}
          title={!bindTarget ? 'Select a mesh or IFC element first' : path.points.length < 2 ? 'Add at least 2 points first' : `Bind ${bindTarget.label} to follow this path`}
          className="text-xs px-2 py-0.5 rounded border border-gray-300 dark:border-prosota-line text-gray-600 dark:text-prosota-muted disabled:text-gray-300 disabled:border-gray-200 hover:bg-gray-50 dark:hover:bg-prosota-panel2 disabled:hover:bg-transparent"
        >
          Bind selected {bindTarget ? `(${bindTarget.label})` : ''}
        </button>
      )}
    </div>
  )
}

// "Paths" dockable panel (2026-07-11, per Maro's Blender curve reference:
// "in blender you can add a curve, edit it and set a path from point a to
// b... i can then place an object to follow that path") — same shared-
// side-dock treatment as Sections/Camera Views/Collections (SideDock.tsx).
// Each path: visibility + closed toggles, "+ Point" arms click-to-place mode
// in the viewport (PathGizmo.tsx's PathAddPointCatcher), and a bind control
// that attaches whatever's currently selected (a mesh or IFC element —
// camera binding is a later pass, see this session's own scoping decision)
// as a PathFollower. Deliberately no per-point numeric editing here — drag
// handles in the viewport (PathGizmo.tsx) are the only way to reposition an
// existing point, matching the "click-to-place" spirit of the whole feature
// rather than mixing in a second, numeric-list editing mode.
export function PathsPanel({
  paths, error, addingPointsForPathId, upAxis, bindTarget, followers, animWindows, format,
  onCreate, onRename, onToggleClosed, onToggleVisible, onDelete, onToggleAddPoints, onRemoveLastPoint, onBind, onUnbind, onToggleOrient, onSetHeadingOffset, onUpdateStyle, onSetElevation, onKeyAnimStart, onKeyAnimEnd,
}: Props) {
  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      <div className="px-3 py-2 border-b border-gray-100 dark:border-prosota-line flex items-center justify-between sticky top-0 bg-white dark:bg-prosota-panel">
        <span className="text-xs text-gray-500 dark:text-prosota-muted">Paths</span>
        <button onClick={onCreate} className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-prosota-line text-gray-700 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2">
          + Add
        </button>
      </div>
      {error && <p className="px-3 py-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      {paths.length === 0 ? (
        <p className="px-3 py-3 text-xs text-gray-400 dark:text-prosota-muted">
          "+ Add" a path, then "+ Point" and click in the viewport to lay down its curve.
        </p>
      ) : (
        <div className="divide-y divide-gray-100">
          {paths.map(path => (
            <Item
              key={path.id}
              path={path}
              upAxis={upAxis}
              addingPoints={addingPointsForPathId === path.id}
              binding={followers.find(f => f.path_id === path.id)}
              error={error}
              bindTarget={bindTarget}
              onRename={name => onRename(path.id, name)}
              onToggleClosed={() => onToggleClosed(path.id)}
              onToggleVisible={() => onToggleVisible(path.id)}
              onDelete={() => onDelete(path.id)}
              onToggleAddPoints={() => onToggleAddPoints(path.id)}
              onRemoveLastPoint={() => onRemoveLastPoint(path.id)}
              onBind={() => onBind(path.id)}
              onUnbind={() => {
                const binding = followers.find(f => f.path_id === path.id)
                if (binding) onUnbind(binding.id)
              }}
              onToggleOrient={() => {
                const binding = followers.find(f => f.path_id === path.id)
                if (binding) onToggleOrient(binding.id)
              }}
              onSetHeadingOffset={headingOffsetDeg => {
                const binding = followers.find(f => f.path_id === path.id)
                if (binding) onSetHeadingOffset(binding.id, headingOffsetDeg)
              }}
              onUpdateStyle={patch => onUpdateStyle(path.id, patch)}
              onSetElevation={elevation => onSetElevation(path.id, elevation)}
              animWindow={animWindows.get(path.id)}
              format={format}
              onKeyAnimStart={() => onKeyAnimStart(path.id)}
              onKeyAnimEnd={() => onKeyAnimEnd(path.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
