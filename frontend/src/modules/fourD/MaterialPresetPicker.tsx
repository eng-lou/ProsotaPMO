import { useRef, useState } from 'react'
import axios from 'axios'
import { confirmWithDontAsk } from '@/lib/confirmWithDontAsk'
import {
  EMPTY_MATERIAL_PRESET_CONFIG, textureListToConfig,
  type MaterialPreset, type MaterialPresetConfig,
} from './materialPresets'
import type { CustomTextureSet, TextureSlot } from './customTextures'

interface Props {
  presets: MaterialPreset[]
  loading: boolean
  // The texture set currently applied to the active element/object, if
  // any — the starting point for "Save Current as Preset" (2026-07-09,
  // per Maro: after an Apply to Linked edit, "I can then save this as a
  // preset"). The live CustomTextureSet, not a converted config — each
  // slot's own dataUri gets converted into a real Blob to upload
  // (2026-07-13 fix, see materialPresets.ts's own header on why textures
  // are real files now, not embedded JSON).
  currentTextures: CustomTextureSet
  onApply: (preset: MaterialPreset) => void
  onCreate: (name: string, files: Partial<Record<TextureSlot, Blob>>) => Promise<MaterialPreset>
  onUpdate: (presetId: string, name: string, files: Partial<Record<TextureSlot, Blob>>, clearedSlots: TextureSlot[]) => Promise<void>
  onDelete: (presetId: string) => Promise<void>
}

const SLOTS: { key: TextureSlot; label: string }[] = [
  { key: 'map', label: 'Base Color' },
  { key: 'metalnessMap', label: 'Metallic' },
  { key: 'roughnessMap', label: 'Roughness' },
  { key: 'normalMap', label: 'Normal' },
  { key: 'aoMap', label: 'AO' },
  { key: 'displacementMap', label: 'Displacement' },
]

