import { useRef, useState, type ReactNode } from 'react'
import { downloadJson, readJsonFile } from '@/lib/exportImport'
import { EMPTY_ZONE, type LetterheadTokens, type LetterheadZone, type ProjectLetterhead } from '@/lib/letterhead'
import { PrintLetterheadFooter, PrintLetterheadHeader } from './PrintLetterhead'

interface Props {
  letterhead: ProjectLetterhead
  previewTokens: LetterheadTokens
  onSave: (data: Omit<ProjectLetterhead, 'id'>) => Promise<ProjectLetterhead>
  onClose: () => void
}

// Max raw file size before base64 inflation (~4/3x) — kept comfortably under
// the backend's 700,000-char data-URL cap (app/schemas/project_letterhead.py).
const MAX_LOGO_BYTES = 480_000

const ALIGN_OPTIONS: { value: LetterheadZone['align']; label: string; title: string }[] = [
  { value: 'left', label: '⯇', title: 'Align left' },
  { value: 'center', label: '≡', title: 'Align center' },
  { value: 'right', label: '⯈', title: 'Align right' },
  { value: 'justify', label: '☰', title: 'Justify' },
]

function ToggleButton({ active, onClick, title, children, className = '' }: {
  active: boolean; onClick: () => void; title: string; children: ReactNode; className?: string
}) {
  return (
    <button
      type="button" onClick={onClick} title={title}
      className={`w-6 h-6 text-xs rounded border ${
        active ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
      } ${className}`}
    >
      {children}
    </button>
  )
}

function ZoneEditor({ label, zone, onChange }: { label: string; zone: LetterheadZone; onChange: (z: LetterheadZone) => void }) {
  return (
    <div className="border border-gray-200 rounded-lg p-2.5">
      <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">{label}</div>
      <textarea
        value={zone.text}
        onChange={e => onChange({ ...zone, text: e.target.value })}
        rows={2}
        placeholder="Text — {project} {module} {count} {printed_at} stay live"
        className="w-full text-xs border border-gray-300 rounded px-2 py-1 mb-1.5 resize-none"
      />
      <div className="flex items-center gap-1 flex-wrap">
        <ToggleButton active={zone.bold} onClick={() => onChange({ ...zone, bold: !zone.bold })} title="Bold" className="font-bold">B</ToggleButton>
        <ToggleButton active={zone.italic} onClick={() => onChange({ ...zone, italic: !zone.italic })} title="Italic" className="italic">I</ToggleButton>
        <input
          type="number" min={6} max={32} value={zone.font_size}
          onChange={e => onChange({ ...zone, font_size: Number(e.target.value) || zone.font_size })}
          title="Font size (px)"
          className="w-12 text-xs border border-gray-300 rounded px-1 py-0.5"
        />
        <div className="w-px h-4 bg-gray-200 mx-0.5" />
        {ALIGN_OPTIONS.map(opt => (
          <ToggleButton key={opt.value} active={zone.align === opt.value} onClick={() => onChange({ ...zone, align: opt.value })} title={opt.title}>
            {opt.label}
          </ToggleButton>
        ))}
      </div>
    </div>
  )
}

