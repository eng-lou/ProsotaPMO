import { useState } from 'react'
import * as THREE from 'three'
import { ResettableNumberInput } from './ResettableNumberInput'
import { resolveDisplayAxis, type UpAxis } from './upAxis'
import { getBaseline } from './elementBaseline'
import type { ElementKeyframe, KeyframeField } from './elementKeyframes'
import { fromDisplayLength, lengthUnitSuffix, toDisplayLength, type IfcUnitDisplay } from './ifcUnitDisplay'

export type GizmoMode = 'translate' | 'rotate' | 'scale'
export type GizmoSpace = 'world' | 'local'

// Manual keyframing support for the active object (2026-07-08, per Maro:
// "the blender way with the keyframes as long as you have 3d/ifc object in
// the scene") — null when keying isn't available at all right now: no
// timeline date yet (nothing to key *at*), or the active object is IFC
// (whole-model selection there doesn't share identity with IFC's per-sub-
// element links — see ElementKeyframe's own docstring's v1 scope note).
// keyframesByField is pre-filtered to just this one object's own tracks.
export interface KeyframeSupport {
  currentDate: Date
  keyframesByField: Partial<Record<KeyframeField, ElementKeyframe[]>>
  onToggle: (field: KeyframeField, currentValue: number) => void
}

// path_progress support for the active object (2026-07-11, per Maro's
// Blender "Follow Path" reference — see path_follower.py's own docstring).
// Reuses the exact same date-keyed keyframe dot convention as Location/
// Rotation/Scale (KeyframeSupport above) rather than inventing a second
// keying UI — only null when the active object has no PathFollower binding
// at all, in which case this section doesn't render.
export interface PathProgressSupport {
  value: number
  keyState: 'exact' | 'other' | 'none'
  onChange: (v: number) => void
  onToggleKey: () => void
}

// "Set Pivot" (2026-07-12, per Maro's crane-rigging request) — see
// elementPivot.ts's own header for why this exists (rotation/scale always
// pivots around an object's own local origin, and a rigged part's file
// almost never has that sitting at its hinge). `point` is undefined when
// no override is set (the file's own original origin). Owned by FourD.tsx,
// same "read/write the live object directly, this panel is presentational"
// split every other Support type here already uses.
export interface PivotSupport {
  point: THREE.Vector3 | undefined
  picking: boolean
  onTogglePicking: () => void
  onChange: (point: THREE.Vector3) => void
  onReset: () => void
  // "Pivot to Center"/"Pivot to Base" (2026-07-23, per Maro: Snap to
  // Surface resting the object's *pivot* on the surface — not visibly
  // useful if that pivot sits at the object's geometric middle, which is
  // the default for most imported meshes) — Center sets the pivot to the
  // object's own bounding-box center, Base to the same center but with
  // the vertical component pulled down to the box's own bottom, so
  // dragging with Snap to Surface on rests the object's actual base on
  // whatever's underneath instead of sinking it in halfway. Both computed
  // in world space then converted back (elementPivot.ts's own header),
  // so they're correct regardless of any axis-correction wrapper.
  onSetToCenter: () => void
  onSetToBase: () => void
}

// "Pivot Rotation" (2026-07-22, per Maro: dragging an element with the
// Move gizmo travelled at an angle relative to an adjacent element it
// needed to stay flush with) — see elementPivot.ts's own header for why
// this exists and PivotSupport's own header just above for the shared
// "read/write the live object" convention. No picking mode here (unlike
// PivotSupport's viewport-click point picker) — there's no single click
// that defines an orientation the way one defines a point.
export interface PivotRotationSupport {
  euler: THREE.Euler | undefined
  onChange: (euler: THREE.Euler) => void
  onReset: () => void
}

