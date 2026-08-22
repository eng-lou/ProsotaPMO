import { useRef, useState } from 'react'
import type { Collection } from './collections'
import type { SiteCapture } from './siteCaptures'
import type { ActivityProgressSuggestion, ProgressVarianceResult, ProgressVarianceTest } from './progressVarianceTests'

interface RunProgress {
  testId: string
  done: number
  total: number
}

interface NewTestDraft {
  name: string
  group_a_collection_id: string
  site_capture_id: string
  min_coverage_percent: number
}

interface Props {
  collections: Collection[]
  siteCaptures: SiteCapture[]
  tests: ProgressVarianceTest[]
  error: string | null
  runProgress: RunProgress | null
  loadedCaptureIds: Set<string>
  uploadingCapture: boolean
  convertingCaptureId: string | null
  generatingIfcCaptureId: string | null
  onUploadCapture: (file: File) => void
  onDeleteCapture: (captureId: string) => void
  onToggleLoadCapture: (capture: SiteCapture) => void
  onConvertCapture: (captureId: string) => void
  onGenerateIfc: (captureId: string) => void
  onCreateTest: (draft: NewTestDraft) => void
  onDeleteTest: (testId: string) => void
  onRunTest: (testId: string) => void
  onUpdateThreshold: (testId: string, minCoveragePercent: number) => void
  onUpdateResult: (resultId: string, data: { status?: ProgressVarianceResult['status']; comment?: string | null }) => void
  onSelectElement: (element: { source_kind: 'ifc' | 'mesh'; ref: string }) => void
  activityProgressSuggestions: Record<string, ActivityProgressSuggestion[]>
  applyingActivityId: string | null
  onApplyActivityProgress: (testId: string, suggestion: ActivityProgressSuggestion) => void
}

const STATUS_STYLE: Record<ProgressVarianceResult['status'], string> = {
  new: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/30',
  reviewed: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/30',
  approved: 'bg-gray-100 dark:bg-prosota-panel2 text-gray-500 dark:text-prosota-muted border-gray-200 dark:border-prosota-line',
}

