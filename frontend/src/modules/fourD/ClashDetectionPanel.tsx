import { useState } from 'react'
import type { Collection } from './collections'
import type { ClashResult, ClashTest } from './clashTests'

interface RunProgress {
  testId: string
  done: number
  total: number
}

interface NewTestDraft {
  name: string
  group_a_collection_id: string
  group_b_collection_id: string
  test_type: 'hard' | 'clearance'
  tolerance_mm: number
}

interface Props {
  collections: Collection[]
  clashTests: ClashTest[]
  error: string | null
  runProgress: RunProgress | null
  onCreate: (draft: NewTestDraft) => void
  onDelete: (testId: string) => void
  onRun: (testId: string) => void
  onUpdateResult: (resultId: string, data: { status?: ClashResult['status']; comment?: string | null }) => void
  onSelectPair: (
    elementA: { source_kind: 'ifc' | 'mesh'; ref: string },
    elementB: { source_kind: 'ifc' | 'mesh'; ref: string },
  ) => void
}

const STATUS_STYLE: Record<ClashResult['status'], string> = {
  new: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/30',
  reviewed: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/30',
  approved: 'bg-gray-100 dark:bg-prosota-panel2 text-gray-500 dark:text-prosota-muted border-gray-200 dark:border-prosota-line',
}