interface Props {
  object: THREE.Object3D
  mode: GizmoMode
  onModeChange: (mode: GizmoMode) => void
  // Local/Global toggle for the gizmo (2026-07-22) — three.js's
  // TransformControls has always supported this (it defaults to
  // "world"), just never exposed in this app's UI before Pivot Rotation
  // needed it: dragging Move in "local" space follows the object's own
  // (possibly pivot-rotated) axes instead of raw world X/Y/Z, which is
  // the whole point of being able to set a custom pivot rotation at all.
  space: GizmoSpace
  onSpaceChange: (space: GizmoSpace) => void
  // "Edit Pivot" gizmo toggle (2026-07-23, per Maro: "i want a gizmo for
  // the pivot manipulations not just for the mesh") — Pivot/Pivot Rotation
  // below were typed-fields-only; with this on, the exact same Move/Rotate
  // gizmo redefines the pivot instead of the object (elementPivot.ts's own
  // applyGizmoDragAsPivotEdit header has the full mechanism) — the mesh
  // stays visually put, only the origin/gizmo moves. Scale has no "pivot
  // scale" concept, same exclusion as Global/Local and Snap to Surface
  // just below.
  editPivot: boolean
  onEditPivotChange: (editPivot: boolean) => void
  // "Snap to Surface" (2026-07-23, per Maro: "position an element e.g the
  // car easily on the surface of a second mesh e.g plane e.g road") —
  // while dragging in Move mode, casts a ray straight down from the
  // object and rests it on whatever other visible geometry is directly
  // underneath, so only X/Z (or X/Y) need to be dragged by hand — see
  // Viewport3D.tsx's own snapObjectToSurface for the actual raycast.
  // Translate-only (Rotate/Scale have no sensible "surface" meaning), so
  // this toggle only renders alongside Global/Local, never replacing it.
  snapToSurface: boolean
  onSnapToSurfaceChange: (snap: boolean) => void
  upAxis: UpAxis
  // Non-null once this object is bound to a Path (paths.ts/pathFollowers.ts)
  // — its position is then *derived* from path_progress each frame
  // (Viewport3D.tsx's path-follow evaluation), so the ordinary Location
  // fields below are locked read-only rather than left editable-but-
  // constantly-overwritten.
  pathProgress: PathProgressSupport | null
  // Location field unit conversion (2026-07-11, per Maro: "rewire units" —
  // extending IfcDataPanel's Auto/ft/m toggle here too). lengthUnitToMetres
  // is null for a plain mesh import (no IfcUnitAssignment to read — see
  // ifcModel.ts's getLengthUnitToMetres header), in which case every
  // toDisplayLength/fromDisplayLength call below is a no-op passthrough and
  // the suffix stays "m", exactly this panel's original, only behaviour.
  // Only ever non-null for an IFC object, which — per keyframeSupport's own
  // FourD.tsx header — never has keyframing enabled anyway, so there's no
  // risk of a unit-converted number ever landing in stored keyframe data.
  lengthUnitToMetres: number | null
  unitDisplay: IfcUnitDisplay
  keyframes: KeyframeSupport | null
  pivot: PivotSupport
  pivotRotation: PivotRotationSupport
  // Forces a re-render after a field edit (2026-07-08 fix, per Maro: typed
  // 10 into a Location field, the model moved, but the field itself
  // reverted to showing 0) — every Field's onChange mutates `object`
  // directly with zero React state change; dragging the gizmo instead goes
  // through Viewport3D's TransformControls onChange, which already causes
  // one. Without this, nothing tells the input to re-read the fresh value,
  // so the *next* unrelated re-render snaps it back to whatever it showed
  // last time React actually rendered this component.
  onFieldChange: () => void
}

const RAD_TO_DEG = 180 / Math.PI
const DEG_TO_RAD = Math.PI / 180
const AXES = ['x', 'y', 'z'] as const

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function SectionLabel({ label }: { label: string }) {
  return <div className="px-3 pt-2 pb-0.5 text-[10px] font-bold text-gray-400 uppercase tracking-wide">{label}</div>
}

