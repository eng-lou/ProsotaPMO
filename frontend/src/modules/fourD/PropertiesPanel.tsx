import { useRef, useState } from 'react'
import * as THREE from 'three'
import type { CustomTextureSet, TextureSlot } from './customTextures'
import { ResettableNumberInput } from './ResettableNumberInput'
import { TextureFields } from './TextureFields'
import { MaterialPresetPicker } from './MaterialPresetPicker'
import type { MaterialPreset, MaterialPresetConfig } from './materialPresets'
import { TransformPanel, type GizmoMode, type KeyframeSupport, type PathProgressSupport } from './TransformPanel'
import { DEFAULT_VIEWER_SETTINGS, type ViewerSettings } from './viewerSettings'
import type { UpAxis } from './upAxis'
import { applyTransformKeepPosition } from './applyTransform'
import type { IfcUnitDisplay } from './ifcUnitDisplay'

interface ActiveObject {
  id: string
  name: string
  sourceUpAxis: UpAxis
  object: THREE.Object3D
}

interface Props {
  open: boolean
  onToggle: () => void
  settings: ViewerSettings
  onSettingsChange: (settings: ViewerSettings) => void
  environmentName: string | null
  onUploadEnvironment: (file: File) => void
  onClearEnvironment: () => void
  environmentError: string | null
  activeObject: ActiveObject | null
  // True when activeObject.object is a specific IFC sub-element rather than
  // the whole model (2026-07-08, per Maro: "the whole ifc model is grouped,
  // even though i select an individual object. using any of the transforms
  // affect the model") — just changes the "Selected: X" label so it's clear
  // which one the Transform fields below are actually editing.
  isElementTransform: boolean
  // Forces a re-render after a Transform field edit (2026-07-08 fix, per
  // Maro: typed 10 into a Location field, the model moved, but the field
  // itself reverted to showing 0) — Field's onChange mutates the THREE
  // object directly with zero React state change, unlike dragging the
  // gizmo (Viewport3D.tsx's TransformControls onChange, which already calls
  // this same callback), so nothing ever told the input to re-read the
  // fresh value — the *next* unrelated re-render (hover, blur, anything)
  // would snap the field back to whatever it showed at its own last render.
  onTransformChange: () => void
  // Location field unit conversion, passed straight through to
  // TransformPanel — see TransformPanel.tsx's own Props header for what
  // null vs a real factor means (2026-07-11, per Maro: "rewire units").
  lengthUnitToMetres: number | null
  unitDisplay: IfcUnitDisplay
  gizmoMode: GizmoMode
  onGizmoModeChange: (mode: GizmoMode) => void
  activeObjectTextures: CustomTextureSet | undefined
  onUploadTexture: (slot: TextureSlot, file: File) => void
  onClearTexture: (slot: TextureSlot) => void
  // Tile Size/Rotation's own forced-rerender, passed straight through to
  // TextureFields — see its own Props header for why this is separate from
  // onTransformChange (which also persists a transform save, meaningless
  // for a texture edit).
  onTextureFieldChange: () => void
  // Clear Materials (2026-07-11) — passed straight through to TextureFields.
  onClearAllTextures: () => void
  // Whether *any* currently-selected element (not just the single primary
  // one activeObjectTextures itself reflects) has a texture override —
  // drives the Clear Materials button's own visibility, so it can't stay
  // hidden just because the primary/last-clicked element happens to carry
  // no override while other selected elements do (2026-07-11 fix, see
  // FourD.tsx's own hasAnyActiveTextureOverride for the full story).
  hasAnyActiveTextureOverride: boolean
  // Material Preset library (2026-07-09, per Maro: "Save the default
  // materials for the whole model... I can then add a new preset which
  // allows me to change the materials, i can save it, edit and delete") —
  // see MaterialPresetPicker.tsx's own header for the full design.
  materialPresets: MaterialPreset[]
  materialPresetsLoading: boolean
  activeMaterialPresetConfig: MaterialPresetConfig
  onApplyMaterialPreset: (config: MaterialPresetConfig) => void
  onCreateMaterialPreset: (name: string, config: MaterialPresetConfig) => Promise<MaterialPreset>
  onUpdateMaterialPreset: (presetId: string, name: string, config: MaterialPresetConfig) => Promise<void>
  onDeleteMaterialPreset: (presetId: string) => Promise<void>
  // Select Linked / Apply to Linked, per channel (2026-07-09, per Maro) —
  // see linkedMaterials.ts's own header. Only available with one specific
  // IFC sub-element active (linkedMaterialsAvailable) — TextureFields.tsx
  // hides the two buttons per row entirely otherwise.
  linkedMaterialsAvailable: boolean
  onSelectLinkedMaterial: (slot: TextureSlot) => void
  onApplyToLinkedMaterial: (slot: TextureSlot) => void
  keyframeSupport: KeyframeSupport | null
  pathProgress: PathProgressSupport | null
  onChangeSourceUpAxis: (axis: UpAxis) => void
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-1">
      <span className="text-xs text-gray-600">{label}</span>
      {children}
    </div>
  )
}