// Editor for the shared, per-project print header/footer (see
// frontend/src/lib/letterhead.ts) — used by every module's toolbar next to
// Print, per Maro (2026-07-03): logo + header/footer text/formatting set here
// shows up on every printed report for this project, not just this module's.
export function LetterheadEditorWidget({ letterhead, previewTokens, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<ProjectLetterhead>(letterhead)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)

  const setZone = (key: keyof Pick<ProjectLetterhead,
    'header_left' | 'header_center' | 'header_right' | 'footer_left' | 'footer_center' | 'footer_right'
  >) => (zone: LetterheadZone) => setDraft(d => ({ ...d, [key]: zone }))

  const handleLogoUpload = (file: File) => {
    setError(null)
    if (file.size > MAX_LOGO_BYTES) {
      setError(`"${file.name}" is too large (${Math.round(file.size / 1024)}KB) — please use an image under ${Math.round(MAX_LOGO_BYTES / 1024)}KB.`)
      return
    }
    const reader = new FileReader()
    reader.onload = () => setDraft(d => ({ ...d, logo_data_url: reader.result as string }))
    reader.readAsDataURL(file)
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      await onSave(draft)
      onClose()
    } catch {
      setError('Could not save the letterhead.')
    } finally {
      setSaving(false)
    }
  }

  const handleExport = () => {
    downloadJson('letterhead.json', {
      logo_data_url: draft.logo_data_url,
      logo_position: draft.logo_position,
      header_left: draft.header_left,
      header_center: draft.header_center,
      header_right: draft.header_right,
      footer_left: draft.footer_left,
      footer_center: draft.footer_center,
      footer_right: draft.footer_right,
      show_gantt_legend: draft.show_gantt_legend,
    })
  }

  // Loads the imported file into the draft/preview only — same "stage it,
  // then click Save Letterhead yourself" pattern this form already uses for
  // an uploaded logo, rather than overwriting the live letterhead the
  // instant a file is chosen (client-side only, P6's own Copy/Paste adapted
  // to a file-based workflow — 2026-07-05, per Maro).
  const handleImportFile = async (file: File) => {
    setError(null)
    try {
      const parsed = await readJsonFile(file) as Partial<ProjectLetterhead>
      if (typeof parsed.header_left !== 'object' || parsed.header_left === null) {
        throw new Error(`"${file.name}" isn't a valid exported letterhead.`)
      }
      setDraft(d => ({
        ...d,
        logo_data_url: parsed.logo_data_url ?? null,
        logo_position: parsed.logo_position ?? 'left',
        header_left: parsed.header_left as LetterheadZone,
        header_center: (parsed.header_center as LetterheadZone) ?? EMPTY_ZONE,
        header_right: (parsed.header_right as LetterheadZone) ?? EMPTY_ZONE,
        footer_left: (parsed.footer_left as LetterheadZone) ?? EMPTY_ZONE,
        footer_center: (parsed.footer_center as LetterheadZone) ?? EMPTY_ZONE,
        footer_right: (parsed.footer_right as LetterheadZone) ?? EMPTY_ZONE,
        show_gantt_legend: parsed.show_gantt_legend ?? false,
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not import that file.')
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 mb-4">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg">🎨</span>
        <div className="font-bold text-sm">Letterhead</div>
        <div className="text-xs text-gray-400">Shared header/footer for every module's printed reports on this project</div>
        <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600 text-sm">✕</button>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div>
          <div className="flex items-center gap-3 mb-3 p-2.5 border border-gray-200 rounded-lg">
            {draft.logo_data_url ? (
              <img src={draft.logo_data_url} alt="Logo" className="h-10 max-w-[8rem] object-contain" />
            ) : (
              <div className="h-10 w-16 flex items-center justify-center text-[10px] text-gray-300 border border-dashed border-gray-300 rounded">No logo</div>
            )}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-blue-600 hover:text-blue-700 font-medium cursor-pointer">
                {draft.logo_data_url ? 'Replace logo' : 'Upload logo'}
                <input
                  type="file" accept="image/*" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleLogoUpload(f) }}
                />
              </label>
              {draft.logo_data_url && (
                <button onClick={() => setDraft(d => ({ ...d, logo_data_url: null }))} className="text-xs text-gray-400 hover:text-red-600 text-left">
                  Remove logo
                </button>
              )}
              <select
                value={draft.logo_position}
                onChange={e => setDraft(d => ({ ...d, logo_position: e.target.value as ProjectLetterhead['logo_position'] }))}
                className="text-xs border border-gray-300 rounded px-1.5 py-0.5"
              >
                <option value="left">Logo: left zone</option>
                <option value="center">Logo: center zone</option>
                <option value="right">Logo: right zone</option>
              </select>
            </div>
          </div>

          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Header</div>
          <div className="grid grid-cols-3 gap-2 mb-4">
            <ZoneEditor label="Left" zone={draft.header_left} onChange={setZone('header_left')} />
            <ZoneEditor label="Center" zone={draft.header_center} onChange={setZone('header_center')} />
            <ZoneEditor label="Right" zone={draft.header_right} onChange={setZone('header_right')} />
          </div>

          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Footer</div>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <ZoneEditor label="Left" zone={draft.footer_left} onChange={setZone('footer_left')} />
            <ZoneEditor label="Center" zone={draft.footer_center} onChange={setZone('footer_center')} />
            <ZoneEditor label="Right" zone={draft.footer_right} onChange={setZone('footer_right')} />
          </div>

          <label className="flex items-start gap-2 text-xs text-gray-600 border border-gray-200 rounded-lg p-2.5">
            <input
              type="checkbox" checked={draft.show_gantt_legend}
              onChange={e => setDraft(d => ({ ...d, show_gantt_legend: e.target.checked }))}
              className="mt-0.5"
            />
            <span>
              📊 Include the Gantt legend in the footer (critical/non-critical, progress, milestone, dependency link, WBS summary, baseline)
              <span className="block text-gray-400 mt-0.5">Only appears on Scheduling's printed report — the other modules don't have a Gantt chart to explain.</span>
            </span>
          </label>
        </div>

        <div>
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Preview</div>
          <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
            <div className="bg-white p-3 rounded border border-gray-100">
              <PrintLetterheadHeader letterhead={draft} tokens={previewTokens} />
              <p className="text-xs text-gray-300 italic">Report content…</p>
            </div>
            <div className="text-[10px] text-gray-400 mt-2 mb-1">Footer (repeats on every printed page):</div>
            <div className="bg-white rounded border border-gray-100">
              <PrintLetterheadFooter letterhead={draft} tokens={previewTokens} ganttLegend preview />
            </div>
          </div>
        </div>
      </div>

      {error && <p className="text-xs text-red-600 mt-3">{error}</p>}

      <div className="flex items-center gap-2 mt-4">
        <button
          onClick={handleSave} disabled={saving}
          className="text-xs px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save Letterhead'}
        </button>
        <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-600 px-2">Cancel</button>
        <div className="w-px h-4 bg-gray-200" />
        <button onClick={handleExport} className="text-xs text-blue-600 hover:text-blue-700 font-medium">Export</button>
        <button onClick={() => importInputRef.current?.click()} className="text-xs text-blue-600 hover:text-blue-700 font-medium">
          ⇧ Import
        </button>
        <input
          ref={importInputRef} type="file" accept="application/json,.json" className="hidden"
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) handleImportFile(file)
            e.target.value = ''
          }}
        />
      </div>
    </div>
  )
}
