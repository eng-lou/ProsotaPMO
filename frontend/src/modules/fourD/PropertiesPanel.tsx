import { EquipmentPivotControls } from './EquipmentPivotControls'
import type { EquipmentVisualState } from './EquipmentVisualEditor'
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { ColorPickerPopover, normalizeHex } from '@/components/ColorPickerPopover'
import { ResettableNumberInput } from './ResettableNumberInput'
import { TransformPanel, type GizmoMode, type GizmoSpace, type KeyframeSupport, type PathProgressSupport, type PivotRotationSupport, type PivotSupport } from './TransformPanel'
import { DEFAULT_VIEWER_SETTINGS, type ViewerSettings } from './viewerSettings'
import type { UpAxis } from './upAxis'
import { applyTransformKeepPosition } from './applyTransform'
import type { IfcUnitDisplay } from './ifcUnitDisplay'

interface ActiveObject {
  isSite?: boolean
  locked?: boolean
  id: string
  name: string
  sourceUpAxis: UpAxis
  object: THREE.Object3D
}

interface Props {
  siteSelectionPanel?: React.ReactNode
  equipmentPivot?: { state: EquipmentVisualState; root: THREE.Object3D } | null
  open: boolean
  onToggle: () => void
  settings: ViewerSettings
  onSettingsChange: (settings: ViewerSettings) => void
  // Realistic Materials' own dock panel (mapping + glass) — shown
  // automatically with the mode; this only offers reopening it once closed.
  realisticPanelOpen: boolean
  onOpenRealisticPanel: () => void
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
  gizmoSpace: GizmoSpace
  onGizmoSpaceChange: (space: GizmoSpace) => void
  editPivot: boolean
  onEditPivotChange: (editPivot: boolean) => void
  snapToSurface: boolean
  onSnapToSurfaceChange: (snap: boolean) => void
  keyframeSupport: KeyframeSupport | null
  pathProgress: PathProgressSupport | null
  pivot: PivotSupport
  pivotRotation: PivotRotationSupport
  onChangeSourceUpAxis: (axis: UpAxis) => void
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-1">
      <span className="text-xs text-gray-600 dark:text-prosota-muted">{label}</span>
      {children}
    </div>
  )
}

// Solid Background's colour (2026-10-03, per Maro: "give me the option of
// picking not just white but any other color, use the color picker style
// settings in the profile") — the same swatch + hex box + page-level picker
// as the animation profile editor's colour fields.
function BackgroundColorField({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const swatchRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { setDraft(value) }, [value])
  const commitDraft = () => {
    const hex = normalizeHex(draft)
    if (hex) onChange(hex)
    else setDraft(value)
  }
  return (
    <div className="flex items-center gap-1">
      <button
        ref={swatchRef}
        onClick={() => setOpen(v => !v)}
        title="Pick background colour"
        className="w-5 h-5 rounded border border-gray-300 dark:border-prosota-line shrink-0"
        style={{ backgroundColor: value }}
      />
      <input
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commitDraft}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitDraft() } }}
        spellCheck={false}
        aria-label="Background hex colour"
        className="w-[4.75rem] text-xs font-mono border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1 py-0.5"
      />
      {open && (
        <ColorPickerPopover value={value} onChange={onChange} onClose={() => setOpen(false)} anchor={swatchRef.current} />
      )}
    </div>
  )
}

function SectionHeader({ label }: { label: string }) {
  return <div className="px-3 pt-3 pb-1 text-[10px] font-bold text-gray-400 dark:text-prosota-muted uppercase tracking-wide">{label}</div>
}

