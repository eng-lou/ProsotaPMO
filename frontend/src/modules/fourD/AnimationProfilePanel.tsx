import { useRef, useState } from 'react'
import { confirmWithDontAsk } from '@/lib/confirmWithDontAsk'
import { downloadJson, readJsonFile } from '@/lib/exportImport'
import { AnimationProfileEditor } from './AnimationProfileEditor'
import { BUILTIN_PRESETS, DEFAULT_ANIMATION_CONFIG, type AnimationProfile, type AnimationProfileConfig } from './animationProfiles'

interface Props {
  profiles: AnimationProfile[]
  loading: boolean
  onCreate: (name: string, config: AnimationProfileConfig) => Promise<AnimationProfile>
  onUpdate: (id: string, name: string, config: AnimationProfileConfig) => void
  onDelete: (id: string) => void
}

interface Draft {
  id: string | null // null = creating new, otherwise editing this saved profile's id
  name: string
  config: AnimationProfileConfig
}

function isAnimationProfileConfig(v: unknown): v is AnimationProfileConfig {
  return typeof v === 'object' && v !== null && 'transform_kind' in v && 'interpolation' in v
}

// Library of reusable animation recipes — built-ins (BUILTIN_PRESETS, read-
// only) plus a project's own saved/customised profiles (2026-07-11, per
// Maro: "Users can be able to create their own unique profiles and import/
// export/edit/save etc."). Originally a toolbar popover (AnimationProfileMenu);
// converted to a dockable side panel (2026-07-11, per Maro: "make the
// profile widget dockable but for the left or right panels") — same
// left/right dock-toggle pattern as the windowDock side on Schedule/Gantt/
// etc. windows, just for a side column instead of a top/bottom dock.
//
// Content-only (2026-07-09) — the outer w-72/border/header chrome (title,
// dock-toggle, close) moved out to SideDock.tsx when Section Box got the
// same dockable treatment (per Maro: "make section contextual like
// profiles... effectively sharing a side dock if i want") — SideDock.tsx
// owns the chrome for both panels now, and shares one w-72 slot between
// them as a small tab strip whenever they land on the same side, rather
// than each hand-rolling its own chrome the way this component used to.
export function AnimationProfilePanel({ profiles, loading, onCreate, onUpdate, onDelete }: Props) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)

  const save = async (name: string, config: AnimationProfileConfig) => {
    if (!draft) return
    try {
      setError(null)
      if (draft.id) await onUpdate(draft.id, name, config)
      else await onCreate(name, config)
      setDraft(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save animation profile')
    }
  }

  const handleDelete = async (profile: AnimationProfile) => {
    if (!(await confirmWithDontAsk('fourD.animation-profile-delete', `Delete the animation profile "${profile.name}"? Any links using it revert to no profile.`))) return
    onDelete(profile.id)
  }

  const handleImport = async (file: File) => {
    try {
      setError(null)
      const parsed = await readJsonFile(file)
      const obj = parsed as { name?: unknown; config?: unknown }
      if (typeof obj.name !== 'string' || !isAnimationProfileConfig(obj.config)) {
        throw new Error(`"${file.name}" isn't a recognised animation profile export.`)
      }
      await onCreate(obj.name, obj.config)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import animation profile')
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-2">
      {draft ? (
        <AnimationProfileEditor
          name={draft.name}
          config={draft.config}
          onSave={save}
          onCancel={() => setDraft(null)}
          saveLabel={draft.id ? 'Update Profile' : 'Save Profile'}
        />
      ) : (
        <>
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide px-1 pt-1">Built-in</div>
          {BUILTIN_PRESETS.map(preset => (
            <div key={preset.name} className="flex items-center gap-1.5 py-1 px-1">
              <span className="flex-1 min-w-0 truncate text-xs text-gray-500" title={preset.name}>{preset.name}</span>
              <button
                onClick={() => setDraft({ id: null, name: preset.name, config: preset.config })}
                title="Duplicate to customise and save"
                className="text-xs text-gray-400 hover:text-gray-700 shrink-0"
              >
                + Save
              </button>
            </div>
          ))}

          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide px-1 pt-2">Your profiles</div>
          {loading && <p className="px-1 py-2 text-xs text-gray-400">Loading…</p>}
          {!loading && profiles.length === 0 && <p className="px-1 py-2 text-xs text-gray-400">None saved yet.</p>}
          {profiles.map(profile => (
            <div key={profile.id} className="flex items-center gap-1.5 py-1 px-1">
              <span className="flex-1 min-w-0 truncate text-xs text-gray-700" title={profile.name}>{profile.name}</span>
              <button onClick={() => downloadJson(`${profile.name}.json`, { name: profile.name, config: profile.config })} title="Export" className="text-xs text-gray-400 hover:text-gray-700 shrink-0">⇩</button>
              <button onClick={() => setDraft({ id: profile.id, name: profile.name, config: profile.config })} title="Edit" className="text-xs text-gray-400 hover:text-gray-700 shrink-0">✎</button>
              <button onClick={() => handleDelete(profile)} title="Delete" className="text-xs text-gray-400 hover:text-red-600 shrink-0">✕</button>
            </div>
          ))}

          {error && <p className="px-1 pt-1 text-[11px] text-red-600">{error}</p>}

          <div className="border-t border-gray-100 mt-1 pt-1.5 flex items-center gap-1.5">
            <button
              onClick={() => setDraft({ id: null, name: '', config: DEFAULT_ANIMATION_CONFIG })}
              className="flex-1 text-left text-xs text-gray-600 hover:text-gray-900 px-1"
            >
              + New profile
            </button>
            <input ref={importInputRef} type="file" accept="application/json" className="hidden" onChange={e => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) handleImport(file)
            }} />
            <button onClick={() => importInputRef.current?.click()} className="text-xs text-gray-400 hover:text-gray-700 px-1">⇧ Import</button>
          </div>
        </>
      )}
    </div>
  )
}