function CapturesSection({
  siteCaptures, loadedCaptureIds, uploading, convertingCaptureId, generatingIfcCaptureId,
  onUpload, onDelete, onToggleLoad, onConvert, onGenerateIfc,
}: {
  siteCaptures: SiteCapture[]
  loadedCaptureIds: Set<string>
  uploading: boolean
  convertingCaptureId: string | null
  generatingIfcCaptureId: string | null
  onUpload: (file: File) => void
  onDelete: (id: string) => void
  onToggleLoad: (capture: SiteCapture) => void
  onConvert: (captureId: string) => void
  onGenerateIfc: (captureId: string) => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="px-3 py-2 border-b border-gray-100 dark:border-prosota-line space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500 dark:text-prosota-muted">Site Captures</span>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-prosota-line text-gray-700 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2 disabled:text-gray-300"
        >
          {uploading ? 'Uploading…' : '+ Upload Scan'}
        </button>
        <input
          ref={fileInputRef} type="file" accept=".xyz,.e57" className="hidden"
          onChange={e => { const file = e.target.files?.[0]; if (file) onUpload(file); e.target.value = '' }}
        />
      </div>
      {siteCaptures.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-prosota-muted">
          Upload a MatterPak scan's own cloud.xyz, or a raw .e57 export — the precision point cloud a variance test compares elements against.
        </p>
      ) : (
        <div className="space-y-1">
          {siteCaptures.map(c => {
            const loaded = loadedCaptureIds.has(c.id)
            const converting = convertingCaptureId === c.id
            const generatingIfc = generatingIfcCaptureId === c.id
            return (
              <div key={c.id} className="flex items-center gap-1.5 text-xs">
                <span className="flex-1 min-w-0 truncate text-gray-700 dark:text-prosota-muted" title={c.name}>{c.name}</span>
                {c.kind === 'e57' && (
                  <span className="text-[10px] px-1 rounded bg-sky-50 text-sky-700 dark:bg-prosota-azure/15 dark:text-prosota-azure shrink-0">E57</span>
                )}
                <span className="text-[11px] text-gray-400 dark:text-prosota-muted shrink-0">{c.captured_at}</span>
                {c.kind === 'e57' ? (
                  <button
                    onClick={() => onConvert(c.id)}
                    disabled={converting}
                    title="Convert this raw .e57 export into a loadable point cloud — can take several minutes for a large scan"
                    className="text-[11px] px-1.5 py-0.5 rounded border shrink-0 border-gray-300 dark:border-prosota-line text-gray-600 dark:text-prosota-muted disabled:text-gray-300 hover:bg-gray-50 dark:hover:bg-prosota-panel2 disabled:hover:bg-transparent"
                  >
                    {converting ? 'Converting…' : 'Convert'}
                  </button>
                ) : (
                  <button
                    onClick={() => onToggleLoad(c)}
                    className={`text-[11px] px-1.5 py-0.5 rounded border shrink-0 ${
                      loaded
                        ? 'bg-gray-900 text-white border-gray-900'
                        : 'border-gray-300 dark:border-prosota-line text-gray-600 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2'
                    }`}
                  >
                    {loaded ? 'Loaded' : 'Load'}
                  </button>
                )}
                {c.kind === 'xyz' && (
                  <button
                    onClick={() => onGenerateIfc(c.id)}
                    disabled={generatingIfc}
                    title="Auto-generate IFC walls/slabs/openings from this scan (Cloud2BIM) — can take a while, and the result is a starting point to review, not a finished model"
                    className="text-[11px] px-1.5 py-0.5 rounded border shrink-0 border-gray-300 dark:border-prosota-line text-gray-600 dark:text-prosota-muted disabled:text-gray-300 hover:bg-gray-50 dark:hover:bg-prosota-panel2 disabled:hover:bg-transparent"
                  >
                    {generatingIfc ? 'Generating…' : 'Generate IFC'}
                  </button>
                )}
                <button onClick={() => onDelete(c.id)} title="Delete capture" className="text-gray-400 dark:text-prosota-muted hover:text-red-600 dark:hover:text-red-400 shrink-0">✕</button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function NewTestForm({ collections, siteCaptures, onCreate, onCancel }: {
  collections: Collection[]
  siteCaptures: SiteCapture[]
  onCreate: (draft: NewTestDraft) => void
  onCancel: () => void
}) {
  // Only xyz captures are ever loadable/queryable (2026-08-20) — a raw
  // e57 has to be converted first (see the panel's own "Convert" button),
  // so offering it here would create a test that can never actually run.
  const loadableCaptures = siteCaptures.filter(c => c.kind === 'xyz')
  const [name, setName] = useState('Progress Variance Test')
  const [groupA, setGroupA] = useState(collections[0]?.id ?? '')
  const [captureId, setCaptureId] = useState(loadableCaptures[0]?.id ?? '')
  const [minCoveragePercent, setMinCoveragePercent] = useState(50)

  const canCreate = groupA && captureId

  return (
    <div className="px-3 py-2 space-y-1.5 bg-gray-50 dark:bg-prosota-panel2 border-b border-gray-100 dark:border-prosota-line">
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Test name"
        className="w-full text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-1"
      />
      <select value={groupA} onChange={e => setGroupA(e.target.value)} className="w-full text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1 py-1">
        {collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <select value={captureId} onChange={e => setCaptureId(e.target.value)} className="w-full text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1 py-1">
        {loadableCaptures.length === 0
          ? <option value="">Convert a Site Capture to XYZ first</option>
          : loadableCaptures.map(c => <option key={c.id} value={c.id}>{c.name} ({c.captured_at})</option>)}
      </select>
      <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-prosota-muted">
        Min. surface % to confirm
        <input
          type="number" min={0} max={100} step={1} value={minCoveragePercent}
          onChange={e => setMinCoveragePercent(Number(e.target.value))}
          className="w-16 text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1 py-0.5"
        />
      </label>
      <div className="flex items-center justify-end gap-1.5 pt-0.5">
        <button onClick={onCancel} className="text-xs px-2 py-0.5 rounded border border-gray-300 dark:border-prosota-line text-gray-600 dark:text-prosota-muted hover:bg-white dark:hover:bg-prosota-panel2">
          Cancel
        </button>
        <button
          onClick={() => canCreate && onCreate({ name: name.trim() || 'Progress Variance Test', group_a_collection_id: groupA, site_capture_id: captureId, min_coverage_percent: minCoveragePercent })}
          disabled={!canCreate}
          className="text-xs px-2 py-0.5 rounded bg-gray-900 text-white disabled:bg-gray-300"
        >
          Create
        </button>
      </div>
    </div>
  )
}

function ResultRow({ result, onUpdate, onSelect }: {
  result: ProgressVarianceResult
  onUpdate: (data: { status?: ProgressVarianceResult['status']; comment?: string | null }) => void
  onSelect: () => void
}) {
  return (
    <tr className="border-t border-gray-100 dark:border-prosota-line hover:bg-sky-50/60 dark:hover:bg-prosota-azure/10 cursor-pointer" onClick={onSelect}>
      <td className="px-1.5 py-1 truncate max-w-[130px]" title={result.element_label}>{result.element_label}</td>
      <td className="px-1.5 py-1 text-right tabular-nums text-gray-500 dark:text-prosota-muted" title={`${result.point_count} points in bounding box (diagnostic only)`}>{result.point_count}</td>
      <td className="px-1.5 py-1">
        <span
          className={`text-[11px] px-1.5 py-0.5 rounded-full tabular-nums ${
            result.coverage_percent >= 66 ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400'
            : result.coverage_percent >= 33 ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400'
            : 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400'
          }`}
          title={result.confirmed_in_scan ? 'Confirmed — meets this test\'s min. surface %' : 'Variance — below this test\'s min. surface %'}
        >
          {result.coverage_percent.toFixed(0)}%
        </span>
      </td>
      <td className="px-1.5 py-1" onClick={e => e.stopPropagation()}>
        <select
          value={result.status}
          onChange={e => onUpdate({ status: e.target.value as ProgressVarianceResult['status'] })}
          className={`text-[11px] border rounded px-1 py-0.5 ${STATUS_STYLE[result.status]}`}
        >
          <option value="new">New</option>
          <option value="reviewed">Reviewed</option>
          <option value="approved">Approved</option>
        </select>
      </td>
    </tr>
  )
}

// "Apply" writes straight into Activity.pct_complete (2026-08-21) —
// deliberately one explicit action per activity, never a bulk/automatic
// write, since that field is EVM-critical and today PM-entered; see
// FourD.tsx's own handleApplyActivityProgress docstring.
function ActivityProgressSuggestions({ testId, suggestions, applyingActivityId, onApply }: {
  testId: string
  suggestions: ActivityProgressSuggestion[]
  applyingActivityId: string | null
  onApply: (testId: string, suggestion: ActivityProgressSuggestion) => void
}) {
  if (suggestions.length === 0) return null
  return (
    <div className="mt-1.5 space-y-1 rounded border border-gray-200 dark:border-prosota-line p-1.5 bg-gray-50/60 dark:bg-prosota-panel2/40">
      <div className="text-[11px] text-gray-500 dark:text-prosota-muted">Scan-suggested activity progress</div>
      {suggestions.map(s => {
        const applying = applyingActivityId === s.activity_id
        const current = s.current_pct_complete === null ? '—' : `${Number(s.current_pct_complete).toFixed(0)}%`
        return (
          <div key={s.activity_id} className="flex items-center gap-1.5 text-xs">
            <span className="flex-1 min-w-0 truncate text-gray-700 dark:text-prosota-muted" title={`${s.activity_code} ${s.activity_name}`}>
              {s.activity_code} {s.activity_name}
            </span>
            <span
              className="text-[11px] text-gray-400 dark:text-prosota-muted shrink-0"
              title={`${s.matched_element_count} of ${s.linked_element_count} linked elements scanned in this run`}
            >
              {current} → {s.scan_suggested_pct_complete.toFixed(0)}%
            </span>
            <button
              onClick={() => onApply(testId, s)}
              disabled={applying}
              className="text-[11px] px-1.5 py-0.5 rounded border shrink-0 border-gray-300 dark:border-prosota-line text-gray-600 dark:text-prosota-muted disabled:text-gray-300 hover:bg-white dark:hover:bg-prosota-panel2"
            >
              {applying ? 'Applying…' : 'Apply'}
            </button>
          </div>
        )
      })}
    </div>
  )
}

function TestItem({
  test, collections, siteCaptures, loadedCaptureIds, running, activitySuggestions, applyingActivityId,
  onDelete, onRun, onUpdateThreshold, onUpdateResult, onSelectElement, onApplyActivityProgress,
}: {
  test: ProgressVarianceTest
  collections: Collection[]
  siteCaptures: SiteCapture[]
  loadedCaptureIds: Set<string>
  running: RunProgress | null
  activitySuggestions: ActivityProgressSuggestion[]
  applyingActivityId: string | null
  onDelete: () => void
  onRun: () => void
  onUpdateThreshold: (minCoveragePercent: number) => void
  onUpdateResult: (resultId: string, data: { status?: ProgressVarianceResult['status']; comment?: string | null }) => void
  onSelectElement: Props['onSelectElement']
  onApplyActivityProgress: Props['onApplyActivityProgress']
}) {
  const [expanded, setExpanded] = useState(true)
  const groupAName = collections.find(c => c.id === test.group_a_collection_id)?.name ?? '(deleted)'
  const capture = siteCaptures.find(c => c.id === test.site_capture_id)
  const captureLoaded = capture ? loadedCaptureIds.has(capture.id) : false
  const varianceCount = test.results.filter(r => !r.confirmed_in_scan && r.status !== 'approved').length

  return (
    <div className="px-3 py-2 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <button onClick={() => setExpanded(v => !v)} className="text-xs text-gray-400 dark:text-prosota-muted w-3 shrink-0">{expanded ? '▾' : '▸'}</button>
        <span className="flex-1 text-xs text-gray-700 dark:text-prosota-muted truncate" title={test.name}>{test.name}</span>
        {varianceCount > 0 && (
          <span className="text-[11px] px-1.5 rounded-full bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400 shrink-0">{varianceCount}</span>
        )}
        <button onClick={onDelete} title="Delete" className="text-xs text-gray-400 dark:text-prosota-muted hover:text-red-600 dark:hover:text-red-400 shrink-0">✕</button>
      </div>
      {expanded && (
        <>
          <div className="flex items-center gap-1.5 flex-wrap text-xs text-gray-500 dark:text-prosota-muted">
            <span className="truncate">{groupAName} vs {capture?.name ?? '(deleted)'}</span>
          </div>
          <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-prosota-muted">
            Min. surface %
            <input
              type="number" min={0} max={100} step={1} value={test.min_coverage_percent}
              onChange={e => onUpdateThreshold(Number(e.target.value))}
              className="w-16 text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1 py-0.5"
            />
          </label>
          <button
            onClick={onRun}
            disabled={running !== null || !captureLoaded}
            title={!captureLoaded ? 'Load this test\'s capture in the viewport first (Site Captures above)' : undefined}
            className="text-xs px-2 py-0.5 rounded border border-gray-300 dark:border-prosota-line text-gray-600 dark:text-prosota-muted disabled:text-gray-300 hover:bg-gray-50 dark:hover:bg-prosota-panel2 disabled:hover:bg-transparent"
          >
            {running ? `Testing… ${running.done}/${running.total}` : 'Run Test'}
          </button>
          {test.last_run_at && (
            <span className="text-[11px] text-gray-400 dark:text-prosota-muted ml-1.5">last run {new Date(test.last_run_at).toLocaleString()}</span>
          )}
          {test.results.length > 0 && (
            <table className="w-full text-xs mt-1">
              <thead>
                <tr className="text-[11px] text-gray-400 dark:text-prosota-muted text-left">
                  <th className="px-1.5 py-0.5 font-normal">Element</th>
                  <th className="px-1.5 py-0.5 font-normal text-right">Pts</th>
                  <th className="px-1.5 py-0.5 font-normal">Coverage</th>
                  <th className="px-1.5 py-0.5 font-normal">Status</th>
                </tr>
              </thead>
              <tbody>
                {test.results.map(r => (
                  <ResultRow
                    key={r.id}
                    result={r}
                    onUpdate={data => onUpdateResult(r.id, data)}
                    onSelect={() => onSelectElement({ source_kind: r.element_source_kind, ref: r.element_ref })}
                  />
                ))}
              </tbody>
            </table>
          )}
          <ActivityProgressSuggestions
            testId={test.id}
            suggestions={activitySuggestions}
            applyingActivityId={applyingActivityId}
            onApply={onApplyActivityProgress}
          />
        </>
      )}
    </div>
  )
}

// "Progress Variance" dockable panel (2026-08-20, per the approved plan —
// detects when the 4D schedule says an element is complete but a real
// site scan shows otherwise). Mirrors ClashDetectionPanel.tsx's own
// layout closely, with a Site Captures section above it (upload/load/
// unload the point clouds tests reference) since, unlike Clash
// Detective's two Collections, this feature's own "Group B" is a capture
// that has to be uploaded and manually aligned in the viewport before any
// test against it means anything.
export function ProgressVariancePanel({
  collections, siteCaptures, tests, error, runProgress, loadedCaptureIds, uploadingCapture, convertingCaptureId,
  generatingIfcCaptureId,
  onUploadCapture, onDeleteCapture, onToggleLoadCapture, onConvertCapture, onGenerateIfc,
  onCreateTest, onDeleteTest, onRunTest, onUpdateThreshold, onUpdateResult, onSelectElement,
  activityProgressSuggestions, applyingActivityId, onApplyActivityProgress,
}: Props) {
  const [creating, setCreating] = useState(false)
  const hasLoadableCapture = siteCaptures.some(c => c.kind === 'xyz')

  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      <div className="px-3 py-2 border-b border-gray-100 dark:border-prosota-line flex items-center justify-between sticky top-0 bg-white dark:bg-prosota-panel">
        <span className="text-xs text-gray-500 dark:text-prosota-muted">Progress Variance</span>
        <button
          onClick={() => setCreating(v => !v)}
          disabled={collections.length === 0 || !hasLoadableCapture}
          title={collections.length === 0 ? 'Create a Collection first' : !hasLoadableCapture ? 'Upload (and convert, if .e57) a Site Capture first' : undefined}
          className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-prosota-line text-gray-700 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2 disabled:text-gray-300 disabled:hover:bg-transparent"
        >
          + Add
        </button>
      </div>
      {error && <p className="px-3 py-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      <CapturesSection
        siteCaptures={siteCaptures}
        loadedCaptureIds={loadedCaptureIds}
        uploading={uploadingCapture}
        convertingCaptureId={convertingCaptureId}
        generatingIfcCaptureId={generatingIfcCaptureId}
        onUpload={onUploadCapture}
        onDelete={onDeleteCapture}
        onToggleLoad={onToggleLoadCapture}
        onConvert={onConvertCapture}
        onGenerateIfc={onGenerateIfc}
      />
      {creating && (
        <NewTestForm
          collections={collections}
          siteCaptures={siteCaptures}
          onCancel={() => setCreating(false)}
          onCreate={draft => { onCreateTest(draft); setCreating(false) }}
        />
      )}
      {tests.length === 0 && !creating ? (
        <p className="px-3 py-3 text-xs text-gray-400 dark:text-prosota-muted">
          Upload a capture, "+ Add" a test comparing it against a Collection of schedule-complete elements, then "Run Test" — elements the scan doesn't confirm get flagged here.
        </p>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-prosota-line">
          {tests.map(test => (
            <TestItem
              key={test.id}
              test={test}
              collections={collections}
              siteCaptures={siteCaptures}
              loadedCaptureIds={loadedCaptureIds}
              running={runProgress?.testId === test.id ? runProgress : null}
              activitySuggestions={activityProgressSuggestions[test.id] ?? []}
              applyingActivityId={applyingActivityId}
              onDelete={() => onDeleteTest(test.id)}
              onRun={() => onRunTest(test.id)}
              onUpdateThreshold={value => onUpdateThreshold(test.id, value)}
              onUpdateResult={onUpdateResult}
              onSelectElement={onSelectElement}
              onApplyActivityProgress={onApplyActivityProgress}
            />
          ))}
        </div>
      )}
    </div>
  )
}
