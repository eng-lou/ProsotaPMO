import { useRef } from 'react'
import type { CustomTextureSet, TextureSlot } from './customTextures'
import { ResettableNumberInput } from './ResettableNumberInput'
import { fromDisplayLength, lengthUnitSuffix, toDisplayLength, type IfcUnitDisplay } from './ifcUnitDisplay'

interface Props {
  textures: CustomTextureSet | undefined
  onUploadTexture: (slot: TextureSlot, file: File) => void
  onClearTexture: (slot: TextureSlot) => void
  // Tile Size/Tile Rotation (2026-07-11, per Maro: applied a concrete
  // texture, got a flat/simplistic look — see ifcModel.ts's own
  // box-projected-UV fix for the underlying cause; rotation added
  // right after) — how many raw model units one texture repeat spans, and
  // how the tile is rotated in place, both shared across every slot below
  // since they represent the same physical surface and should stay
  // UV-aligned. Mutates each slot's live THREE.Texture.repeat/.rotation
  // directly (same "read/write the live object, force a re-render
  // separately" idiom TransformPanel.tsx already uses for object.position)
  // rather than round-tripping through customTextures state — both
  // properties are read by the renderer every frame regardless, no React
  // state needs to own either number. onFieldChange is that forced
  // re-render, purely so these fields' own controlled inputs show the
  // value they were just set to instead of snapping back to a stale prop.
  onFieldChange: () => void
  lengthUnitToMetres: number | null
  unitDisplay: IfcUnitDisplay
  // Clear Materials (2026-07-11, per Maro: "add a clear materials button so
  // i can bulk wipe materials back to imported default") — every slot at
  // once, restoring whatever's active back to its captured original
  // material (see FourD.tsx's own handleClearAllActiveTextures). Only
  // rendered when there's actually something to clear.
  onClearAll: () => void
  // Drives the button's own visibility instead of this component's own
  // local "does the active element's textures prop have anything loaded"
  // check (2026-07-11 fix, per Maro: "clear materials doesnt work on
  // bulk") — `textures` above only ever reflects the single
  // primary/last-clicked element; a bulk pick where *other* selected
  // elements carry an override but the primary one doesn't would otherwise
  // hide this button entirely even though clicking it (FourD.tsx's own
  // resolveActiveTextureKeys) would still have real work to do.
  hasAnyOverride: boolean
  // Select Linked / Apply to Linked, per channel (2026-07-09, per Maro:
  // "select an element for example and select its material, then a button
  // called Select Linked (material), which then selects all the elements
  // with that material... apply to linked... this should obviously be
  // channel specific") — only available with one specific IFC sub-element
  // active (see linkedMaterials.ts's own header for the full design); the
  // two buttons are hidden per row entirely otherwise, not just disabled,
  // since they're meaningless for a whole-object/mesh-kind selection.
  linkedAvailable: boolean
  onSelectLinked: (slot: TextureSlot) => void
  onApplyToLinked: (slot: TextureSlot) => void
  // Manual per-element Opacity (2026-07-26, per Maro: "allow for
  // transparency setting (0-1) for materials so i can simply make the
  // window surfaces less opaque instead of replacing the materials
  // completely") — undefined shows as 1 (fully opaque, matching every
  // element that's never had this touched). A plain 0-1 material property,
  // not a texture asset, so it's rendered independent of whether any
  // texture slot below actually has anything loaded — unlike Tile Size/
  // Rotation, which only make sense once a real texture exists to tile.
  opacity: number | undefined
  onOpacityChange: (value: number) => void
}

const SLOTS: { key: TextureSlot; label: string }[] = [
  { key: 'map', label: 'Base Color' },
  { key: 'metalnessMap', label: 'Metallic' },
  { key: 'roughnessMap', label: 'Roughness' },
  { key: 'normalMap', label: 'Normal' },
  { key: 'aoMap', label: 'AO' },
  { key: 'displacementMap', label: 'Displacement' },
]

