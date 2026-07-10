import { useRef, useState } from 'react'
import { confirmWithDontAsk } from '@/lib/confirmWithDontAsk'
import {
  EMPTY_MATERIAL_PRESET_CONFIG, fileToDataUri,
  type MaterialPreset, type MaterialPresetConfig, type MaterialPresetSlot,
} from './materialPresets'
import type { TextureSlot } from './customTextures'

interface Props {
  presets: MaterialPreset[]
  loading: boolean
  // The config currently applied to the active element/object, if any —
  // used as the starting point for "Save Current as Preset" (2026-07-09,
  // per Maro: after an Apply to Linked edit, "I can then save this as a
  // preset").
  currentConfig: MaterialPresetConfig
  onApply: (config: MaterialPresetConfig) => void
  onCreate: (name: string, config: MaterialPresetConfig) => Promise<MaterialPreset>
  onUpdate: (presetId: string, name: string, config: MaterialPresetConfig) => Promise<void>
  onDelete: (presetId: string) => Promise<void>
}

const SLOTS: { key: TextureSlot; label: string }[] = [
  { key: 'map', label: 'Base Color' },
  { key: 'metalnessMap', label: 'Metallic' },
  { key: 'roughnessMap', label: 'Roughness' },
  { key: 'normalMap', label: 'Normal' },
]

function EditorSlotRow({ label, value, onUpload, onClear }: {
  label: string; value: MaterialPresetSlot | null; onUpload: (file: File) => void; onClear: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
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
      <span className="w-14 text-[10px] text-gray-400 shrink-0">{label}</span>
      <button
        onClick={() => inputRef.current?.click()}
        className="flex-1 min-w-0 text-left text-[11px] text-gray-600 truncate border border-gray-200 rounded px-1.5 py-0.5 hover:bg-gray-50"
      >
        {value?.name ?? 'None'}
      </button>
      {value && <button onClick={onClear} title="Clear" className="text-gray-400 hover:text-red-600 text-xs shrink-0">✕</button>}
    </div>
  )
}

// Material Preset library (2026-07-09, per Maro: "Save the default
// materials for the whole model. when i click an element, i should see the
// material preset drop down. I can then add a new preset which allows me
// to change the materials, i can save it, edit and delete. So if i choose
// i can toggle between different materials I've saved and apply the one i
// want while not losing the original ones") — sits above TextureFields.tsx
// in PropertiesPanel.tsx's Material/Texture section. Presets never touch
// the element's own *original* material (elementBaseline.ts's own
// captureOriginalMaterial, restored automatically whenever a texture slot
// has no active override) — applying/switching/deleting a preset only ever
// changes the current customTextures override, so the original is always
// one "None"/clear away.
export function MaterialPresetPicker({ presets, loading, currentConfig, onApply, onCreate, onUpdate, onDelete }: Props) {
  const [editingId, setEditingId] = useState<'new' | string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftConfig, setDraftConfig] = useState<MaterialPresetConfig>(EMPTY_MATERIAL_PRESET_CONFIG)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startNew = (seed: MaterialPresetConfig) => {
    setEditingId('new')
    setDraftName('')
    setDraftConfig(seed)
    setError(null)
  }
  const startEdit = (preset: MaterialPreset) => {
    setEditingId(preset.id)
    setDraftName(preset.name)
    setDraftConfig(preset.config)
    setError(null)
  }
  const cancelEdit = () => setEditingId(null)

  const handleUploadSlot = async (slot: TextureSlot, file: File) => {
    try {
      const data_uri = await fileToDataUri(file)
      setDraftConfig(prev => ({ ...prev, [slot]: { data_uri, name: file.name } }))
    } catch {
      setError('Failed to read image file')
    }
  }
  const handleClearSlot = (slot: TextureSlot) => setDraftConfig(prev => ({ ...prev, [slot]: null }))

  const handleSave = async () => {
    if (!draftName.trim()) { setError('Name is required'); return }
    setSaving(true)
    setError(null)
    try {
      if (editingId === 'new') await onCreate(draftName.trim(), draftConfig)
      else if (editingId) await onUpdate(editingId, draftName.trim(), draftConfig)
      setEditingId(null)
    } catch {
      setError('Failed to save preset')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (preset: MaterialPreset) => {
    const ok = await confirmWithDontAsk('delete-material-preset', `Delete material preset "${preset.name}"?`)
    if (!ok) return
    await onDelete(preset.id)
    if (editingId === preset.id) setEditingId(null)
  }

  if (editingId !== null) {
    return (
      <div className="px-3 py-1.5 space-y-1.5 bg-gray-50 rounded-md mx-3">
        <input
          value={draftName}
          onChange={e => setDraftName(e.target.value)}
          placeholder="Preset name"
          className="w-full text-xs border border-gray-300 rounded px-1.5 py-0.5"
        />
        {SLOTS.map(slot => (
          <EditorSlotRow
            key={slot.key}
            label={slot.label}
            value={draftConfig[slot.key]}
            onUpload={file => handleUploadSlot(slot.key, file)}
            onClear={() => handleClearSlot(slot.key)}
          />
        ))}
        {error && <p className="text-[11px] text-red-600">{error}</p>}
        <div className="flex items-center gap-1.5 pt-0.5">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 text-xs px-2 py-1 rounded-md border border-gray-900 bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={cancelEdit} className="text-xs px-2 py-1 rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="px-3 py-1.5 flex items-center gap-1.5">
        <select
          value=""
          disabled={loading}
          onChange={e => {
            const value = e.target.value
            if (value === '__new__') startNew(EMPTY_MATERIAL_PRESET_CONFIG)
            else if (value) onApply(presets.find(p => p.id === value)!.config)
            e.target.value = ''
          }}
          className="flex-1 min-w-0 text-xs border border-gray-300 rounded px-1.5 py-0.5"
        >
          <option value="" disabled>{loading ? 'Loading presets…' : 'Material preset…'}</option>
          {presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          <option value="__new__">+ New preset…</option>
        </select>
        <button
          onClick={() => startNew(currentConfig)}
          title="Save the currently applied materials as a new preset"
          className="text-xs px-1.5 py-0.5 rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 shrink-0"
        >
          💾
        </button>
      </div>
      {/* Row-level edit/delete (2026-07-09) — a separate small list beneath
          the dropdown rather than icons inside it (native <option>
          elements can't host buttons); only shown once there's something
          to manage. */}
      {presets.length > 0 && (
        <div className="px-3 pb-1.5 space-y-0.5">
          {presets.map(p => (
            <div key={p.id} className="flex items-center gap-1.5 text-[11px] text-gray-500">
              <span className="flex-1 truncate">{p.name}</span>
              <button onClick={() => startEdit(p)} title="Edit" className="text-gray-400 hover:text-gray-700 shrink-0">✎</button>
              <button onClick={() => handleDelete(p)} title="Delete" className="text-gray-400 hover:text-red-600 shrink-0">🗑</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