function SectionHeader({ label }: { label: string }) {
  return <div className="px-3 pt-3 pb-1 text-[10px] font-bold text-gray-400 uppercase tracking-wide">{label}</div>
}

// Far-left, collapsible "3D View Properties" panel (2026-07-10, per Maro,
// modelled on his Navisworks reference screenshot) — trimmed to controls
// that actually do something given "the 3D capabilities" this pass actually
// has (see viewerSettings.ts's own note on what's deliberately left out).
export function PropertiesPanel({
  open, onToggle, settings, onSettingsChange, environmentName, onUploadEnvironment, onClearEnvironment, environmentError,
  activeObject, isElementTransform, onTransformChange, lengthUnitToMetres, unitDisplay, gizmoMode, onGizmoModeChange, activeObjectTextures, onUploadTexture, onClearTexture, onTextureFieldChange, onClearAllTextures, hasAnyActiveTextureOverride,
  materialPresets, materialPresetsLoading, activeMaterialPresetConfig, onApplyMaterialPreset,
  onCreateMaterialPreset, onUpdateMaterialPreset, onDeleteMaterialPreset,
  linkedMaterialsAvailable, onSelectLinkedMaterial, onApplyToLinkedMaterial,
  keyframeSupport, pathProgress, onChangeSourceUpAxis,
}: Props) {
  const hdrInputRef = useRef<HTMLInputElement>(null)
  // Apply Transform's own confirmation (2026-07-09, per Maro's doubt that
  // it "recognises the hierarchy") — see applyTransform.ts's own header on
  // why a successful bake is otherwise invisible.
  const [applyTransformResult, setApplyTransformResult] = useState<string | null>(null)
  if (!open) {
    return (
      <button
        onClick={onToggle}
        title="Show 3D View Properties"
        className="w-6 shrink-0 flex items-start justify-center pt-3 bg-white border-r border-gray-200 text-gray-400 hover:text-gray-600"
      >
        ▸
      </button>
    )
  }

  const set = <K extends keyof ViewerSettings>(key: K, value: ViewerSettings[K]) => onSettingsChange({ ...settings, [key]: value })

  return (
    <div className="w-64 shrink-0 bg-white border-r border-gray-200 flex flex-col overflow-y-auto">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 sticky top-0 bg-white">
        <span className="text-sm font-bold text-gray-700">3D View Properties</span>
        <button onClick={onToggle} title="Hide" className="ml-auto text-gray-400 hover:text-gray-600">◂</button>
      </div>

      <SectionHeader label="General" />
      <Row label="Render mode">
        <select
          value={settings.renderMode}
          onChange={e => set('renderMode', e.target.value as ViewerSettings['renderMode'])}
          className="text-xs border border-gray-300 rounded px-1.5 py-0.5"
        >
          <option value="wireframe">Wireframe</option>
          <option value="hiddenLine">Hidden Line</option>
          <option value="flat">Flat Shaded</option>
          <option value="gouraud">Gouraud Shaded</option>
          <option value="shaded">Rendered (PBR)</option>
        </select>
      </Row>
      <Row label="Up Axis">
        <select
          value={settings.upAxis}
          onChange={e => set('upAxis', e.target.value as ViewerSettings['upAxis'])}
          className="text-xs border border-gray-300 rounded px-1.5 py-0.5"
        >
          <option value="z">Z up (Blender)</option>
          <option value="y">Y up (three.js)</option>
        </select>
      </Row>
      <Row label="Field of View">
        <ResettableNumberInput
          min={10} max={120} value={settings.fieldOfView} defaultValue={DEFAULT_VIEWER_SETTINGS.fieldOfView}
          onChange={v => set('fieldOfView', v)}
          className="w-16 text-xs border border-gray-300 rounded px-1.5 py-0.5 text-right"
        />
      </Row>
      <Row label="Clip Start">
        <ResettableNumberInput
          min={0.001} step={0.1} value={settings.clipStart} defaultValue={DEFAULT_VIEWER_SETTINGS.clipStart}
          onChange={v => set('clipStart', v)}
          className="w-16 text-xs border border-gray-300 rounded px-1.5 py-0.5 text-right"
        />
      </Row>
      <Row label="Clip End">
        <ResettableNumberInput
          min={1} step={10} value={settings.clipEnd} defaultValue={DEFAULT_VIEWER_SETTINGS.clipEnd}
          onChange={v => set('clipEnd', v)}
          className="w-16 text-xs border border-gray-300 rounded px-1.5 py-0.5 text-right"
        />
      </Row>

      <SectionHeader label="Visibility" />
      <Row label="Faces">
        <input type="checkbox" checked={settings.showFaces} onChange={e => set('showFaces', e.target.checked)} />
      </Row>
      <Row label="Edges">
        <input type="checkbox" checked={settings.showEdges} onChange={e => set('showEdges', e.target.checked)} />
      </Row>

      <SectionHeader label="Effects" />
      <Row label="Shadows">
        <input type="checkbox" checked={settings.shadows} onChange={e => set('shadows', e.target.checked)} />
      </Row>
      <Row label="Ambient Occlusion">
        <input type="checkbox" checked={settings.ambientOcclusion} onChange={e => set('ambientOcclusion', e.target.checked)} />
      </Row>
      <Row label="Variance Colours">
        <input
          type="checkbox"
          checked={settings.showVarianceColors}
          onChange={e => set('showVarianceColors', e.target.checked)}
          title="Tint elements linked to a baselined Activity by variance_days — red behind schedule, green ahead"
        />
      </Row>
      <Row label="Clash Colours">
        <input
          type="checkbox"
          checked={settings.showClashColors}
          onChange={e => set('showClashColors', e.target.checked)}
          title="Tint elements with an un-approved Clash Detective result red"
        />
      </Row>

      <SectionHeader label="Environment" />
      <div className="px-3 pb-1.5">
        <input
          ref={hdrInputRef}
          type="file"
          accept=".hdr,.exr"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) onUploadEnvironment(file)
          }}
        />
        <div className="flex items-center justify-between gap-2 text-xs text-gray-600">
          <span className="truncate" title={environmentName ?? 'kloofendal_48d_partly_cloudy_puresky_4k.hdr (default)'}>
            {environmentName ?? 'kloofendal (default)'}
          </span>
          {environmentName && (
            <button onClick={onClearEnvironment} title="Revert to default" className="text-gray-400 hover:text-red-600 shrink-0">✕</button>
          )}
        </div>
        <button
          onClick={() => hdrInputRef.current?.click()}
          className="mt-1 w-full text-xs px-2 py-1 rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
        >
          ⬆ Upload HDR/EXR
        </button>
        {environmentError && <p className="mt-1 text-[11px] text-red-600">{environmentError}</p>}
      </div>
      <Row label="Show as background">
        <input type="checkbox" checked={settings.environmentBackground} onChange={e => set('environmentBackground', e.target.checked)} />
      </Row>

      <SectionHeader label="Indicators" />
      <Row label="Grid">
        <input type="checkbox" checked={settings.showGrid} onChange={e => set('showGrid', e.target.checked)} />
      </Row>
      <Row label="Axis Indicator">
        <input type="checkbox" checked={settings.showAxisIndicator} onChange={e => set('showAxisIndicator', e.target.checked)} />
      </Row>

      {activeObject && (
        <>
          <SectionHeader label={isElementTransform ? `Selected element (in ${activeObject.name || 'model'})` : `Selected: ${activeObject.name || 'Object'}`} />
          {/* Fixes a wrongly-guessed import axis without re-importing
              (2026-07-08, per Maro: picking Y up worked for one file, Z up
              for another — same mechanism either way, files just genuinely
              vary, especially FBX). Same two buttons as ImportModelDialog.tsx's
              own Up Axis picker, on purpose — one control, same choice,
              available both at import time and any time after. */}
          <Row label="Source Up Axis">
            <div className="flex gap-1">
              {(['z', 'y'] as const).map(axis => (
                <button
                  key={axis}
                  onClick={() => onChangeSourceUpAxis(axis)}
                  className={`text-[11px] px-1.5 py-0.5 rounded border font-medium ${
                    activeObject.sourceUpAxis === axis ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {axis.toUpperCase()}
                </button>
              ))}
            </div>
          </Row>
          {/* Apply Transform (2026-07-09, per Maro: "allow me to apply
              transforms to the selected object. in essence zeroing out all
              transform parameters while maintaining position") — Blender's
              Ctrl+A "All Transforms": bakes current Location/Rotation/Scale
              into the geometry with zero *visual* change, then resets all
              three fields to 0/0/1 so a later edit starts clean. See
              applyTransform.ts's own header for exactly how the bake works
              for a whole model vs. a single selected sub-element. */}
          <div className="px-3 py-1.5">
            <button
              onClick={() => {
                const count = applyTransformKeepPosition(activeObject.object)
                onTransformChange()
                setApplyTransformResult(
                  isElementTransform
                    ? 'Applied to 1 element.'
                    : `Applied to ${count} element${count === 1 ? '' : 's'} in this model.`,
                )
                setTimeout(() => setApplyTransformResult(null), 4000)
              }}
              title="Bake current Location/Rotation/Scale into the geometry, then reset all three to 0/0/1 — the object stays visually in place"
              className="w-full text-xs px-2 py-1 rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
            >
              Apply Transform
            </button>
            {/* Confirms the bake actually walked the whole hierarchy
                (2026-07-09, per Maro's doubt that it does) — a *successful*
                Apply Transform on a model that was already at the default
                Location/Rotation/Scale produces literally zero visual
                change (that's the operation's whole point: geometry
                absorbs whatever the fields showed so they can reset to
                0/0/1 with nothing moving on screen), which otherwise looks
                indistinguishable from the button silently doing nothing. */}
            {applyTransformResult && (
              <p className="mt-1 text-[11px] text-gray-500">{applyTransformResult}</p>
            )}
          </div>
          <TransformPanel
            object={activeObject.object} mode={gizmoMode} onModeChange={onGizmoModeChange} upAxis={settings.upAxis}
            lengthUnitToMetres={lengthUnitToMetres} unitDisplay={unitDisplay}
            keyframes={keyframeSupport} pathProgress={pathProgress} onFieldChange={onTransformChange}
          />

          <SectionHeader label="Material / Texture" />
          <MaterialPresetPicker
            presets={materialPresets}
            loading={materialPresetsLoading}
            currentConfig={activeMaterialPresetConfig}
            onApply={onApplyMaterialPreset}
            onCreate={onCreateMaterialPreset}
            onUpdate={onUpdateMaterialPreset}
            onDelete={onDeleteMaterialPreset}
          />
          <TextureFields
            textures={activeObjectTextures} onUploadTexture={onUploadTexture} onClearTexture={onClearTexture}
            onFieldChange={onTextureFieldChange} lengthUnitToMetres={lengthUnitToMetres} unitDisplay={unitDisplay}
            onClearAll={onClearAllTextures} hasAnyOverride={hasAnyActiveTextureOverride}
            linkedAvailable={linkedMaterialsAvailable}
            onSelectLinked={onSelectLinkedMaterial}
            onApplyToLinked={onApplyToLinkedMaterial}
          />
        </>
      )}

      <div className="flex-1" />
      <div className="px-3 py-2 border-t border-gray-100 text-[10px] text-gray-400">
        {activeObject
          ? 'IFC sub-element properties (GlobalId, property sets): see the IFC Data tab on the right.'
          : 'Click an object in the viewport to edit its transform and material here.'}
      </div>
    </div>
  )
}
