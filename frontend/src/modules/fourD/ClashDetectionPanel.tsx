import { unpackSnapshot } from './clashSnapshot'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import axios from 'axios'
import { api } from '@/lib/api'
import type { Collection } from './collections'
import { updateClashTest, listClashRuns, type ClashResult, type ClashTest, type ClashRunOptions, type ClashRunSnapshot } from './clashTests'
import { ClashViewport, type ClashViewpoint } from './ClashViewport'

interface Draft { name: string; group_a_collection_id: string; group_b_collection_id: string; test_type: 'hard' | 'clearance'; tolerance_mm: number }
interface Props {
  upAxis?: 'y' | 'z'; backgroundColor?: string
  collections: Collection[]; clashTests: ClashTest[]; error: string | null
  runProgress: { testId: string; done: number; total: number; saving?: boolean } | null
  onCreate: (draft: Draft) => Promise<unknown>
  onChanged: (test: ClashTest) => void
  onDelete: (id: string) => void
  onRun: (id: string, options?: ClashRunOptions) => Promise<ClashTest | undefined>
  onCancelRun: () => void
  onUpdateResult: (id: string, data: { status?: ClashResult['status']; comment?: string | null }) => Promise<void>
  onSelectPair: (a: { source_kind: 'ifc' | 'mesh'; ref: string }, b: { source_kind: 'ifc' | 'mesh'; ref: string }) => void
}
const input = 'border border-gray-300 dark:border-prosota-line bg-white dark:bg-prosota-panel2 rounded px-2 py-1 text-xs max-w-full'
const button = input + ' hover:bg-blue-50 dark:hover:bg-prosota-azure/20 disabled:opacity-40'
const statuses = ['new', 'active', 'reviewed', 'approved', 'resolved', 'reopened'] as const
const statusName = (s: string) => s === 'approved' ? 'Accepted' : s.charAt(0).toUpperCase() + s.slice(1)
function message(e: unknown) { return axios.isAxiosError(e) && typeof e.response?.data?.detail === 'string' ? e.response.data.detail : e instanceof Error ? e.message : 'Request failed' }
function TestForm({ collections, initial, save, cancel }: { collections: Collection[]; initial?: Draft; save: (d: Draft) => Promise<unknown>; cancel: () => void }) {
  const [draft, setDraft] = useState<Draft>(initial ?? { name: 'Clash test', group_a_collection_id: collections[0]?.id ?? '', group_b_collection_id: collections[1]?.id ?? collections[0]?.id ?? '', test_type: 'hard', tolerance_mm: 0 })
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  return <form className="space-y-2 p-2 border border-gray-200 dark:border-prosota-line rounded" onSubmit={async e => { e.preventDefault(); setBusy(true); try { await save(draft); cancel() } catch (err) { setError(message(err)) } finally { setBusy(false) } }}>
    <label className="block">Name <input className={input} required maxLength={200} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
    {(['group_a_collection_id', 'group_b_collection_id'] as const).map((field, i) => <label className="block" key={field}>Collection {i ? 'B' : 'A'} <select required className={input} value={draft[field]} onChange={e => setDraft({ ...draft, [field]: e.target.value })}>{collections.map(c => <option key={c.id} value={c.id}>{c.name} ({c.members.length} elements)</option>)}</select></label>)}
    <select aria-label="Test type" className={input} value={draft.test_type} onChange={e => setDraft({ ...draft, test_type: e.target.value as Draft['test_type'] })}><option value="hard">Hard (touching or overlap)</option><option value="clearance">Clearance (minimum gap)</option></select>
    {draft.test_type === 'clearance' && <label> Tolerance (mm) <input className={input} type="number" min={0} max={1000000} step="any" required value={draft.tolerance_mm} onChange={e => setDraft({ ...draft, tolerance_mm: Number(e.target.value) })} /></label>}
    {error && <p role="alert" className="text-red-500">{error}</p>}<div className="flex gap-2"><button type="submit" className={button} disabled={busy}>{busy ? 'Saving…' : 'Save test'}</button><button type="button" className={button} onClick={cancel}>Cancel</button></div>
  </form>
}
interface Share { id: string; token?: string; created_at?: string; expires_at: string; revoked?: boolean; comments?: { name: string; text: string }[] }
function TestItem({ test, props }: { test: ClashTest; props: Props }) {
  const [editing, setEditing] = useState(false), [expanded, setExpanded] = useState(true)
  const [query, setQuery] = useState(''), [status, setStatus] = useState('unresolved'), [group, setGroup] = useState('none'), [page, setPage] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set()), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [options, setOptions] = useState<ClashRunOptions>({ scope: 'all', metresPerUnit: 1 })
  const [runs, setRuns] = useState<ClashRunSnapshot[]>([]), [runId, setRunId] = useState(''), [view, setView] = useState<ClashRunSnapshot | null>(null), [inspected, setInspected] = useState('')
  const [viewpoints, setViewpoints] = useState<Record<string, ClashViewpoint>>({})
  const [includeContext, setIncludeContext] = useState(false)
  const [sharing, setSharing] = useState(false), [days, setDays] = useState(14), [comments, setComments] = useState(false), [recipient, setRecipient] = useState('')
  const [share, setShare] = useState<Share | null>(null), [shares, setShares] = useState<Share[]>([]), [notice, setNotice] = useState('')
  const [issueResult, setIssueResult] = useState<ClashResult | null>(null), [owner, setOwner] = useState(''), [due, setDue] = useState(''), [periodId, setPeriodId] = useState('')
  const [periods, setPeriods] = useState<{ id: string; period_label: string; freeze_status: string }[]>([])
  const [selectedRun, setSelectedRun] = useState<ClashRunSnapshot | null>(null)
  async function loadRun(id: string) { setRunId(id); setSelectedRun(await unpackSnapshot((await api.get(`/api/v1/clash-review/${test.id}/runs/${id}`)).data)) }
  async function refresh() { const history = await listClashRuns(test.id); setRuns(history); if (history[0]) await loadRun(history[0].id); else { setRunId(''); setSelectedRun(null) } }
  useEffect(() => { void refresh().catch(e => setError(message(e))) }, [test.id, test.last_run_at])
  const sourceResults = runId && selectedRun && selectedRun.id !== runs[0]?.id ? selectedRun.results : test.results
  const filtered = sourceResults.filter(r => (status === 'all' || (status === 'unresolved' ? !['approved', 'resolved'].includes(r.status) : r.status === status)) && `${r.element_a_label} ${r.element_b_label} ${r.comment ?? ''}`.toLowerCase().includes(query.toLowerCase()))
  const groupName = (r: ClashResult) => group === 'element' ? r.element_a_label
    : group === 'status' ? statusName(r.status)
    : group === 'model' ? (r.element_metadata?.a?.model ?? r.element_a_source_kind)
    : group === 'type' ? (r.element_metadata?.a?.type || 'Unknown type')
    : group === 'level' ? (r.element_metadata?.a?.level || 'No level') : ''
  if (group !== 'none') filtered.sort((a, b) => groupName(a).localeCompare(groupName(b)) || a.element_a_label.localeCompare(b.element_a_label))
  const shown = filtered.slice(page * 50, (page + 1) * 50)
  const chosen = selected.size ? sourceResults.filter(r => selected.has(r.id)) : filtered
  const shareable = chosen.filter(r => r.status !== 'resolved' && selectedRun?.results.some(s => s.id === r.id && s.status !== 'resolved'))
  const historical = !!selectedRun && selectedRun.id !== runs[0]?.id
  async function action(fn: () => Promise<unknown>) { setBusy(true); setError(''); setNotice(''); try { await fn() } catch (e) { setError(message(e)) } finally { setBusy(false) } }
  async function inspect(r: ClashResult) {
    props.onSelectPair({ source_kind: r.element_a_source_kind, ref: r.element_a_ref }, { source_kind: r.element_b_source_kind, ref: r.element_b_ref })
    const saved = selectedRun?.results.some(s => s.id === r.id) ? selectedRun
      : await unpackSnapshot<ClashRunSnapshot>((await api.get(`/api/v1/clash-review/${test.id}/results/${r.id}/latest-run`)).data)
    setView(saved); setInspected(r.id)
  }
  const [openedLink, setOpenedLink] = useState(false)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (!openedLink && runs.length && params.get('clash_test') === test.id) {
      const result = test.results.find(r => r.id === params.get('clash_result'))
      if (result) { setOpenedLink(true); void action(() => inspect(result)) }
    }
  }, [runs, openedLink, test.id])
  async function openShare() { setSharing(true); setShares((await api.get(`/api/v1/clash-review/${test.id}/reports`)).data) }
  const link = share?.token ? `${window.location.origin}/clash-report#${share.token}` : ''
  const current = view?.results.find(r => r.id === inspected)
  const collectionA = props.collections.find(c => c.id === test.group_a_collection_id), collectionB = props.collections.find(c => c.id === test.group_b_collection_id)
  return <section className="p-3 space-y-2 border-b dark:border-prosota-line text-xs">
    <div className="flex gap-2 items-center"><button onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>{expanded ? '▾' : '▸'}</button><strong className="flex-1">{test.name}</strong><span>{test.results.filter(r => !['approved', 'resolved'].includes(r.status)).length} unresolved</span><button className={button} disabled={!!props.runProgress} onClick={() => setEditing(!editing)}>Edit</button><button className={button} disabled={!!props.runProgress} onClick={() => { if (window.confirm('Delete this test, its run history and shared reports?')) props.onDelete(test.id) }}>Delete</button></div>
    {expanded && <>
      {editing && <TestForm collections={props.collections} initial={test} cancel={() => setEditing(false)} save={async draft => props.onChanged(await updateClashTest(test.id, draft))} />}
      <p>{collectionA?.name ?? 'Missing collection'} ({collectionA?.members.length ?? 0}) vs {collectionB?.name ?? 'Missing collection'} ({collectionB?.members.length ?? 0}) · {test.test_type}{test.test_type === 'clearance' ? ` · ${test.tolerance_mm} mm` : ''}</p>
      <div className="flex flex-wrap gap-2 items-center"><label>Scope <select className={input} value={options.scope} onChange={e => setOptions({ ...options, scope: e.target.value as 'all' | 'visible' })}><option value="all">All collection elements</option><option value="visible">Visible collection elements</option></select></label>
        <label>Scene units <select className={input} value={options.metresPerUnit} onChange={e => setOptions({ ...options, metresPerUnit: Number(e.target.value) })}><option value={1}>Metres</option><option value={.001}>Millimetres</option><option value={.3048}>Feet</option><option value={.0254}>Inches</option></select></label>
        <label>Date (optional) <input className={input} type="date" value={options.date ?? ''} onChange={e => setOptions({ ...options, date: e.target.value || undefined })} /></label>
      </div>
      {options.date && <div className="flex flex-wrap gap-2"><label>End date (optional sweep) <input className={input} type="date" min={options.date} value={options.endDate ?? ''} onChange={e => setOptions({ ...options, endDate: e.target.value || undefined })} /></label>{options.endDate && <label>Sample every <input className={input} type="number" min={1} max={365} value={options.stepDays ?? 1} onChange={e => setOptions({ ...options, stepDays: Number(e.target.value) })} /> days (max. 31 samples)</label>}</div>}
      {options.endDate && <p>Each sample saves a separate run. Events between samples are not tested; review the run history for first and last observed clashes.</p>}
      <p className="text-gray-500 dark:text-prosota-muted">Checks loaded geometry at the current or selected date. Visible scope excludes hidden whole elements; section cuts do not trim test geometry. Models must share the chosen scene units.</p>
      <button className={button} disabled={!!props.runProgress || busy || !collectionA?.members.length || !collectionB?.members.length} onClick={() => void action(async () => { setView(null); await props.onRun(test.id, options) })}>{props.runProgress?.testId === test.id ? (props.runProgress.saving ? 'Saving snapshot…' : `Testing ${props.runProgress.done}/${props.runProgress.total}…`) : 'Check geometry & run'}</button>
      {props.runProgress?.testId === test.id && <button className={button} disabled={props.runProgress.saving} onClick={props.onCancelRun}>Cancel run</button>}
      {test.last_run_at && <span> Last run {new Date(test.last_run_at).toLocaleString()}</span>}
      {selectedRun && selectedRun.results.length === 0 && <p className="text-green-600">No clashes found in this run’s scope. Previously detected results remain available; excluded elements have not been rechecked.</p>}
      {runs.length > 0 && <><label className="block">Run history <select className={input} value={selectedRun?.id ?? ''} onChange={e => { void action(() => loadRun(e.target.value)); setSelected(new Set()); setPage(0); setShare(null) }}>{runs.map(r => <option key={r.id} value={r.id}>{new Date(r.run_at).toLocaleString()} · {r.scope} · {r.result_count ?? r.results.length} clashes</option>)}</select></label><p>{selectedRun?.resolved} members tested · {selectedRun?.excluded} excluded · {selectedRun?.timeline_date ?? 'Static scene'}</p>{!!selectedRun?.warnings.length && <details><summary>Geometry limitations</summary>{selectedRun.warnings.map((w, i) => <p key={i}>{w}</p>)}</details>}</>}
      {selectedRun && (selectedRun.test_type !== test.test_type || selectedRun.tolerance_mm !== test.tolerance_mm || (selectedRun.collection_a_id && selectedRun.collection_a_id !== test.group_a_collection_id) || (selectedRun.collection_b_id && selectedRun.collection_b_id !== test.group_b_collection_id)) && <p className="text-amber-600">Test settings changed since this run. Run again to check the new settings.</p>}
      <div className="flex flex-wrap gap-2"><input className={input} placeholder="Search clashes or notes" value={query} onChange={e => { setQuery(e.target.value); setPage(0) }} /><select aria-label="Filter status" className={input} value={status} onChange={e => { setStatus(e.target.value); setPage(0) }}><option value="unresolved">Unresolved</option><option value="all">All statuses</option>{statuses.map(s => <option key={s} value={s}>{statusName(s)}</option>)}</select><label>Group <select className={input} value={group} onChange={e => { setGroup(e.target.value); setPage(0) }}><option value="none">None</option><option value="element">Element A</option><option value="model">Model A</option><option value="type">Type A</option><option value="level">Level A</option><option value="status">Status</option></select></label></div>
      <div className="flex flex-wrap gap-2"><button className={button} onClick={() => setSelected(new Set(filtered.map(r => r.id)))}>Select filtered ({filtered.length})</button><button className={button} onClick={() => setSelected(new Set())}>Clear selection</button><select aria-label="Bulk status" className={input} value="" disabled={!selected.size || historical || busy} onChange={e => void action(async () => { const status = e.target.value as ClashResult['status']; for (const id of selected) await props.onUpdateResult(id, { status }); setSelected(new Set()) })}><option value="">Update selected…</option>{statuses.filter(s => s !== 'resolved').map(s => <option key={s} value={s}>{statusName(s)}</option>)}</select><button className={button} disabled={!shareable.length || busy} onClick={() => void action(openShare)}>Send report ({shareable.length})</button><button className={button} onClick={() => void action(openShare)}>Manage shared reports</button></div>
      <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr><th /><th>A / B</th><th>Gap</th><th>Status / notes</th></tr></thead><tbody>{shown.map((r, i) => <tr key={r.id} className="border-t dark:border-prosota-line align-top">
        <td className="py-2"><input aria-label={`Select ${r.element_a_label} / ${r.element_b_label}`} type="checkbox" checked={selected.has(r.id)} onChange={e => setSelected(old => { const next = new Set(old); if (e.target.checked) next.add(r.id); else next.delete(r.id); return next })} /></td>
        <td className="p-2"><button className="text-left text-blue-600 dark:text-blue-400" onClick={() => void action(() => inspect(r))}>{group !== 'none' && (i === 0 || groupName(shown[i - 1]) !== groupName(r)) && <><strong>{groupName(r)}</strong><br /></>}{r.element_a_label}<br />{r.element_b_label}</button><br /><button className={button} disabled={historical || busy || !!r.issue_id} onClick={() => void action(async () => { setIssueResult(r); const values = (await api.get('/api/v1/periods/', { params: { project_id: test.project_id } })).data; setPeriods(values.filter((p: { freeze_status: string }) => p.freeze_status === 'live')); setPeriodId(values.find((p: { freeze_status: string }) => p.freeze_status === 'live')?.id ?? '') })}>{r.issue_id ? 'Issue linked' : 'Create issue'}</button></td>
        <td className="p-2 whitespace-nowrap">{!historical && selectedRun && !selectedRun.results.some(x => x.id === r.id) && r.status !== 'resolved' && <span className="block text-amber-600">Not rechecked</span>}{r.distance_mm === null ? 'Hard' : `${r.distance_mm.toFixed(2)} mm`}</td>
        <td className="p-2"><select className={input} disabled={historical || busy || r.status === 'resolved'} value={r.status} onChange={e => void action(() => props.onUpdateResult(r.id, { status: e.target.value as ClashResult['status'] }))}>{statuses.map(s => <option key={s} value={s} disabled={s === 'resolved'}>{statusName(s)}</option>)}</select><textarea key={`${r.id}:${r.updated_at}`} aria-label="Review notes" className={input + ' block mt-1 w-full'} maxLength={4000} disabled={historical} defaultValue={r.comment ?? ''} onBlur={e => { if (e.target.value !== (r.comment ?? '')) void action(() => props.onUpdateResult(r.id, { comment: e.target.value })) }} />{!!r.review_history?.length && <details><summary>Review history ({r.review_history.length})</summary>{r.review_history.map((h, i) => <p key={i}>{new Date(h.at).toLocaleString()} · {h.changes.status ?? h.before.status} · {h.changes.comment ?? h.before.comment}</p>)}</details>}</td>
      </tr>)}</tbody></table></div>
      {filtered.length > 50 && <div><button className={button} disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</button> Page {page + 1} of {Math.ceil(filtered.length / 50)} <button className={button} disabled={(page + 1) * 50 >= filtered.length} onClick={() => setPage(p => p + 1)}>Next</button></div>}
      {error && <p role="alert" className="text-red-500">{error}</p>}{notice && <p role="status">{notice}</p>}
      {issueResult && <form className="space-y-2 border border-gray-200 dark:border-prosota-line rounded p-2" onSubmit={e => { e.preventDefault(); void action(async () => { const result = (await api.post(`/api/v1/clash-review/${test.id}/results/${issueResult.id}/issue`, { period_id: periodId, owner, due_date: due || null })).data; props.onChanged({ ...test, results: test.results.map(r => r.id === issueResult.id ? { ...r, issue_id: result.id } : r) }); setNotice(`Issue ${result.code} created in Issues, Changes & Decisions.`); setIssueResult(null) }) }}><strong>Create linked issue</strong><select className={input} required value={periodId} onChange={e => setPeriodId(e.target.value)}>{periods.map(p => <option key={p.id} value={p.id}>{p.period_label}</option>)}</select>{!periods.length && <p>A live reporting period is required.</p>}<input className={input} placeholder="Responsible person" value={owner} onChange={e => setOwner(e.target.value)} /><input aria-label="Due date" className={input} type="date" value={due} onChange={e => setDue(e.target.value)} /><button disabled={busy || !periodId} className={button}>Create issue</button><button type="button" className={button} onClick={() => setIssueResult(null)}>Cancel</button></form>}
      {sharing && createPortal(<div className="fixed inset-0 z-[110] bg-black/50 flex items-center justify-center p-6" role="dialog" aria-modal="true" aria-label="Send clash report"><div className="bg-white dark:bg-prosota-panel text-gray-800 dark:text-prosota-paper text-sm space-y-3 p-5 rounded-lg w-full max-w-xl max-h-[90vh] overflow-auto"><strong>Send report · {shareable.length} selected/filtered clashes</strong><p>Includes the selected clashes and their geometry. Optional context adds other clash elements captured in this saved run; it does not add their results or review notes. Plain mesh imports are whole-file elements: a clash involving one includes its mesh geometry. Anyone with the link can view it until expiry or revocation.</p><label>Expires after <input className={input} type="number" min={1} max={90} value={days} onChange={e => setDays(Number(e.target.value))} /> days</label><label className="block"><input type="checkbox" checked={comments} onChange={e => setComments(e.target.checked)} /> Allow external reviewer comments</label><label className="block"><input type="checkbox" checked={includeContext} onChange={e => setIncludeContext(e.target.checked)} /> Include other saved clash elements as 3D context</label><p className="text-xs">Context can include geometry across the saved run, not just nearby elements. It does not include the full source model. Existing links stay unchanged; create a new link to change what is included.</p>
        <button className={button} disabled={busy || !shareable.length || !Number.isInteger(days) || days < 1 || days > 90} onClick={() => void action(async () => { const value = (await api.post(`/api/v1/clash-review/${test.id}/reports`, { run_id: selectedRun?.id, result_ids: shareable.map(r => r.id), expires_days: days, allow_comments: comments, include_context: includeContext, viewpoints, up_axis: selectedRun?.up_axis ?? props.upAxis, background_color: selectedRun?.background_color ?? props.backgroundColor })).data; setShare(value); await openShare() })}>Create review link</button>
        {link && <><input aria-label="Report link" className={input + ' w-full'} readOnly value={link} /><button className={button} onClick={() => void action(async () => { await navigator.clipboard.writeText(link); setNotice('Link copied') })}>Copy link</button><a href={link} target="_blank" rel="noreferrer" className={button}>Preview report</a><form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); void action(async () => { await api.post(`/api/v1/clash-review/${test.id}/reports/${share!.id}/email`, { recipient, token: share!.token }); setNotice('Report email sent.') }) }}><input className={input} type="email" required placeholder="Recipient email" value={recipient} onChange={e => setRecipient(e.target.value)} /><button disabled={busy} className={button}>Send email</button><a className={button} href={`mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent('Prosota clash report: ' + test.name)}&body=${encodeURIComponent('Please review this clash report:\n' + link)}`}>Open email app</a></form></>}
        <details><summary>Existing shared reports ({shares.length})</summary>{shares.map(r => <div key={r.id} className="py-2 border-t"><span>{r.created_at && new Date(r.created_at).toLocaleString()} · Expires {new Date(r.expires_at).toLocaleDateString()} · {r.revoked ? 'Revoked' : 'Shared'}</span><button className={button} disabled={r.revoked || busy} onClick={() => void action(async () => { await api.delete(`/api/v1/clash-review/${test.id}/reports/${r.id}`); if (share?.id === r.id) setShare(null); await openShare() })}>Revoke</button>{r.comments?.map((c, i) => <p key={i}>{c.name} (external): {c.text}</p>)}</div>)}</details><button className={button} onClick={() => setSharing(false)}>Close sharing</button>
        {error && <p role="alert" className="text-red-500">{error}</p>}{notice && <p role="status">{notice}</p>}{busy && <p role="status">Working…</p>}
      </div></div>, document.body)}
    </>}
    {view && current && createPortal(<div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-6" role="dialog" aria-modal="true" aria-label="Clash review"><div className="bg-white dark:bg-prosota-panel p-4 rounded-lg w-full max-w-5xl max-h-[95vh] overflow-auto"><div className="flex justify-between"><h3 className="font-semibold">{view.name} · {new Date(view.run_at).toLocaleString()}</h3><button className={button} onClick={() => setView(null)}>Close</button></div><ClashViewport geometry={view.geometry ?? []} result={current} upAxis={view.up_axis ?? props.upAxis} backgroundColor={view.background_color ?? props.backgroundColor} onViewpoint={v => setViewpoints(old => ({ ...old, [current.id]: v }))} /><p>Saved run geometry · {current.distance_mm === null ? 'Hard intersection' : `${current.distance_mm} mm clearance`}</p></div></div>, document.body)}
  </section>
}
export function ClashDetectionPanel(props: Props) {
  const [creating, setCreating] = useState(false)
  return <div className="flex-1 overflow-auto text-gray-800 dark:text-prosota-paper"><header className="p-3 flex justify-between items-center"><strong className="text-sm">Clash Detective</strong><button className={button} disabled={!props.collections.length || !!props.runProgress} onClick={() => setCreating(!creating)}>+ Add test</button></header>{props.error && <p role="alert" className="px-3 text-xs text-red-500">{props.error}</p>}{creating && <TestForm collections={props.collections} save={props.onCreate} cancel={() => setCreating(false)} />}{!props.clashTests.length && <p className="p-3 text-xs">Create collections, then add a test to compare their elements.</p>}{props.clashTests.map(test => <TestItem key={test.id} test={test} props={props} />)}</div>
}
