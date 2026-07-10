import { useRef } from 'react'
import type { CustomTextureSet, TextureSlot } from './customTextures'

interface Props {
  textures: CustomTextureSet | undefined
  onUploadTexture: (slot: TextureSlot, file: File) => void
  onClearTexture: (slot: TextureSlot) => void
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
}

const SLOTS: { key: TextureSlot; label: string }[] = [
  { key: 'map', label: 'Base Color' },
  { key: 'metalnessMap', label: 'Metallic' },
  { key: 'roughnessMap', label: 'Roughness' },
  { key: 'normalMap', label: 'Normal' },
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
        <span className="w-16 text-[11px] text-gray-400 shrink-0">{label}</span>
        <button
          onClick={() => inputRef.current?.click()}
          title={`Upload ${label}`}
          className="flex-1 min-w-0 text-left text-[11px] text-gray-600 truncate border border-gray-200 rounded px-1.5 py-0.5 hover:bg-gray-50"
        >
          {name ?? 'None'}
        </button>
        {name && <button onClick={onClear} title="Clear" className="text-gray-400 hover:text-red-600 text-xs shrink-0">✕</button>}
      </div>
      {linkedAvailable && (
        <div className="flex items-center gap-1 mt-0.5 pl-[4.5rem]">
          <button
            onClick={onSelectLinked}
            title={`Select every element sharing this element's current ${label} (map or, if none, original colour)`}
            className="text-[10px] px-1.5 py-0.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-50"
          >
            Select Linked
          </button>
          <button
            onClick={onApplyToLinked}
            disabled={!name}
            title={name ? `Apply this ${label} to every currently-selected element` : `Set a ${label} first`}
            className="text-[10px] px-1.5 py-0.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
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
export function TextureFields({ textures, onUploadTexture, onClearTexture, linkedAvailable, onSelectLinked, onApplyToLinked }: Props) {
  return (
    <div className="space-y-0.5">
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
    </div>
  )
}