function TextureRow({ label, name, onUpload, onClear, linkedAvailable, onSelectLinked, onApplyToLinked }: {
  label: string; name?: string; onUpload: (file: File) => void; onClear: () => void
  linkedAvailable: boolean; onSelectLinked: () => void; onApplyToLinked: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div className="px-3 py-0.5">
      <div className="flex items-center gap-1.5">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) onUpload(file)
          }}
        />
        <span className="w-16 text-[11px] text-gray-400 dark:text-prosota-muted shrink-0">{label}</span>
        <button
          onClick={() => inputRef.current?.click()}
          title={`Upload ${label}`}
          className="flex-1 min-w-0 text-left text-[11px] text-gray-600 dark:text-prosota-muted truncate border border-gray-200 dark:border-prosota-line rounded px-1.5 py-0.5 hover:bg-gray-50 dark:hover:bg-prosota-panel2"
        >
          {name ?? 'None'}
        </button>
        {name && <button onClick={onClear} title="Clear" className="text-gray-400 dark:text-prosota-muted hover:text-red-600 dark:hover:text-red-400 text-xs shrink-0">✕</button>}
      </div>
      {linkedAvailable && (
        <div className="flex items-center gap-1 mt-0.5 pl-[4.5rem]">
          <button
            onClick={onSelectLinked}
            title={`Select every element sharing this element's current ${label} (map or, if none, original colour)`}
            className="text-[10px] px-1.5 py-0.5 rounded border border-gray-200 dark:border-prosota-line text-gray-500 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2"
          >
            Select Linked
          </button>
          <button
            onClick={onApplyToLinked}
            disabled={!name}
            title={name ? `Apply this ${label} to every currently-selected element` : `Set a ${label} first`}
            className="text-[10px] px-1.5 py-0.5 rounded border border-gray-200 dark:border-prosota-line text-gray-500 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Apply to Linked
          </button>
        </div>
      )}
    </div>
  )
}

// Manual per-object texture override — Base Color/Metallic/Roughness/Normal
// (2026-07-11, per Maro: "if I cant get this natively, allow me to import
// textures per model"). Originally lived as an expandable section per row
// in the 3D Data tab's object list (MeshDataPanel.tsx); moved into the "3D
// View Properties" panel as a contextual section for whichever object is
// currently active, alongside TransformPanel.tsx (2026-07-11, per Maro:
// "move the contextual transform panel, object material and texture
// settings in the 3d view properties... so if i select an object, 3d or
// ifc, i can see and change them there") — the underlying override
// (Viewport3D.tsx's ModelObjects effect) was already keyed generically by
// scene-object id regardless of kind, so this now applies to a selected
// IFC model's meshes too, not just plain "Import 3D" ones.
const RAD_TO_DEG = 180 / Math.PI
const DEG_TO_RAD = Math.PI / 180