// Three states, mirroring Blender's own diamond marker: 'exact' (a keyframe
// sits on this exact date — filled), 'other' (this field is keyed
// somewhere else, just not here — hollow), 'none' (never keyed — empty).
function Field({ axisLabel, value, resetValue, suffix, locked, keyState, onChange, onToggleLock, onToggleKey }: {
  axisLabel: string; value: number; resetValue: number; suffix: string; locked: boolean
  keyState: 'exact' | 'other' | 'none' | 'disabled'
  onChange: (v: number) => void; onToggleLock: () => void; onToggleKey: (() => void) | null
}) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-0.5">
      <span className="w-3 text-[11px] text-gray-400 shrink-0">{axisLabel}</span>
      <ResettableNumberInput
        step={0.1}
        value={Number.isFinite(value) ? Number(value.toFixed(3)) : 0}
        defaultValue={resetValue}
        disabled={locked}
        onChange={onChange}
        className="flex-1 w-0 text-xs border border-gray-300 rounded px-1.5 py-0.5 text-right disabled:bg-gray-50 disabled:text-gray-400"
      />
      <span className="w-4 text-[10px] text-gray-400 shrink-0">{suffix}</span>
      <button
        onClick={onToggleLock}
        title={locked ? 'Unlock this field' : 'Lock this field'}
        className={`shrink-0 text-xs ${locked ? 'text-gray-700' : 'text-gray-300 hover:text-gray-500'}`}
      >
        {locked ? '🔒' : '🔓'}
      </button>
      <button
        onClick={onToggleKey ?? undefined}
        disabled={!onToggleKey}
        title={
          keyState === 'disabled'
            ? 'Keyframing needs the Animation Timeline open (for a current date) and only supports plain 3D imports, not IFC'
            : keyState === 'exact' ? 'Keyframed here — click to remove'
            : keyState === 'other' ? 'Keyframed elsewhere — click to add one here too'
            : 'Click to keyframe this field at the current timeline date'
        }
        className={`shrink-0 w-2.5 h-2.5 rounded-full border disabled:cursor-not-allowed disabled:opacity-40 ${
          keyState === 'exact' ? 'bg-amber-500 border-amber-600'
          : keyState === 'other' ? 'bg-white border-amber-500'
          : 'border-gray-300 hover:border-gray-500'
        }`}
      />
    </div>
  )
}

