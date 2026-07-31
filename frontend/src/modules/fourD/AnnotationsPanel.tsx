import { useState } from 'react'
import type { Activity } from '@/modules/scheduling/types'
import type { Annotation, AnnotationIcon, AnnotationKind, AnnotationUpdate } from './annotations'
import type { AnimationProfile } from './animationProfiles'
import { ElementLinkFields } from './ElementLinkFields'
import type { ModelElementLink } from './modelElementLinks'
import { formatTimelineValue, type TimeDisplayMode } from './timelinePlayback'

// Threaded down for the leader's own Start/End fields' frames/seconds/date
// display (2026-08-06) — same bundling PathsPanel.tsx/ZonesPanel.tsx's own
// DisplayFormat uses, reusing FourD.tsx's one shared speed/mode/fps rather
// than each panel owning an independent copy.
interface DisplayFormat {
  scheduleStart: Date
  timeDisplayMode: TimeDisplayMode
  speedDaysPerSecond: number
  fps: number
}

const ICON_OPTIONS: { value: AnnotationIcon; label: string }[] = [
  { value: 'pin', label: '📍 Pin' },
  { value: 'flag', label: '🚩 Flag' },
  { value: 'comment', label: '💬 Comment' },
  { value: 'warning', label: '⚠️ Warning' },
]

const KIND_OPTIONS: { value: AnnotationKind; label: string }[] = [
  { value: 'placemark', label: '+ Placemark' },
  { value: 'comment', label: '+ Comment' },
]

interface BindTarget {
  ref: string
  label: string
}

interface Props {
  annotations: Annotation[]
  error: string | null
  addingKind: AnnotationKind | null
  bindTarget: BindTarget | null
  activities: Activity[]
  modelElementLinks: ModelElementLink[]
  animationProfiles: AnimationProfile[]
  // Resolved anim_start/anim_end per annotation (2026-08-06, ElementKeyframe-
  // based — see annotation.py's own header) plus the shared display format —
  // see PathsPanel.tsx's own matching props for the full rationale.
  animWindows: Map<string, { start: Date | null; end: Date | null }>
  format: DisplayFormat | null
  onStartAdding: (kind: AnnotationKind) => void
  onUpdate: (id: string, patch: AnnotationUpdate) => void
  onDelete: (id: string) => void
  onBindLeader: (id: string) => void
  onUnbindLeader: (id: string) => void
  onLinkActivity: (annotationId: string, activityId: string) => void
  onUnlinkActivity: (linkId: string) => void
  onAssignProfile: (linkId: string, profileId: string | null) => void
  onKeyAnimStart: (id: string) => void
  onKeyAnimEnd: (id: string) => void
}

// A single hex-colour field — label + native colour swatch, same compact
// row shape repeated four times in the Style section below.
function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
      <span className="w-16 shrink-0">{label}</span>
      <input type="color" value={value} onChange={e => onChange(e.target.value)} className="w-6 h-6 border border-gray-300 rounded shrink-0" />
    </label>
  )
}

// Number field for the two distance-culling bounds — blank means "no
// limit" (null on the wire), matching annotation.py's own convention.
function DistanceField({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
      <span className="w-28 shrink-0">{label}</span>
      <input
        type="number" min={0} step={0.1}
        value={value ?? ''}
        onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
        placeholder="no limit"
        className="flex-1 w-0 border border-gray-200 rounded px-1.5 py-0.5"
      />
    </label>
  )
}