function NewTestForm({ collections, onCreate, onCancel }: {
  collections: Collection[]
  onCreate: (draft: NewTestDraft) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('Clash Test')
  const [groupA, setGroupA] = useState(collections[0]?.id ?? '')
  const [groupB, setGroupB] = useState(collections[1]?.id ?? collections[0]?.id ?? '')
  const [testType, setTestType] = useState<'hard' | 'clearance'>('hard')
  const [toleranceMm, setToleranceMm] = useState(25)

  const canCreate = groupA && groupB && collections.length > 0

  return (
    <div className="px-3 py-2 space-y-1.5 bg-gray-50 dark:bg-prosota-panel2 border-b border-gray-100 dark:border-prosota-line">
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Test name"
        className="w-full text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-1"
      />
      <div className="flex items-center gap-1.5">
        <select value={groupA} onChange={e => setGroupA(e.target.value)} className="flex-1 min-w-0 text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1 py-1">
          {collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <span className="text-xs text-gray-400 dark:text-prosota-muted shrink-0">vs</span>
        <select value={groupB} onChange={e => setGroupB(e.target.value)} className="flex-1 min-w-0 text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1 py-1">
          {collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-1.5">
        <select
          value={testType}
          onChange={e => setTestType(e.target.value as 'hard' | 'clearance')}
          className="text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1 py-1"
        >
          <option value="hard">Hard (touching/overlap)</option>
          <option value="clearance">Clearance (min. gap)</option>
        </select>
        {testType === 'clearance' && (
          <label className="flex items-center gap-1 text-xs text-gray-500 dark:text-prosota-muted">
            Tolerance
            <input
              type="number" min={0} step={1} value={toleranceMm}
              onChange={e => setToleranceMm(Number(e.target.value))}
              className="w-16 text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1 py-0.5"
            />
            mm
          </label>
        )}
      </div>
      <div className="flex items-center justify-end gap-1.5 pt-0.5">
        <button onClick={onCancel} className="text-xs px-2 py-0.5 rounded border border-gray-300 dark:border-prosota-line text-gray-600 dark:text-prosota-muted hover:bg-white dark:hover:bg-prosota-panel2">
          Cancel
        </button>
        <button
          onClick={() => canCreate && onCreate({ name: name.trim() || 'Clash Test', group_a_collection_id: groupA, group_b_collection_id: groupB, test_type: testType, tolerance_mm: testType === 'clearance' ? toleranceMm : 0 })}
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
  result: ClashResult
  onUpdate: (data: { status?: ClashResult['status']; comment?: string | null }) => void
  onSelect: () => void
}) {
  return (
    <tr className="border-t border-gray-100 dark:border-prosota-line hover:bg-sky-50/60 dark:hover:bg-prosota-azure/10 cursor-pointer" onClick={onSelect}>
      <td className="px-1.5 py-1 truncate max-w-[110px]" title={result.element_a_label}>{result.element_a_label}</td>
      <td className="px-1.5 py-1 truncate max-w-[110px]" title={result.element_b_label}>{result.element_b_label}</td>
      <td className="px-1.5 py-1 text-right tabular-nums text-gray-500 dark:text-prosota-muted">
        {result.distance_mm !== null ? `${result.distance_mm.toFixed(0)}mm` : '—'}
      </td>
      <td className="px-1.5 py-1" onClick={e => e.stopPropagation()}>
        <select
          value={result.status}
          onChange={e => onUpdate({ status: e.target.value as ClashResult['status'] })}
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

function TestItem({ test, collections, running, onDelete, onRun, onUpdateResult, onSelectPair }: {
  test: ClashTest
  collections: Collection[]
  running: RunProgress | null
  onDelete: () => void
  onRun: () => void
  onUpdateResult: (resultId: string, data: { status?: ClashResult['status']; comment?: string | null }) => void
  onSelectPair: Props['onSelectPair']
}) {
  const [expanded, setExpanded] = useState(true)
  const groupAName = collections.find(c => c.id === test.group_a_collection_id)?.name ?? '(deleted)'
  const groupBName = collections.find(c => c.id === test.group_b_collection_id)?.name ?? '(deleted)'
  const activeCount = test.results.filter(r => r.status !== 'approved').length

  return (
    <div className="px-3 py-2 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <button onClick={() => setExpanded(v => !v)} className="text-xs text-gray-400 dark:text-prosota-muted w-3 shrink-0">{expanded ? '▾' : '▸'}</button>
        <span className="flex-1 text-xs text-gray-700 dark:text-prosota-muted truncate" title={`${groupAName} vs ${groupBName}`}>{test.name}</span>
        {activeCount > 0 && (
          <span className="text-[11px] px-1.5 rounded-full bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400 shrink-0">{activeCount}</span>
        )}
        <button onClick={onDelete} title="Delete" className="text-xs text-gray-400 dark:text-prosota-muted hover:text-red-600 dark:hover:text-red-400 shrink-0">✕</button>
      </div>
      {expanded && (
        <>
          <div className="flex items-center gap-1.5 flex-wrap text-xs text-gray-500 dark:text-prosota-muted">
            <span className="truncate">{groupAName} vs {groupBName}</span>
            <span className="text-gray-300 dark:text-prosota-line">·</span>
            <span>{test.test_type === 'hard' ? 'Hard' : `Clearance ${test.tolerance_mm}mm`}</span>
          </div>
          <button
            onClick={onRun}
            disabled={running !== null}
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
                  <th className="px-1.5 py-0.5 font-normal">A</th>
                  <th className="px-1.5 py-0.5 font-normal">B</th>
                  <th className="px-1.5 py-0.5 font-normal text-right">Dist.</th>
                  <th className="px-1.5 py-0.5 font-normal">Status</th>
                </tr>
              </thead>
              <tbody>
                {test.results.map(r => (
                  <ResultRow
                    key={r.id}
                    result={r}
                    onUpdate={data => onUpdateResult(r.id, data)}
                    onSelect={() => onSelectPair(
                      { source_kind: r.element_a_source_kind, ref: r.element_a_ref },
                      { source_kind: r.element_b_source_kind, ref: r.element_b_ref },
                    )}
                  />
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  )
}

// "Clash Detective" dockable panel (2026-07-12, per Maro's Navisworks
// reference screenshot). Reuses Collections (collections.ts) as a test's
// two selection sets rather than a second selection concept — see
// clash_test.py's own docstring. A test's "Run" always tests whatever the
// viewport currently shows (see sceneClash.ts's own header on why that's
// deliberately the *only* mode — no separate date-sweep engine); scrubbing
// the timeline before hitting Run is how this is "4D-aware" in practice.
export function ClashDetectionPanel({ collections, clashTests, error, runProgress, onCreate, onDelete, onRun, onUpdateResult, onSelectPair }: Props) {
  const [creating, setCreating] = useState(false)

  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      <div className="px-3 py-2 border-b border-gray-100 dark:border-prosota-line flex items-center justify-between sticky top-0 bg-white dark:bg-prosota-panel">
        <span className="text-xs text-gray-500 dark:text-prosota-muted">Clash Detective</span>
        <button
          onClick={() => setCreating(v => !v)}
          disabled={collections.length === 0}
          title={collections.length === 0 ? 'Create at least one Collection first (Collections panel)' : undefined}
          className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-prosota-line text-gray-700 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2 disabled:text-gray-300 disabled:hover:bg-transparent"
        >
          + Add
        </button>
      </div>
      {error && <p className="px-3 py-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      {creating && (
        <NewTestForm
          collections={collections}
          onCancel={() => setCreating(false)}
          onCreate={draft => { onCreate(draft); setCreating(false) }}
        />
      )}
      {clashTests.length === 0 && !creating ? (
        <p className="px-3 py-3 text-xs text-gray-400 dark:text-prosota-muted">
          "+ Add" a test, pick two Collections to compare, then "Run Test" — clashes get listed here and tinted red in the viewport.
        </p>
      ) : (
        <div className="divide-y divide-gray-100">
          {clashTests.map(test => (
            <TestItem
              key={test.id}
              test={test}
              collections={collections}
              running={runProgress?.testId === test.id ? runProgress : null}
              onDelete={() => onDelete(test.id)}
              onRun={() => onRun(test.id)}
              onUpdateResult={onUpdateResult}
              onSelectPair={onSelectPair}
            />
          ))}
        </div>
      )}
    </div>
  )
}