// Blender-style Object Mode Transform fields (2026-07-11, per Maro: "see and
// manipulate the object in 3d space like in blender... transform details").
// Originally a floating card over the viewport; moved into the "3D View
// Properties" panel (PropertiesPanel.tsx) as a contextual section whenever
// a scene object is active (2026-07-11, per Maro: "move the contextual
// transform panel... in the 3d view properties... so if i select an
// object, 3d or ifc, i can see and change them there") — content-only now,
// PropertiesPanel owns the section header/label with the object's name.
// The gizmo itself (TransformControls, the actual drag handles in the
// viewport) is unaffected by this move — it's a separate element in
// Viewport3D.tsx, only the number-input panel relocated.
//
// Reads/writes the live THREE.Object3D directly instead of mirroring it
// into React state: the object is also the thing TransformControls is
// dragging, and Viewport3D.tsx already forces a re-render on every drag
// frame (its TransformControls onChange), so a second, separate copy of
// the same numbers would only invite drift between "what the gizmo did"
// and "what the panel shows."
//
// Lock icons are panel-only — they disable a field's input so a stray
// click can't nudge it, but deliberately don't touch TransformControls'
// own showX/Y/Z (that hides a whole axis's handle across every mode at
// once, too coarse to express "lock Rotation X but not Position X").
//
// The dot per field is a real keyframe toggle (2026-07-08, per Maro: "the
// blender way with the keyframes") — filled when this field is keyed on the
// exact current timeline date, hollow when it's keyed somewhere else, empty
// when it's never been keyed at all (see Field's own keyState prop/header).
// Disabled entirely (via the `keyframes` prop being null) when there's no
// current timeline date yet or the active object is IFC — see this file's
// own KeyframeSupport doc comment.
//
// Each field is a ResettableNumberInput — hover it (no click needed) and
// press Backspace to snap it back to resetValue, which is this object's own
// *original imported* value for that field (2026-07-09 fix, per Maro: "if I
// change [a wall's Z] to 300... I dont want it to go to zero I would want it
// to go [back to its own] 200 z") — previously a flat 0 (Location/Rotation)
// or 1 (Scale) for every field regardless of the object, which is only
// actually right for a freshly imported whole mesh/IFC group; any
// individual IFC sub-element has a real, usually non-zero, baked-in
// placement. See elementBaseline.ts for exactly where/how that snapshot is
// captured (at import time, and re-captured by Apply Transform after a
// bake, since 0/0/1 genuinely *becomes* the object's own baseline then).
export function TransformPanel({ object, mode, onModeChange, space, onSpaceChange, editPivot, onEditPivotChange, snapToSurface, onSnapToSurfaceChange, upAxis, pathProgress, lengthUnitToMetres, unitDisplay, keyframes, pivot, pivotRotation, onFieldChange }: Props) {
  const [locked, setLocked] = useState<Record<string, boolean>>({})
  const toggleLocked = (field: string) => setLocked(prev => ({ ...prev, [field]: !prev[field] }))

  const baseline = getBaseline(object)
  const baselineEuler = new THREE.Euler().setFromQuaternion(baseline.quaternion, object.rotation.order)

  const keyState = (field: KeyframeField): 'exact' | 'other' | 'none' | 'disabled' => {
    if (!keyframes) return 'disabled'
    const points = keyframes.keyframesByField[field]
    if (!points || points.length === 0) return 'none'
    return points.some(p => sameDay(new Date(p.date), keyframes.currentDate)) ? 'exact' : 'other'
  }
  const toggleKey = (field: KeyframeField, currentValue: number) => (
    keyframes ? () => keyframes.onToggle(field, currentValue) : null
  )

  return (
    <div>
      <div className="flex items-center gap-1 px-3 py-1.5">
        {(['translate', 'rotate', 'scale'] as GizmoMode[]).map(m => (
          <button
            key={m}
            onClick={() => onModeChange(m)}
            className={`flex-1 text-[11px] px-1.5 py-1 rounded border font-medium ${
              mode === m ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-300 hover:bg-gray-50'
            }`}
          >
            {m === 'translate' ? 'Move' : m === 'rotate' ? 'Rotate' : 'Scale'}
          </button>
        ))}
      </div>
      {/* "Edit Pivot" (2026-07-23) — see this file's own Props header. Same
          Scale exclusion as Global/Local just below: there's no "pivot
          scale" concept. */}
      {mode !== 'scale' && (
        <div className="flex items-center gap-1.5 px-3 pb-1.5">
          <button
            onClick={() => onEditPivotChange(!editPivot)}
            title="Drag Move/Rotate to redefine the pivot itself instead of moving the object — the object stays put, only its origin (and this gizmo) moves"
            className={`flex-1 text-[10px] px-1.5 py-0.5 rounded border font-medium ${
              editPivot ? 'bg-amber-600 text-white border-amber-600' : 'bg-white text-gray-400 border-gray-200 hover:bg-gray-50'
            }`}
          >
            {editPivot ? '✓ Edit Pivot' : 'Edit Pivot'}
          </button>
        </div>
      )}
      {/* Local/Global (2026-07-22) — see this file's own Props header for
          space's doc comment. Not shown for Scale, which three.js's
          TransformControls always applies in local space regardless of
          this setting (scaling along world axes isn't a meaningful
          operation once an object is rotated). */}
      {mode !== 'scale' && (
        <div className="flex items-center gap-1 px-3 pb-1.5">
          {(['world', 'local'] as GizmoSpace[]).map(s => (
            <button
              key={s}
              onClick={() => onSpaceChange(s)}
              title={s === 'local' ? "Drag along the object's own axes (including any Pivot Rotation set below)" : 'Drag along the fixed world axes'}
              className={`flex-1 text-[10px] px-1.5 py-0.5 rounded border font-medium ${
                space === s ? 'bg-gray-700 text-white border-gray-700' : 'bg-white text-gray-400 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {s === 'world' ? 'Global' : 'Local'}
            </button>
          ))}
        </div>
      )}
      {/* "Snap to Surface" (2026-07-23) — see this file's own Props header.
          Translate-only, same reasoning as Global/Local's own Scale
          exclusion just above: "rest on whatever's underneath" has no
          meaning for Rotate or Scale. Disabled (not hidden) while Edit
          Pivot is on — Viewport3D.tsx's handleGizmoChange already skips the
          actual snap in that case (moving the pivot has no "surface" to
          rest on either), disabling here just keeps the toggle from
          reading as active when it can't do anything right now. */}
      {mode === 'translate' && (
        <div className="flex items-center gap-1.5 px-3 pb-1.5">
          <button
            onClick={() => onSnapToSurfaceChange(!snapToSurface)}
            disabled={editPivot}
            title={editPivot ? 'Not available while Edit Pivot is on' : 'While dragging, rest this object on whatever other geometry is directly underneath it'}
            className={`flex-1 text-[10px] px-1.5 py-0.5 rounded border font-medium disabled:opacity-40 disabled:hover:bg-white ${
              snapToSurface ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-400 border-gray-200 hover:bg-gray-50'
            }`}
          >
            {snapToSurface ? '✓ Snap to Surface' : 'Snap to Surface'}
          </button>
        </div>
      )}

      {pathProgress && (
        <>
          <SectionLabel label="Path" />
          <Field
            axisLabel="%"
            value={pathProgress.value}
            resetValue={0}
            suffix=""
            locked={false}
            keyState={pathProgress.keyState}
            onChange={v => pathProgress.onChange(Math.max(0, Math.min(100, v)))}
            onToggleLock={() => {}}
            onToggleKey={pathProgress.onToggleKey}
          />
        </>
      )}

      {/* "Set Pivot" (2026-07-12) — moves where rotation/scale pivots from,
          without moving the visible geometry. Placed before Location/
          Rotation/Scale since it's the thing that changes what those three
          sections actually mean, not a peer of them. */}
      <SectionLabel label="Pivot" />
      <p className="px-3 pb-1 text-[10px] text-gray-400">
        Where rotation/scale pivots from — moves the origin, not the geometry.
      </p>
      {AXES.map(axis => {
        const { localAxis, sign } = resolveDisplayAxis(axis, upAxis, 'position')
        const current = pivot.point?.[localAxis] ?? 0
        const displayValue = toDisplayLength(sign * current, lengthUnitToMetres, unitDisplay)
        return (
          <div key={`pivot-${axis}`} className="flex items-center gap-1.5 px-3 py-0.5">
            <span className="w-3 text-[11px] text-gray-400 shrink-0">{axis.toUpperCase()}</span>
            <ResettableNumberInput
              step={0.1}
              value={Number.isFinite(displayValue) ? Number(displayValue.toFixed(3)) : 0}
              defaultValue={0}
              onChange={v => {
                const next = (pivot.point ?? new THREE.Vector3()).clone()
                next[localAxis] = sign * fromDisplayLength(v, lengthUnitToMetres, unitDisplay)
                pivot.onChange(next)
              }}
              className="flex-1 w-0 text-xs border border-gray-300 rounded px-1.5 py-0.5 text-right"
            />
            <span className="w-4 text-[10px] text-gray-400 shrink-0">{lengthUnitSuffix(lengthUnitToMetres, unitDisplay)}</span>
          </div>
        )
      })}
      <div className="flex items-center gap-1.5 px-3 py-1">
        <button
          onClick={pivot.onTogglePicking}
          title="Click a point on the model in the viewport to pivot from there"
          className={`flex-1 text-[11px] px-1.5 py-1 rounded border font-medium ${
            pivot.picking ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
          }`}
        >
          {pivot.picking ? 'Click in viewport…' : 'Pick in Viewport'}
        </button>
        <button
          onClick={pivot.onReset}
          disabled={!pivot.point}
          title="Restore the file's own original origin"
          className="text-[11px] px-1.5 py-1 rounded border border-gray-300 text-gray-600 disabled:text-gray-300 disabled:border-gray-200 hover:bg-gray-50 disabled:hover:bg-transparent"
        >
          Reset
        </button>
      </div>
      <div className="flex items-center gap-1.5 px-3 pb-1">
        <button
          onClick={pivot.onSetToCenter}
          title="Move the pivot to this object's own bounding-box center"
          className="flex-1 text-[11px] px-1.5 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
        >
          Center
        </button>
        <button
          onClick={pivot.onSetToBase}
          title="Move the pivot to the bottom-center of this object's own bounding box — e.g. so Snap to Surface rests it on its base instead of sinking it in halfway"
          className="flex-1 text-[11px] px-1.5 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
        >
          Base
        </button>
      </div>

      {/* "Pivot Rotation" (2026-07-22) — redefines what the object's own
          local axes point in, without visibly rotating it (same "moves the
          origin, not the geometry" idea as Pivot above, applied to
          orientation). Switch Move to Local (the toggle above) to actually
          drag along this frame — with Move left on Global, this only
          affects the Rotate gizmo's own Local mode. */}
      <SectionLabel label="Pivot Rotation" />
      <p className="px-3 pb-1 text-[10px] text-gray-400">
        What Local space means for this object — e.g. align it to an adjacent element's angle, without changing how it looks.
      </p>
      {AXES.map(axis => {
        const { localAxis, sign } = resolveDisplayAxis(axis, upAxis, 'rotation')
        const current = pivotRotation.euler?.[localAxis] ?? 0
        const displayValue = sign * current * RAD_TO_DEG
        return (
          <div key={`pivot-rotation-${axis}`} className="flex items-center gap-1.5 px-3 py-0.5">
            <span className="w-3 text-[11px] text-gray-400 shrink-0">{axis.toUpperCase()}</span>
            <ResettableNumberInput
              step={1}
              value={Number.isFinite(displayValue) ? Number(displayValue.toFixed(3)) : 0}
              defaultValue={0}
              onChange={v => {
                const next = (pivotRotation.euler ?? new THREE.Euler()).clone()
                next[localAxis] = sign * v * DEG_TO_RAD
                pivotRotation.onChange(next)
              }}
              className="flex-1 w-0 text-xs border border-gray-300 rounded px-1.5 py-0.5 text-right"
            />
            <span className="w-4 text-[10px] text-gray-400 shrink-0">°</span>
          </div>
        )
      })}
      <div className="flex items-center gap-1.5 px-3 py-1">
        <button
          onClick={pivotRotation.onReset}
          disabled={!pivotRotation.euler}
          title="Restore the file's own original orientation"
          className="flex-1 text-[11px] px-1.5 py-1 rounded border border-gray-300 text-gray-600 disabled:text-gray-300 disabled:border-gray-200 hover:bg-gray-50 disabled:hover:bg-transparent"
        >
          Reset
        </button>
      </div>

      {/* Fields always read X/Y/Z in that order; resolveDisplayAxis (upAxis.ts)
          is what actually points "Y"/"Z" at object.position.z/.y (Blender-
          style) instead of three.js's native .y/.z when upAxis is 'z'. */}
      <SectionLabel label="Location" />
      {pathProgress && (
        <p className="px-3 pb-1 text-[10px] text-gray-400">Position is driven by the bound path — edit points in the Paths panel.</p>
      )}
      {AXES.map(axis => {
        const { localAxis, sign } = resolveDisplayAxis(axis, upAxis, 'position')
        const field = `pos_${axis}` as KeyframeField
        // sign (the Z-up/Y-up axis remap, ±1) and the unit conversion below
        // are both plain linear scalars, so composing them in either order
        // round-trips correctly — display flips sign then converts unit;
        // onChange inverts the unit conversion then flips sign back.
        const displayValue = toDisplayLength(sign * object.position[localAxis], lengthUnitToMetres, unitDisplay)
        return (
          <Field
            key={`pos-${axis}`}
            axisLabel={axis.toUpperCase()}
            value={displayValue}
            resetValue={toDisplayLength(sign * baseline.position[localAxis], lengthUnitToMetres, unitDisplay)}
            suffix={lengthUnitSuffix(lengthUnitToMetres, unitDisplay)}
            locked={!!locked[`pos-${axis}`] || !!pathProgress}
            keyState={pathProgress ? 'disabled' : keyState(field)}
            onChange={v => { object.position[localAxis] = sign * fromDisplayLength(v, lengthUnitToMetres, unitDisplay); onFieldChange() }}
            onToggleLock={() => toggleLocked(`pos-${axis}`)}
            onToggleKey={pathProgress ? null : toggleKey(field, displayValue)}
          />
        )
      })}

      <SectionLabel label="Rotation" />
      {AXES.map(axis => {
        const { localAxis, sign } = resolveDisplayAxis(axis, upAxis, 'rotation')
        const field = `rot_${axis}` as KeyframeField
        const displayValue = sign * object.rotation[localAxis] * RAD_TO_DEG
        return (
          <Field
            key={`rot-${axis}`}
            axisLabel={axis.toUpperCase()}
            value={displayValue}
            resetValue={sign * baselineEuler[localAxis] * RAD_TO_DEG}
            suffix="°"
            locked={!!locked[`rot-${axis}`]}
            keyState={keyState(field)}
            onChange={v => { object.rotation[localAxis] = sign * v * DEG_TO_RAD; onFieldChange() }}
            onToggleLock={() => toggleLocked(`rot-${axis}`)}
            onToggleKey={toggleKey(field, displayValue)}
          />
        )
      })}

      <SectionLabel label="Scale" />
      {AXES.map(axis => {
        const { localAxis } = resolveDisplayAxis(axis, upAxis, 'scale')
        const field = `scale_${axis}` as KeyframeField
        const displayValue = object.scale[localAxis]
        return (
          <Field
            key={`scale-${axis}`}
            axisLabel={axis.toUpperCase()}
            value={displayValue}
            resetValue={baseline.scale[localAxis]}
            suffix=""
            locked={!!locked[`scale-${axis}`]}
            keyState={keyState(field)}
            onChange={v => { object.scale[localAxis] = v; onFieldChange() }}
            onToggleLock={() => toggleLocked(`scale-${axis}`)}
            onToggleKey={toggleKey(field, displayValue)}
          />
        )
      })}
      <div className="h-2" />
    </div>
  )
}