function EditorSlotRow({ label, name, onUpload, onClear }: {
  label: string; name: string | null; onUpload: (file: File) => void; onClear: () => void
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
      <span className="w-14 text-[10px] text-gray-400 dark:text-prosota-muted shrink-0">{label}</span>
      <button
        onClick={() => inputRef.current?.click()}
        className="flex-1 min-w-0 text-left text-[11px] text-gray-600 dark:text-prosota-muted truncate border border-gray-200 dark:border-prosota-line rounded px-1.5 py-0.5 hover:bg-gray-50 dark:hover:bg-prosota-panel2"
      >
        {name ?? 'None'}
      </button>
      {name && <button onClick={onClear} title="Clear" className="text-gray-400 dark:text-prosota-muted hover:text-red-600 dark:hover:text-red-400 text-xs shrink-0">✕</button>}
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
export function MaterialPresetPicker({ presets, loading, currentTextures, onApply, onCreate, onUpdate, onDelete }: Props) {
  const [editingId, setEditingId] = useState<'new' | string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftConfig, setDraftConfig] = useState<MaterialPresetConfig>(EMPTY_MATERIAL_PRESET_CONFIG)
  // What's actually already saved server-side for this preset, frozen at
  // the moment editing started (2026-07-13 fix) — diffed against the live
  // draftConfig on Save to compute clearedSlots (a slot that was here at
  // the start but is null now, with no replacement upload). Empty for a
  // brand-new preset — nothing exists server-side yet to "clear".
  const [originalConfig, setOriginalConfig] = useState<MaterialPresetConfig>(EMPTY_MATERIAL_PRESET_CONFIG)
  // Real Blobs for slots that need uploading this save — a freshly-picked
  // File (handleUploadSlot) or a Blob extracted from "Save Current as
  // Preset"'s own live dataUris (startNew below). A slot absent here that's
  // *also* absent from clearedSlots-at-save-time means "leave this slot
  // exactly as it already is," the whole point of this split (2026-07-13
  // fix — see materialPresets.ts's own header).
  const [draftFiles, setDraftFiles] = useState<Partial<Record<TextureSlot, Blob>>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startNew = async (seed: CustomTextureSet) => {
    setEditingId('new')
    setDraftName('')
    setOriginalConfig(EMPTY_MATERIAL_PRESET_CONFIG)
    setError(null)
    const config: MaterialPresetConfig = {}
    const files: Partial<Record<TextureSlot, Blob>> = {}
    await Promise.all(Object.entries(seed).map(async ([slot, value]) => {
      if (!value) return
      config[slot as TextureSlot] = { id: '', slot: slot as TextureSlot, name: value.name }
      files[slot as TextureSlot] = await (await fetch(value.dataUri)).blob()
    }))
    setDraftConfig(config)
    setDraftFiles(files)
  }
  const startEdit = (preset: MaterialPreset) => {
    setEditingId(preset.id)
    setDraftName(preset.name)
    const config = textureListToConfig(preset.textures)
    setDraftConfig(config)
    setOriginalConfig(config)
    setDraftFiles({})
    setError(null)
  }
  const cancelEdit = () => setEditingId(null)

  const handleUploadSlot = (slot: TextureSlot, file: File) => {
    setDraftConfig(prev => ({ ...prev, [slot]: { id: '', slot, name: file.name } }))
    setDraftFiles(prev => ({ ...prev, [slot]: file }))
  }
  const handleClearSlot = (slot: TextureSlot) => {
    setDraftConfig(prev => ({ ...prev, [slot]: null }))
    setDraftFiles(prev => { const next = { ...prev }; delete next[slot]; return next })
  }

  const handleSave = async () => {
    if (!draftName.trim()) { setError('Name is required'); return }
    setSaving(true)
    setError(null)
    try {
      // A slot that was present when editing started but is null now, with
      // no replacement queued in draftFiles, needs an explicit clear —
      // anything else (still present, or has a fresh file) is handled by
      // draftFiles/being simply left out of both, per the backend's own
      // "untouched unless mentioned" contract (material_presets.py).
      const clearedSlots = SLOTS.map(s => s.key).filter(slot => originalConfig[slot] && !draftConfig[slot] && !draftFiles[slot])
      if (editingId === 'new') await onCreate(draftName.trim(), draftFiles)
      else if (editingId) await onUpdate(editingId, draftName.trim(), draftFiles, clearedSlots)
      setEditingId(null)
    } catch (err) {
      // Was a bare "Failed to save preset" with the real error discarded
      // entirely (2026-07-13 fix, per Maro saving a preset with several 8K
      // textures — the config's data: URIs can add up to a genuinely large
      // request body, and there was no way to tell "too large"/"timed out"/
      // "server rejected it" apart without this). Same
      // axios.isAxiosError-then-fall-back-to-message shape every other
      // error handler in this module already uses (FourD.tsx's own
      // collectionErrorMessage/clashErrorMessage/etc.).
      const detail = axios.isAxiosError(err) && typeof err.response?.data?.detail === 'string' ? err.response.data.detail : null
      const status = axios.isAxiosError(err) ? err.response?.status ?? (err.code === 'ECONNABORTED' ? 'timeout' : err.message) : null
      setError(detail ? `Failed to save preset: ${detail}` : status ? `Failed to save preset (${status})` : 'Failed to save preset')
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
      <div className="px-3 py-1.5 space-y-1.5 bg-gray-50 dark:bg-prosota-panel2 rounded-md mx-3">
        <input
          value={draftName}
          onChange={e => setDraftName(e.target.value)}
          placeholder="Preset name"
          className="w-full text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5"
        />
        {SLOTS.map(slot => (
          <EditorSlotRow
            key={slot.key}
            label={slot.label}
            name={draftConfig[slot.key]?.name ?? null}
            onUpload={file => handleUploadSlot(slot.key, file)}
            onClear={() => handleClearSlot(slot.key)}
          />
        ))}
        {error && <p className="text-[11px] text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex items-center gap-1.5 pt-0.5">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 text-xs px-2 py-1 rounded-md border border-gray-900 bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={cancelEdit} className="text-xs px-2 py-1 rounded-md border border-gray-300 dark:border-prosota-line bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2">
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
            if (value === '__new__') startNew({})
            else if (value) onApply(presets.find(p => p.id === value)!)
            e.target.value = ''
          }}
          className="flex-1 min-w-0 text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5"
        >
          <option value="" disabled>{loading ? 'Loading presets…' : 'Material preset…'}</option>
          {presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          <option value="__new__">+ New preset…</option>
        </select>
        <button
          onClick={() => startNew(currentTextures)}
          title="Save the currently applied materials as a new preset"
          className="text-xs px-1.5 py-0.5 rounded-md border border-gray-300 dark:border-prosota-line bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2 shrink-0"
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
            <div key={p.id} className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-prosota-muted">
              <span className="flex-1 truncate">{p.name}</span>
              <button onClick={() => startEdit(p)} title="Edit" className="text-gray-400 dark:text-prosota-muted hover:text-gray-700 dark:hover:text-prosota-paper shrink-0">✎</button>
              <button onClick={() => handleDelete(p)} title="Delete" className="text-gray-400 dark:text-prosota-muted hover:text-red-600 dark:hover:text-red-400 shrink-0">🗑</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