export function TextureFields({
  textures, onUploadTexture, onClearTexture, onFieldChange, lengthUnitToMetres, unitDisplay, onClearAll, hasAnyOverride,
  linkedAvailable, onSelectLinked, onApplyToLinked, opacity, onOpacityChange,
}: Props) {
  // Any one loaded texture stands in for "the" tile size/rotation — both
  // are set identically across every present slot below (see the two
  // onChange handlers), so reading either back off whichever slot happens
  // to exist first is representative of all of them.
  const representativeTexture = SLOTS.map(s => textures?.[s.key]?.texture).find(t => t)
  const resolvedOpacity = opacity ?? 1
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1.5 px-3 py-0.5">
        <span className="w-16 text-[11px] text-gray-400 dark:text-prosota-muted shrink-0">Opacity</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={resolvedOpacity}
          onChange={e => onOpacityChange(Number(e.target.value))}
          title="0 = fully transparent, 1 = fully opaque (this element's real imported look). Applies to every currently-selected element at once."
          className="flex-1 w-0"
        />
        <span className="w-8 text-[11px] text-gray-500 dark:text-prosota-muted text-right shrink-0">{resolvedOpacity.toFixed(2)}</span>
        {opacity !== undefined && (
          <button onClick={() => onOpacityChange(1)} title="Reset to fully opaque" className="text-gray-400 dark:text-prosota-muted hover:text-red-600 dark:hover:text-red-400 text-xs shrink-0">
            ✕
          </button>
        )}
      </div>
      {hasAnyOverride && (
        <div className="px-3 pb-1 flex justify-end">
          <button
            onClick={onClearAll}
            title="Clear every material slot on every currently-selected element and restore each one's original imported appearance"
            className="text-[10px] px-1.5 py-0.5 rounded border border-gray-200 dark:border-prosota-line text-gray-500 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2 hover:text-red-600 dark:hover:text-red-400 hover:border-red-200"
          >
            Clear Materials
          </button>
        </div>
      )}
      {SLOTS.map(slot => (
        <TextureRow
          key={slot.key}
          label={slot.label}
          name={textures?.[slot.key]?.name}
          onUpload={file => onUploadTexture(slot.key, file)}
          onClear={() => onClearTexture(slot.key)}
          linkedAvailable={linkedAvailable}
          onSelectLinked={() => onSelectLinked(slot.key)}
          onApplyToLinked={() => onApplyToLinked(slot.key)}
        />
      ))}
      {representativeTexture && (
        <div className="flex items-center gap-1.5 px-3 py-0.5">
          <span className="w-16 text-[11px] text-gray-400 dark:text-prosota-muted shrink-0">Tile Size</span>
          <ResettableNumberInput
            step={0.5}
            min={0.01}
            value={Number(toDisplayLength(1 / (representativeTexture.repeat.x || 1), lengthUnitToMetres, unitDisplay).toFixed(3))}
            defaultValue={Number(toDisplayLength(1, lengthUnitToMetres, unitDisplay).toFixed(3))}
            title="How large one texture repeat looks on the real surface — smaller tiles repeat the image more often, larger tiles stretch it further. Hover + Backspace to reset."
            onChange={displaySize => {
              const rawSize = fromDisplayLength(displaySize, lengthUnitToMetres, unitDisplay)
              const repeat = rawSize > 0 ? 1 / rawSize : 1
              for (const s of SLOTS) textures?.[s.key]?.texture.repeat.set(repeat, repeat)
              onFieldChange()
            }}
            className="flex-1 w-0 text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5 text-right"
          />
          <span className="w-4 text-[10px] text-gray-400 dark:text-prosota-muted shrink-0">{lengthUnitSuffix(lengthUnitToMetres, unitDisplay)}</span>
        </div>
      )}
      {representativeTexture && (
        <div className="flex items-center gap-1.5 px-3 py-0.5">
          <span className="w-16 text-[11px] text-gray-400 dark:text-prosota-muted shrink-0">Tile Rotation</span>
          <ResettableNumberInput
            step={5}
            value={Number((representativeTexture.rotation * RAD_TO_DEG).toFixed(1))}
            defaultValue={0}
            title="Rotates the tile in place around its own centre (not the whole surface). Hover + Backspace to reset."
            onChange={degrees => {
              const radians = degrees * DEG_TO_RAD
              for (const s of SLOTS) {
                const t = textures?.[s.key]?.texture
                if (t) t.rotation = radians
              }
              onFieldChange()
            }}
            className="flex-1 w-0 text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5 text-right"
          />
          <span className="w-4 text-[10px] text-gray-400 dark:text-prosota-muted shrink-0">°</span>
        </div>
      )}
      {textures?.displacementMap && (
        <div className="flex items-center gap-1.5 px-3 py-0.5">
          <span className="w-16 text-[11px] text-gray-400 dark:text-prosota-muted shrink-0">Subdivision</span>
          <ResettableNumberInput
            step={1}
            min={0}
            max={3}
            value={Math.round((textures.displacementMap.texture.userData.subdivisionLevel as number | undefined) ?? 0)}
            defaultValue={0}
            title="Adds geometry detail so Displacement has vertices to actually move — most IFC elements are otherwise too low-poly to show any effect. 0 leaves the original geometry untouched. Capped per element and scene-wide so this can't overload the viewport — a level may be silently reduced on an already-dense element, or if too many elements have subdivision active at once. Hover + Backspace to reset."
            onChange={level => {
              const clamped = Math.max(0, Math.min(3, Math.round(level)))
              if (textures?.displacementMap) textures.displacementMap.texture.userData.subdivisionLevel = clamped
              onFieldChange()
            }}
            className="flex-1 w-0 text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5 text-right"
          />
        </div>
      )}
    </div>
  )
}