function Item({
  annotation, bindTarget, activities, links, animationProfiles, animWindow, format,
  onUpdate, onDelete, onBindLeader, onUnbindLeader, onLinkActivity, onUnlinkActivity, onAssignProfile, onKeyAnimStart, onKeyAnimEnd,
}: {
  annotation: Annotation
  bindTarget: BindTarget | null
  activities: Activity[]
  links: ModelElementLink[]
  animationProfiles: AnimationProfile[]
  animWindow: { start: Date | null; end: Date | null } | undefined
  format: DisplayFormat | null
  onUpdate: (patch: AnnotationUpdate) => void
  onDelete: () => void
  onBindLeader: () => void
  onUnbindLeader: () => void
  onLinkActivity: (activityId: string) => void
  onUnlinkActivity: (linkId: string) => void
  onAssignProfile: (linkId: string, profileId: string | null) => void
  onKeyAnimStart: () => void
  onKeyAnimEnd: () => void
}) {
  const [editingText, setEditingText] = useState(false)
  const [draftText, setDraftText] = useState(annotation.text)
  const [expandedSection, setExpandedSection] = useState<'style' | 'leader' | 'animate' | null>(null)
  const hasLeader = annotation.kind === 'comment'

  const commitText = () => {
    setEditingText(false)
    if (draftText !== annotation.text) onUpdate({ text: draftText })
  }

  return (
    <div className="px-3 py-2 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <input type="checkbox" checked={annotation.visible} onChange={e => onUpdate({ visible: e.target.checked })} title={annotation.visible ? 'Visible — click to hide' : 'Hidden — click to show'} />
        <select
          value={annotation.icon}
          onChange={e => onUpdate({ icon: e.target.value as AnnotationIcon })}
          className="text-xs border border-gray-300 rounded px-1 py-0.5"
        >
          {ICON_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {editingText ? (
          <input
            autoFocus
            value={draftText}
            onChange={e => setDraftText(e.target.value)}
            onBlur={commitText}
            onKeyDown={e => {
              if (e.key === 'Enter') commitText()
              if (e.key === 'Escape') { setDraftText(annotation.text); setEditingText(false) }
            }}
            className="flex-1 text-xs border border-gray-300 rounded px-1 py-0.5 min-w-0"
          />
        ) : (
          <span
            onDoubleClick={() => setEditingText(true)}
            className="flex-1 text-xs text-gray-700 truncate cursor-text"
            title="Double-click to edit note"
          >
            {annotation.text || <span className="text-gray-300">(no note)</span>}
          </span>
        )}
        <button onClick={onDelete} title="Delete" className="text-xs text-gray-400 hover:text-red-600 shrink-0">✕</button>
      </div>

      {hasLeader && (
        annotation.element_ref ? (
          <div className="flex items-center gap-1.5 text-xs text-gray-600 bg-sky-50 border border-sky-100 rounded px-2 py-1">
            <span className="flex-1 truncate">Pointing at: {annotation.element_ref}</span>
            <button onClick={onUnbindLeader} className="text-gray-400 hover:text-red-600 shrink-0">✕</button>
          </div>
        ) : (
          <button
            onClick={onBindLeader}
            disabled={!bindTarget}
            title={!bindTarget ? 'Select a mesh element first' : `Point this ${annotation.kind} at ${bindTarget.label}`}
            className="text-xs px-2 py-0.5 rounded border border-gray-300 text-gray-600 disabled:text-gray-300 disabled:border-gray-200 hover:bg-gray-50 disabled:hover:bg-transparent"
          >
            Point at selected {bindTarget ? `(${bindTarget.label})` : ''}
          </button>
        )
      )}

      <div className="flex items-center gap-3">
        <button onClick={() => setExpandedSection(s => (s === 'style' ? null : 'style'))} className="text-[11px] text-sky-600 hover:text-sky-800">
          {expandedSection === 'style' ? '▾' : '▸'} Style
        </button>
        {hasLeader && (
          <button onClick={() => setExpandedSection(s => (s === 'leader' ? null : 'leader'))} className="text-[11px] text-sky-600 hover:text-sky-800">
            {expandedSection === 'leader' ? '▾' : '▸'} Leader {annotation.animate ? '(animated)' : ''}
          </button>
        )}
        <button onClick={() => setExpandedSection(s => (s === 'animate' ? null : 'animate'))} className="text-[11px] text-sky-600 hover:text-sky-800">
          {expandedSection === 'animate' ? '▾' : '▸'} Animate {links.length > 0 ? '(linked)' : ''}
        </button>
      </div>

      {expandedSection === 'style' && (
        // Mirrors the Navisworks reference's own Design/Colors/Behavior
        // property grid field-for-field — see annotation.py's own
        // docstring for the mapping and AnnotationMarker.tsx for how each
        // one actually renders.
        <div className="space-y-1 bg-gray-50 border border-gray-100 rounded px-2 py-1.5">
          <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
            <input type="checkbox" checked={annotation.has_background} onChange={e => onUpdate({ has_background: e.target.checked })} />
            Background fill
          </label>
          <ColorField label="Background" value={annotation.background_color} onChange={v => onUpdate({ background_color: v })} />
          {annotation.has_background && (
            <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
              <span className="w-16 shrink-0">Opacity</span>
              <input
                type="range" min={0} max={1} step={0.05}
                value={annotation.background_opacity}
                onChange={e => onUpdate({ background_opacity: Number(e.target.value) })}
                className="flex-1"
              />
              <span className="w-8 text-right shrink-0">{Math.round(annotation.background_opacity * 100)}%</span>
            </label>
          )}
          <ColorField label="Border" value={annotation.border_color} onChange={v => onUpdate({ border_color: v })} />
          <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
            <input type="checkbox" checked={annotation.thick_border} onChange={e => onUpdate({ thick_border: e.target.checked })} />
            Thick border
          </label>
          {hasLeader && (
            <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
              <span className="w-16 shrink-0">Shape</span>
              <select
                value={annotation.box_shape}
                onChange={e => onUpdate({ box_shape: e.target.value as Annotation['box_shape'] })}
                className="flex-1 w-0 border border-gray-200 rounded px-1.5 py-0.5"
              >
                <option value="rounded">Rounded</option>
                <option value="rectangle">Rectangle</option>
              </select>
            </label>
          )}
          {!hasLeader && (
            // Placemark balloon scale/rotation (2026-07-30, per Maro: "and
            // the pin and flag and warning" — same Blender-reference
            // request extended from the comment box) — see
            // AnnotationMarker.tsx's own placemark transform comment for
            // the corner-pivot math.
            <>
              <label className="flex items-center gap-1.5 text-[11px] text-gray-500" title="Scales the balloon around its own tip">
                <span className="w-16 shrink-0">Scale</span>
                <input
                  type="number" min={0.01} step={0.1}
                  value={annotation.placemark_scale}
                  onChange={e => onUpdate({ placemark_scale: Number(e.target.value) })}
                  className="flex-1 w-0 border border-gray-200 rounded px-1.5 py-0.5"
                />
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-gray-500" title="Rotates the balloon around its own tip, on top of its fixed tilt">
                <span className="w-16 shrink-0">Rotation</span>
                <input
                  type="number" step={1}
                  value={annotation.placemark_rotation}
                  onChange={e => onUpdate({ placemark_rotation: Number(e.target.value) })}
                  className="flex-1 w-0 border border-gray-200 rounded px-1.5 py-0.5"
                />
              </label>
            </>
          )}
          <ColorField label="Text" value={annotation.text_color} onChange={v => onUpdate({ text_color: v })} />
          <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
            <span className="w-16 shrink-0">Font size</span>
            <input
              type="number" min={8} max={72}
              value={annotation.font_size}
              onChange={e => onUpdate({ font_size: Number(e.target.value) })}
              className="w-16 border border-gray-200 rounded px-1.5 py-0.5"
            />
          </label>
          <DistanceField label="Hide if closer than" value={annotation.hide_closer_than} onChange={v => onUpdate({ hide_closer_than: v })} />
          <DistanceField label="Hide if farther than" value={annotation.hide_farther_than} onChange={v => onUpdate({ hide_farther_than: v })} />
        </div>
      )}
      {expandedSection === 'leader' && (
        // Bent leader controls (2026-08-06, per Maro: "how the leader
        // works and how its animated which should also have the ability
        // to be animated independent of tasks") — x/z of the offset are
        // dragged directly in the viewport (AnnotationMarker.tsx's own
        // handle at the callout), only the rise height is edited here
        // numerically, same "Elevation" convention Zone's own single
        // scalar already uses. Start/End/Key mirror PathsPanel.tsx's own
        // reveal-window fields exactly — keys the current playhead via
        // ElementKeyframe's anim_start/anim_end, independent of any
        // Activity. "Animate reveal" hides/shows the *whole* annotation
        // over that window (2026-07-30 scope fix, per Maro: "the animate
        // leader feature is not just about the leader its the whole
        // thing") — box and dot together with the line, not the line
        // alone; see AnnotationMarker.tsx's own matching header. Dot
        // radius/Line colour/Rotation/Scale (2026-07-30, per Maro pointing
        // at a Blender GeometryNodes callout modifier and asking for
        // "everything") mirror that modifier's own Ball Radius/Color Stem/
        // Rotate Callout/Scale Callout controls — see annotation.py's own
        // leader_dot_radius header for the full mapping.
        <div className="space-y-1 bg-gray-50 border border-gray-100 rounded px-2 py-1.5">
          <label
            className="flex items-center gap-1.5 text-[11px] text-gray-500"
            title="Height of the leader's elbow above its target — drag the callout box in the viewport to move it sideways"
          >
            <span className="w-16 shrink-0">Elevation</span>
            <input
              type="number" step={0.1}
              value={annotation.leader_offset_y}
              onChange={e => onUpdate({ leader_offset_y: Number(e.target.value) })}
              className="flex-1 w-0 border border-gray-200 rounded px-1.5 py-0.5"
            />
          </label>
          {/* Offset X/Z (2026-07-30, per Maro: "i'd like to be able to move
              right/left" — the callout could already be dragged sideways in
              the viewport, but not typed in numerically the way Elevation
              always could) — same semantic-axis fields the drag handle
              itself writes to (AnnotationMarker.tsx's own leader_offset_x/z
              header), just also editable here. */}
          <label className="flex items-center gap-1.5 text-[11px] text-gray-500" title="Sideways offset of the callout — world X axis">
            <span className="w-16 shrink-0">Offset X</span>
            <input
              type="number" step={0.1}
              value={annotation.leader_offset_x}
              onChange={e => onUpdate({ leader_offset_x: Number(e.target.value) })}
              className="flex-1 w-0 border border-gray-200 rounded px-1.5 py-0.5"
            />
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-gray-500" title="Sideways offset of the callout — the other horizontal axis">
            <span className="w-16 shrink-0">Offset Z</span>
            <input
              type="number" step={0.1}
              value={annotation.leader_offset_z}
              onChange={e => onUpdate({ leader_offset_z: Number(e.target.value) })}
              className="flex-1 w-0 border border-gray-200 rounded px-1.5 py-0.5"
            />
          </label>
          <label
            className="flex items-center gap-1.5 text-[11px] text-gray-500"
            title="Hides just the connecting line — the callout box and target dot stay visible either way"
          >
            <input type="checkbox" checked={annotation.leader_visible} onChange={e => onUpdate({ leader_visible: e.target.checked })} />
            Show leader line
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-gray-500" title="Radius of the small dot at the leader's target">
            <span className="w-16 shrink-0">Dot radius</span>
            <input
              type="number" min={0} step={0.01}
              value={annotation.leader_dot_radius}
              onChange={e => onUpdate({ leader_dot_radius: Number(e.target.value) })}
              className="flex-1 w-0 border border-gray-200 rounded px-1.5 py-0.5"
            />
          </label>
          <ColorField label="Line colour" value={annotation.leader_color} onChange={v => onUpdate({ leader_color: v })} />
          <label className="flex items-center gap-1.5 text-[11px] text-gray-500" title="Rotates the callout box around the point where the leader touches it">
            <span className="w-16 shrink-0">Rotation</span>
            <input
              type="number" step={1}
              value={annotation.leader_rotation}
              onChange={e => onUpdate({ leader_rotation: Number(e.target.value) })}
              className="flex-1 w-0 border border-gray-200 rounded px-1.5 py-0.5"
            />
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-gray-500" title="Scales the callout box around the point where the leader touches it">
            <span className="w-16 shrink-0">Scale</span>
            <input
              type="number" min={0.01} step={0.1}
              value={annotation.leader_scale}
              onChange={e => onUpdate({ leader_scale: Number(e.target.value) })}
              className="flex-1 w-0 border border-gray-200 rounded px-1.5 py-0.5"
            />
          </label>
          <label
            className="flex items-center gap-1.5 text-[11px] text-gray-500"
            title="Hides the whole annotation (box, dot, and line) until Start, then draws the line in and shows the box over the Start/End window below"
          >
            <input type="checkbox" checked={annotation.animate} onChange={e => onUpdate({ animate: e.target.checked })} />
            Animate reveal
          </label>
          {annotation.animate && (
            <>
              <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
                <span className="w-16 shrink-0">Start</span>
                <span className="flex-1 truncate" title={animWindow?.start ? animWindow.start.toLocaleString() : 'Not keyed yet'}>
                  {animWindow?.start && format ? formatTimelineValue(animWindow.start, format.scheduleStart, format.timeDisplayMode, format.speedDaysPerSecond, format.fps) : 'Not keyed'}
                </span>
                <button
                  onClick={onKeyAnimStart}
                  title="Key the current playhead as this annotation's reveal Start"
                  className="text-[11px] px-1.5 py-0.5 rounded border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 shrink-0"
                >
                  Key
                </button>
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
                <span className="w-16 shrink-0">End</span>
                <span className="flex-1 truncate" title={animWindow?.end ? animWindow.end.toLocaleString() : 'Not keyed yet'}>
                  {animWindow?.end && format ? formatTimelineValue(animWindow.end, format.scheduleStart, format.timeDisplayMode, format.speedDaysPerSecond, format.fps) : 'Not keyed'}
                </span>
                <button
                  onClick={onKeyAnimEnd}
                  title="Key the current playhead as this annotation's reveal End"
                  className="text-[11px] px-1.5 py-0.5 rounded border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 shrink-0"
                >
                  Key
                </button>
              </label>
              <label
                className="flex items-center gap-1.5 text-[11px] text-gray-500"
                title="Repeats the reveal every time the playhead passes End, instead of holding fully shown"
              >
                <input type="checkbox" checked={annotation.animation_loop} onChange={e => onUpdate({ animation_loop: e.target.checked })} />
                Loop
              </label>
            </>
          )}
        </div>
      )}
      {expandedSection === 'animate' && (
        <ElementLinkFields
          activities={activities}
          links={links}
          animationProfiles={animationProfiles}
          onLink={onLinkActivity}
          onUnlink={onUnlinkActivity}
          onAssignProfile={onAssignProfile}
        />
      )}
    </div>
  )
}

// "3D Notations" dockable panel (2026-07-12, redone per Maro's fuller
// Navisworks reference — Comment/Placemark listed together as the same
// kind of spatial marker, each with a real style/behaviour property
// grid; a third "Footnote" kind existed briefly and was scrapped
// 2026-08-06 for being functionally identical to Comment).
// "+ Placemark"/"+ Comment" arm click-to-place mode in the viewport
// (AnnotationAddCatcher in Viewport3D.tsx, same native-pointerdown-
// capture-phase trick PathAddPointCatcher already uses), one click places
// it and exits placing mode — unlike Path's own continuous multi-point
// mode, an annotation is a single point. A Comment's leader target is
// bound separately ("Point at selected"), the same "whatever's currently
// the active scene object" pattern PathsPanel's own "Bind selected" uses
// for PathFollower — placing the marker and pointing it at something are
// two independent actions, not one combined step.
//
// Position itself isn't editable here at all, only by dragging the marker
// in the viewport (AnnotationMarker.tsx) — matches Path's own "no per-point
// numeric editing, drag handles are the only way" convention. Text/icon/
// visible are edited directly in each row; "▸ Style" expands the
// background/border/text colour + font size + distance-culling controls;
// "▸ Animate" expands ElementLinkFields (the same Activity+AnimationProfile
// linking UI mesh/IFC elements already use) for Mode A, and manual
// position/visible keyframing (Mode B) happens via TransformPanel once the
// annotation is selected in the viewport, mirroring exactly how Follow
// Path's own path_progress keying works.
export function AnnotationsPanel({
  annotations, error, addingKind, bindTarget, activities, modelElementLinks, animationProfiles, animWindows, format,
  onStartAdding, onUpdate, onDelete, onBindLeader, onUnbindLeader, onLinkActivity, onUnlinkActivity, onAssignProfile, onKeyAnimStart, onKeyAnimEnd,
}: Props) {
  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white gap-1.5 flex-wrap">
        <span className="text-xs text-gray-500 shrink-0">3D Notations</span>
        <div className="flex items-center gap-1">
          {KIND_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => onStartAdding(value)}
              className={`text-xs px-2 py-1 rounded border font-medium ${addingKind === value ? 'bg-sky-600 text-white border-sky-600' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
            >
              {addingKind === value ? 'Click viewport…' : label}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="px-3 py-2 text-xs text-red-600">{error}</p>}
      {annotations.length === 0 ? (
        <p className="px-3 py-3 text-xs text-gray-400">
          "+ Placemark" or "+ Comment", then click in the viewport to drop it there.
        </p>
      ) : (
        <div className="divide-y divide-gray-100">
          {annotations.map(annotation => (
            <Item
              key={annotation.id}
              annotation={annotation}
              bindTarget={bindTarget}
              activities={activities}
              links={modelElementLinks.filter(l => l.source_kind === 'annotation' && l.element_ref === annotation.id)}
              animationProfiles={animationProfiles}
              onUpdate={patch => onUpdate(annotation.id, patch)}
              onDelete={() => onDelete(annotation.id)}
              onBindLeader={() => onBindLeader(annotation.id)}
              onUnbindLeader={() => onUnbindLeader(annotation.id)}
              onLinkActivity={activityId => onLinkActivity(annotation.id, activityId)}
              onUnlinkActivity={onUnlinkActivity}
              onAssignProfile={onAssignProfile}
              animWindow={animWindows.get(annotation.id)}
              format={format}
              onKeyAnimStart={() => onKeyAnimStart(annotation.id)}
              onKeyAnimEnd={() => onKeyAnimEnd(annotation.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