// Far-left, collapsible "3D View Properties" panel (2026-07-10, per Maro,
// modelled on his Navisworks reference screenshot) — trimmed to controls
// that actually do something given "the 3D capabilities" this pass actually
// has (see viewerSettings.ts's own note on what's deliberately left out).
export function PropertiesPanel({
  siteSelectionPanel, open, onToggle, settings, onSettingsChange, realisticPanelOpen, onOpenRealisticPanel,
  environmentName, onUploadEnvironment, onClearEnvironment, environmentError,
  equipmentPivot, activeObject, isElementTransform, onTransformChange, lengthUnitToMetres, unitDisplay, gizmoMode, onGizmoModeChange, gizmoSpace, onGizmoSpaceChange, editPivot, onEditPivotChange, snapToSurface, onSnapToSurfaceChange,
  keyframeSupport, pathProgress, pivot, pivotRotation, onChangeSourceUpAxis,
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
        className="w-6 shrink-0 flex items-start justify-center pt-3 bg-white dark:bg-prosota-panel border-r border-gray-200 dark:border-prosota-line text-gray-400 dark:text-prosota-muted hover:text-gray-600 dark:hover:text-prosota-paper"
      >
        ▸
      </button>
    )
  }

  const set = <K extends keyof ViewerSettings>(key: K, value: ViewerSettings[K]) => onSettingsChange({ ...settings, [key]: value })

  return (
    <div className="w-64 shrink-0 bg-white dark:bg-prosota-panel border-r border-gray-200 dark:border-prosota-line flex flex-col overflow-y-auto">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-prosota-line sticky top-0 bg-white dark:bg-prosota-panel">
        <span className="text-sm font-bold text-gray-700 dark:text-prosota-muted">3D View Properties</span>
        <button onClick={onToggle} title="Hide" className="ml-auto text-gray-400 dark:text-prosota-muted hover:text-gray-600 dark:hover:text-prosota-paper">◂</button>
      </div>

      <SectionHeader label="General" />
      <Row label="Render mode">
        <select
          value={settings.renderMode}
          onChange={e => {
            const renderMode = e.target.value as ViewerSettings['renderMode']
            // Switching INTO Realistic turns on the lighting that makes it
            // read as realistic (2026-10-02, per Maro: "I want realistic
            // lighting too") — sun shadows, the sun-synced sky (unless an
            // HDR is uploaded; that's the user's chosen sky), contact AO,
            // and drops the flat white backdrop. A one-time preset, not a
            // lock: each stays individually toggleable afterwards.
            if (renderMode === 'realistic' && settings.renderMode !== 'realistic') {
              onSettingsChange({
                ...settings, renderMode,
                shadows: true, ambientOcclusion: true, whiteBackground: false, environmentBackground: true,
                dynamicSky: environmentName ? settings.dynamicSky : true,
              })
            } else {
              set('renderMode', renderMode)
            }
          }}
          className="text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5"
        >
          <option value="hiddenLine">Hidden Line</option>
          <option value="flat">Flat Shaded</option>
          <option value="gouraud">Gouraud Shaded</option>
          <option value="shaded">Rendered (PBR)</option>
          <option value="realistic">Realistic Materials</option>
        </select>
      </Row>
      {!realisticPanelOpen && (
        <Row label="Materials">
          <button
            onClick={onOpenRealisticPanel}
            className="text-xs px-2 py-0.5 rounded border border-gray-300 dark:border-prosota-line text-gray-600 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2"
          >
            Open panel
          </button>
        </Row>
      )}
      <Row label="Projection">
        <select
          value={settings.orthographic ? 'ortho' : 'persp'}
          onChange={e => set('orthographic', e.target.value === 'ortho')}
          title="Perspective or orthographic view — Numpad 5 toggles it, like Blender"
          className="text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5"
        >
          <option value="persp">Perspective</option>
          <option value="ortho">Orthographic</option>
        </select>
      </Row>
      <Row label="Up Axis">
        <select
          value={settings.upAxis}
          onChange={e => set('upAxis', e.target.value as ViewerSettings['upAxis'])}
          className="text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5"
        >
          <option value="z">Z up (Blender)</option>
          <option value="y">Y up (three.js)</option>
        </select>
      </Row>
      <Row label="Field of View">
        <ResettableNumberInput
          min={10} max={120} value={settings.fieldOfView} defaultValue={DEFAULT_VIEWER_SETTINGS.fieldOfView}
          onChange={v => set('fieldOfView', v)}
          className="w-16 text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5 text-right"
        />
      </Row>
      <Row label="Clip Start">
        <ResettableNumberInput
          min={0.001} step={0.1} value={settings.clipStart} defaultValue={DEFAULT_VIEWER_SETTINGS.clipStart}
          onChange={v => set('clipStart', v)}
          className="w-16 text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5 text-right"
        />
      </Row>
      <Row label="Clip End">
        <ResettableNumberInput
          min={1} step={10} value={settings.clipEnd} defaultValue={DEFAULT_VIEWER_SETTINGS.clipEnd}
          onChange={v => set('clipEnd', v)}
          className="w-16 text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5 text-right"
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
      {(settings.shadows || settings.dynamicSky) && (
        <>
          <Row label="Sun Azimuth">
            <div className="flex items-center gap-1.5 w-full">
              <input
                type="range" min={0} max={360} step={5} value={settings.sunAzimuth}
                onChange={e => set('sunAzimuth', Number(e.target.value))}
                className="flex-1 w-0"
              />
              <span className="text-xs text-gray-500 dark:text-prosota-muted w-8 text-right shrink-0">{settings.sunAzimuth}°</span>
            </div>
          </Row>
          <Row label="Sun Elevation">
            <div className="flex items-center gap-1.5 w-full">
              <input
                type="range" min={5} max={85} step={5} value={settings.sunElevation}
                onChange={e => set('sunElevation', Number(e.target.value))}
                className="flex-1 w-0"
              />
              <span className="text-xs text-gray-500 dark:text-prosota-muted w-8 text-right shrink-0">{settings.sunElevation}°</span>
            </div>
          </Row>
        </>
      )}
      <Row label="Real-Time Sky">
        <input
          type="checkbox"
          checked={settings.dynamicSky}
          onChange={e => set('dynamicSky', e.target.checked)}
          title="Procedural sky synced to Sun Azimuth/Elevation, replacing the static HDR — the visible sky, its lighting, and cast shadows all move together with the sun controls. A real, ongoing GPU cost, off by default"
        />
      </Row>
      {settings.renderMode === 'realistic' && (
        <Row label="Ground">
          <input
            type="checkbox"
            checked={settings.realisticGround}
            onChange={e => set('realisticGround', e.target.checked)}
            title="Textured ground under the model that catches the sun's shadow (Realistic Materials mode)"
          />
        </Row>
      )}
      <Row label="Simplify while orbiting">
        <input
          type="checkbox"
          checked={settings.simplifyWhileOrbiting}
          onChange={e => set('simplifyWhileOrbiting', e.target.checked)}
          title="While you drag to orbit, hide elements too small to see (mostly MEP fittings) so the view stays smooth — everything comes back the moment you let go"
        />
      </Row>
      <Row label="Ambient Occlusion">
        <input
          type="checkbox"
          checked={settings.ambientOcclusion}
          onChange={e => set('ambientOcclusion', e.target.checked)}
          title="Shades corners/crevices realistically using contact occlusion (N8AO) — a real GPU cost, off by default"
        />
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
      <Row label="Fade Unselected">
        <input
          type="checkbox"
          checked={settings.xrayUnselected}
          onChange={e => set('xrayUnselected', e.target.checked)}
          title="While something is selected, fade everything else so an occluded selection still shows through"
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
        <div className="flex items-center justify-between gap-2 text-xs text-gray-600 dark:text-prosota-muted">
          <span className="truncate" title={environmentName ?? 'No HDR: studio lighting on a white background (default)'}>
            {environmentName ?? 'Studio light (default)'}
          </span>
          {environmentName && (
            <button onClick={onClearEnvironment} title="Revert to default" className="text-gray-400 dark:text-prosota-muted hover:text-red-600 dark:hover:text-red-400 shrink-0">✕</button>
          )}
        </div>
        <button
          onClick={() => hdrInputRef.current?.click()}
          className="mt-1 w-full text-xs px-2 py-1 rounded-md border border-gray-300 dark:border-prosota-line bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2"
        >
          ⬆ Upload HDR/EXR
        </button>
        {environmentError && <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{environmentError}</p>}
      </div>
      <Row label="Show as background">
        <input type="checkbox" checked={settings.environmentBackground} onChange={e => set('environmentBackground', e.target.checked)} />
      </Row>
      <Row label="Solid Background">
        <div className="flex items-center gap-1.5">
          {settings.whiteBackground && (
            <BackgroundColorField value={settings.backgroundColor} onChange={hex => set('backgroundColor', hex)} />
          )}
          <input
            type="checkbox"
            checked={settings.whiteBackground}
            onChange={e => set('whiteBackground', e.target.checked)}
            title="Plain colour backdrop instead of the HDR sky. Lighting is unaffected either way."
          />
        </div>
      </Row>

      <SectionHeader label="Indicators" />
      <Row label="Grid">
        <input type="checkbox" checked={settings.showGrid} onChange={e => set('showGrid', e.target.checked)} />
      </Row>
      <Row label="Axis Indicator">
        <input type="checkbox" checked={settings.showAxisIndicator} onChange={e => set('showAxisIndicator', e.target.checked)} />
      </Row>

      <SectionHeader label="Site Context (Tiles)" />
      <Row label="Tile Detail">
        <div className="flex items-center gap-1.5 w-full" title="Google Photorealistic 3D Tiles' own screen-space error target — lower forces finer, more detailed tiles to load at close zoom (more download/GPU cost); higher accepts coarser geometry sooner. Doesn't fix mesh decimation entirely (Google may simply not have finer tiles for a given spot) but reduces how aggressively it settles for a coarse one.">
          <input
            type="range" min={2} max={32} step={1} value={settings.tilesErrorTarget}
            onChange={e => set('tilesErrorTarget', Number(e.target.value))}
            className="flex-1 w-0"
          />
          <span className="text-xs text-gray-500 dark:text-prosota-muted w-16 text-right shrink-0">{settings.tilesErrorTarget}px</span>
        </div>
      </Row>
      <Row label="Tile Cache">
        <div className="flex items-center gap-1.5 w-full" title="How much loaded tile geometry stays resident in memory before older tiles are evicted. A larger cache keeps high-detail tiles loaded while orbiting a small area instead of re-downloading/re-coarsening them.">
          <input
            type="range" min={200} max={2000} step={100} value={settings.tilesCacheSizeMb}
            onChange={e => set('tilesCacheSizeMb', Number(e.target.value))}
            className="flex-1 w-0"
          />
          <span className="text-xs text-gray-500 dark:text-prosota-muted w-16 text-right shrink-0">{settings.tilesCacheSizeMb} MB</span>
        </div>
      </Row>

      {equipmentPivot && <EquipmentPivotControls upAxis={settings.upAxis} state={equipmentPivot.state} root={equipmentPivot.root} mode={gizmoMode} space={gizmoSpace} onMode={onGizmoModeChange} onSpace={onGizmoSpaceChange} />}
      {siteSelectionPanel}
      {activeObject && !equipmentPivot && (
        <>
          <SectionHeader label={isElementTransform ? `Selected element (in ${activeObject.name || 'model'})` : `Selected: ${activeObject.name || 'Object'}`} />
          {/* Fixes a wrongly-guessed import axis without re-importing
              (2026-07-08, per Maro: picking Y up worked for one file, Z up
              for another — same mechanism either way, files just genuinely
              vary, especially FBX). Same two buttons as ImportModelDialog.tsx's
              own Up Axis picker, on purpose — one control, same choice,
              available both at import time and any time after. */}
          <fieldset disabled={activeObject.locked} className="min-w-0">
          {activeObject.locked && <p className="px-3 text-xs">Unlock this object in Site Tools to edit it.</p>}
          {!activeObject.isSite && <Row label="Source Up Axis">
            <div className="flex gap-1">
              {(['z', 'y'] as const).map(axis => (
                <button
                  key={axis}
                  onClick={() => onChangeSourceUpAxis(axis)}
                  className={`text-[11px] px-1.5 py-0.5 rounded border font-medium ${
                    activeObject.sourceUpAxis === axis ? 'bg-gray-900 text-white border-gray-900' : 'bg-white dark:bg-prosota-panel text-gray-500 dark:text-prosota-muted border-gray-300 dark:border-prosota-line hover:bg-gray-50 dark:hover:bg-prosota-panel2'
                  }`}
                >
                  {axis.toUpperCase()}
                </button>
              ))}
            </div>
          </Row>}
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
              className="w-full text-xs px-2 py-1 rounded-md border border-gray-300 dark:border-prosota-line bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2"
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
              <p className="mt-1 text-[11px] text-gray-500 dark:text-prosota-muted">{applyTransformResult}</p>
            )}
          </div>
          <TransformPanel
            object={activeObject.object} mode={gizmoMode} onModeChange={onGizmoModeChange}
            space={gizmoSpace} onSpaceChange={onGizmoSpaceChange}
            editPivot={editPivot} onEditPivotChange={onEditPivotChange}
            snapToSurface={snapToSurface} onSnapToSurfaceChange={onSnapToSurfaceChange} upAxis={activeObject.isSite ? 'y' : settings.upAxis}
            lengthUnitToMetres={lengthUnitToMetres} unitDisplay={unitDisplay}
            keyframes={keyframeSupport} pathProgress={pathProgress} pivot={pivot} pivotRotation={pivotRotation} onFieldChange={onTransformChange}
          />

          </fieldset>
          <button className="mx-3 my-2 rounded border border-prosota-line px-2 py-1 text-xs" onClick={onOpenRealisticPanel}>Open Materials</button>
        </>
      )}

      <div className="flex-1" />
      <div className="px-3 py-2 border-t border-gray-100 dark:border-prosota-line text-[10px] text-gray-400 dark:text-prosota-muted">
        {activeObject
          ? 'IFC sub-element properties (GlobalId, property sets): see the IFC Data tab on the right.'
          : 'Click an object in the viewport to edit its transform and material here.'}
      </div>
    </div>
  )
}
