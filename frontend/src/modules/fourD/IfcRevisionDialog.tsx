import { useEffect, useRef, useState } from 'react'
import axios from 'axios'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { api } from '@/lib/api'
import { maybeCompress } from '@/lib/fileCache'
import { uploadDirectToStorage } from '@/lib/directUpload'
import { revisionImage, revisionScene, type RevisionGeometry } from './ifcRevisionVisual'

interface Snapshot { name: string; type: string; area: { m2: number; basis: string } | null; properties: Record<string, unknown> }
interface Change { guid: string; kind: 'added' | 'modified' | 'removed'; fields: string[]; before: Snapshot | null; after: Snapshot | null; assignments: { id: string; code: string; name: string; resource_count?: number; cost_count?: number }[] }
interface Decision { action: 'accept' | 'reject'; assignments: 'keep' | 'remove'; rationale: string }
interface Review { id: string; name: string; baseline_name: string; created_at: string; applied_at?: string; status: string; report?: { changes: Change[]; unchanged: number }; decisions?: Record<string, Decision> }
const errorText = (e: unknown) => axios.isAxiosError(e) ? String(e.response?.data?.detail ?? e.message) : String(e)
const button = 'border border-gray-300 dark:border-prosota-line rounded px-3 py-1.5 text-xs disabled:opacity-40'
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))

function GeometryView({ data }: { data: RevisionGeometry }) {
  const host = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState('overlay')
  useEffect(() => {
    if (!host.current) return
    const view = revisionScene(data)
    view.meshes.forEach(m => { m.visible = mode === 'overlay' || m.name === mode; if (mode !== 'overlay') (m.material as THREE.MeshStandardMaterial).wireframe = false })
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    host.current.appendChild(renderer.domElement)
    const controls = new OrbitControls(view.camera, renderer.domElement)
    const render = () => renderer.render(view.scene, view.camera)
    controls.addEventListener('change', render)
    const resize = new ResizeObserver(() => {
      const width = host.current?.clientWidth || 600
      renderer.setSize(width, 280)
      view.camera.aspect = width / 280; view.camera.updateProjectionMatrix(); render()
    })
    resize.observe(host.current)
    return () => { resize.disconnect(); controls.dispose(); view.dispose(); renderer.dispose(); renderer.domElement.remove(); renderer.forceContextLoss() }
  }, [data, mode])
  return <div><div className="flex gap-2 mb-2">{['overlay', 'before', 'after'].map(m => <button key={m} className={button} onClick={() => setMode(m)} aria-pressed={mode === m}>{m}</button>)}</div>
    <div ref={host} className="h-[280px] rounded overflow-hidden" /><p className="text-xs mt-1">Orange: current · Green: proposed · Drag to orbit, scroll to zoom. Source coordinates; local placement overrides are excluded.</p></div>
}

export function IfcRevisionDialog({ fileId, fileName, onClose }: { fileId: string; fileName: string; onClose: () => void }) {
  const [history, setHistory] = useState<Review[]>([])
  const [review, setReview] = useState<Review | null>(null)
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const [selected, setSelected] = useState('')
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [geometry, setGeometry] = useState<RevisionGeometry | null>(null)
  const geometryCache = useRef(new Map<string, RevisionGeometry>())
  const base = `/api/v1/model3d-files/${fileId}/revisions`
  const changes = review?.report?.changes ?? []
  const active = changes.find(c => c.guid === selected)
  const applied = review?.status === 'applied'
  const complete = changes.every(c => decisions[c.guid] && (decisions[c.guid].action !== 'reject' || decisions[c.guid].rationale.trim()))
  useEffect(() => { api.get<Review[]>(base).then(r => setHistory(r.data)).catch(e => setError(errorText(e))) }, [base])
  const openReview = (r: Review) => { setReview(r); setDecisions(r.decisions ?? {}); setSelected(r.report?.changes[0]?.guid ?? ''); setError('') }
  const getGeometry = async (r: Review, guid: string) => {
    const key = `${r.id}:${guid}`
    const cached = geometryCache.current.get(key)
    if (cached) return cached
    const { data } = await api.get<RevisionGeometry>(`${base}/${r.id}/geometry/${encodeURIComponent(guid)}`, { timeout: 240000 })
    geometryCache.current.set(key, data)
    return data
  }
  useEffect(() => {
    let cancelled = false
    setGeometry(null)
    if (review && selected) getGeometry(review, selected).then(data => { if (!cancelled) setGeometry(data) }).catch(e => { if (!cancelled) setError(errorText(e)) })
    return () => { cancelled = true }
  }, [review?.id, selected]) // eslint-disable-line react-hooks/exhaustive-deps
  const upload = async (file: File) => {
    setBusy('Uploading revision…'); setError('')
    try {
      const { data } = await api.post<{ id: string; upload_url: string }>(base, { name: file.name })
      await uploadDirectToStorage(data.upload_url, await maybeCompress(file, true), 'application/gzip')
      setBusy('Comparing geometry, properties and assignments…')
      const result = await api.post<Review>(`${base}/${data.id}/compare`, {}, { timeout: 240000 })
      openReview(result.data); setHistory(h => [...h, result.data])
    } catch (e) { setError(errorText(e)) } finally { setBusy('') }
  }
  const decide = (guid: string, patch: Partial<Decision>) => setDecisions(d => ({ ...d, [guid]: { ...(d[guid] ?? { action: 'accept', assignments: 'keep', rationale: '' }), ...patch } }))
  const saveDraft = async () => {
    if (!review || applied) return
    setBusy('Saving review draft…'); setError('')
    try {
      const { data } = await api.put<Review>(`${base}/${review.id}/draft`, { decisions })
      setHistory(h => h.map(r => r.id === data.id ? data : r))
    } catch (e) { setError(errorText(e)) } finally { setBusy('') }
  }
  const apply = async () => {
    if (!review || !complete) return
    setBusy('Validating and applying reviewed changes…'); setError('')
    try {
      const { data } = await api.post<Review>(`${base}/${review.id}/apply`, { decisions }, { timeout: 240000 })
      setReview(data); setHistory(h => h.map(r => r.id === data.id ? data : r))
    } catch (e) { setError(errorText(e)) } finally { setBusy('') }
  }
  const exportReport = async () => {
    if (!review) return
    setBusy('Preparing visual report…'); setError('')
    try {
      const sections: string[] = []
      for (const [index, c] of changes.entries()) {
        setBusy(`Rendering report ${index + 1} / ${changes.length}…`)
        let visual = ''
        try { visual = `<img alt="Current orange, proposed green" src="${revisionImage(await getGeometry(review, c.guid))}">` }
        catch (e) { visual = `<p>Geometry preview unavailable: ${escapeHtml(errorText(e))}</p>` }
        const d = decisions[c.guid]
        sections.push(`<section><h2>${escapeHtml(c.kind)}: ${escapeHtml((c.after ?? c.before)?.name)}</h2><p>${escapeHtml(c.guid)} · ${escapeHtml(c.fields.join(', '))}</p>${visual}<p>Decision: ${escapeHtml(d?.action ?? 'Pending')}; assignments: ${c.kind === 'removed' && d?.action === 'accept' ? 'remove' : escapeHtml(d?.assignments ?? 'Pending')}</p><p>Rationale: ${escapeHtml(d?.rationale)}</p><p>Activity links: ${escapeHtml(c.assignments.map(a => `${a.code}: ${a.name} (${a.resource_count ?? 0} resources, ${a.cost_count ?? 0} cost records retained)`).join('; ') || 'None')}</p><table><tr><th>Current</th><th>Proposed</th></tr><tr><td><pre>${escapeHtml(JSON.stringify(c.before, null, 2))}</pre></td><td><pre>${escapeHtml(JSON.stringify(c.after, null, 2))}</pre></td></tr></table></section>`)
      }
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>IFC revision review</title><style>body{font:14px system-ui;max-width:1000px;margin:40px auto;color:#16243a}section{break-inside:avoid;border-top:1px solid #ccd;padding:20px 0}img{width:720px;max-width:100%}table{table-layout:fixed;width:100%}td{vertical-align:top;width:50%}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px}h1{color:#3157a5}</style></head><body><h1>Prosota Planner · IFC revision review</h1><p>${escapeHtml(fileName)} → ${escapeHtml(review.name)}</p><p>Review ${escapeHtml(review.id)} · ${escapeHtml(review.status)} · ${escapeHtml(review.applied_at ?? review.created_at)}</p><p>${changes.length} changes; ${review.report?.unchanged ?? 0} unchanged. Orange: current; green: proposed. Accepted source changes reset local element placement overrides. BOQ quantities require review; shared activities/resources/cost records are retained.</p>${sections.join('')}</body></html>`
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
      const a = document.createElement('a'); a.href = url; a.download = `IFC-review-${review.id}.html`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000)
    } catch (e) { setError(errorText(e)) } finally { setBusy('') }
  }
  const visible = changes.filter(c => (filter === 'all' || c.kind === filter) && `${c.guid} ${(c.after ?? c.before)?.name}`.toLowerCase().includes(search.toLowerCase()))
  return <div className="fixed inset-0 z-[70] bg-black/60 flex items-center justify-center p-5"><div className="bg-white dark:bg-prosota-panel text-gray-800 dark:text-prosota-paper border dark:border-prosota-line rounded-xl w-[1150px] max-w-full h-[90vh] flex flex-col shadow-2xl">
    <header className="p-4 border-b dark:border-prosota-line flex justify-between gap-4"><div><h2 className="text-lg font-bold">Review IFC revision</h2><p className="text-xs">{fileName} · Match by GlobalId. Nothing changes until you apply your decisions.</p></div><button className={button} disabled={!!busy || applied} onClick={onClose}>Close</button></header>
    <div className="p-3 flex gap-3 items-center border-b dark:border-prosota-line"><label className={button}>Choose revised IFC<input type="file" accept=".ifc,.gz" disabled={!!busy || applied} className="block text-xs mt-1" onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = '' }} /></label>
      <select aria-label="Saved reviews" disabled={!!busy || applied} className="bg-transparent border rounded p-2 text-xs max-w-xs" value={review?.id ?? ''} onChange={e => { const r = history.find(r => r.id === e.target.value); if (r) openReview(r) }}><option value="">Saved reviews…</option>{history.filter(r => r.report).map(r => <option key={r.id} value={r.id}>{r.name} · {r.status}</option>)}</select>
      {review && <span className="text-xs">{changes.length} changed · {review.report?.unchanged} unchanged</span>}</div>
    {error && <p role="alert" className="p-3 text-red-500 text-sm">{error}</p>}{busy && <p role="status" className="px-3 py-2 text-sm text-blue-500">{busy}</p>}
    {review?.report ? <div className="flex flex-1 overflow-hidden"><aside className="w-72 shrink-0 border-r dark:border-prosota-line flex flex-col p-3 gap-2"><input aria-label="Search changes" placeholder="Name or GlobalId…" value={search} onChange={e => setSearch(e.target.value)} className="bg-transparent border rounded p-2 text-xs" /><select aria-label="Filter changes" value={filter} onChange={e => setFilter(e.target.value)} className="bg-transparent border rounded p-2 text-xs">{['all','added','modified','removed'].map(f => <option key={f}>{f}</option>)}</select><button className={button} disabled={!!busy || applied} onClick={() => setDecisions(d => Object.fromEntries(changes.map(c => [c.guid, { ...(d[c.guid] ?? { assignments: 'keep', rationale: '' }), action: 'accept' }]))) }>Accept all · keep assignments</button><div className="overflow-auto flex-1">{visible.map(c => <button key={c.guid} onClick={() => setSelected(c.guid)} className={`block text-left w-full rounded p-2 mb-1 text-xs border ${selected === c.guid ? 'border-blue-500 bg-blue-500/10' : 'border-transparent'}`}><strong className={c.kind === 'removed' ? 'text-orange-500' : c.kind === 'added' ? 'text-emerald-500' : 'text-blue-500'}>{c.kind}</strong> · {decisions[c.guid]?.action ?? 'Pending'}<span className="block truncate">{(c.after ?? c.before)?.name || c.guid}</span></button>)}</div></aside>
      <main className="p-4 overflow-auto flex-1">{active ? <><h3 className="font-bold">{(active.after ?? active.before)?.name || '(unnamed)'}</h3><p className="text-xs mb-3">{active.guid} · {active.fields.join(', ') || active.kind}</p>{geometry ? <GeometryView data={geometry} /> : <p className="text-sm py-12">Loading source geometry…</p>}
        <div className="mt-4 flex gap-2"><button className={button} disabled={!!busy || applied} aria-pressed={decisions[active.guid]?.action === 'accept'} onClick={() => decide(active.guid, { action: 'accept' })}>Accept change</button><button className={button} disabled={!!busy || applied} aria-pressed={decisions[active.guid]?.action === 'reject'} onClick={() => decide(active.guid, { action: 'reject' })}>Reject · retain current</button></div>
        {decisions[active.guid]?.action === 'reject' && <label className="block text-xs mt-3">Rejection rationale (required)<textarea className="block w-full mt-1 bg-transparent border rounded p-2" value={decisions[active.guid].rationale} maxLength={4000} disabled={applied || !!busy} onChange={e => decide(active.guid, { rationale: e.target.value })} /></label>}
        {active.kind === 'modified' && decisions[active.guid]?.action === 'accept' && <label className="block text-xs mt-3">Existing assignments <select className="bg-transparent border rounded p-2 ml-2" value={decisions[active.guid].assignments} disabled={applied || !!busy} onChange={e => decide(active.guid, { assignments: e.target.value as 'keep' | 'remove' })}><option value="keep">Keep assignments</option><option value="remove">Remove element assignments</option></select></label>}
        <p className="text-xs mt-3">{active.kind === 'removed' ? 'Accepting removal deletes this element’s activity links, custom keyframes and collection membership. ' : ''}Shared activities and their resource/cost records remain. Accepted changes replace local element placement overrides; whole-model placement stays.</p>
        <div className="mt-3 text-xs"><strong>Affected activity links</strong>{active.assignments.length ? active.assignments.map(a => <p key={a.id}>{a.code} · {a.name} · {a.resource_count ?? 0} resources / {a.cost_count ?? 0} cost records (retained)</p>) : <p>None</p>}</div>
        <div className="grid grid-cols-2 gap-3 mt-3 text-xs">{(['before','after'] as const).map(side => <div key={side}><h4 className="font-bold">{side === 'before' ? 'Current' : 'Proposed'}</h4><p>Area: {active[side]?.area ? `${active[side]!.area!.m2} m² (${active[side]!.area!.basis})` : 'Not supplied'}</p><details><summary>Properties</summary><pre className="whitespace-pre-wrap break-all">{JSON.stringify(active[side]?.properties ?? {}, null, 2)}</pre></details></div>)}</div></> : <p>No element changes found.</p>}</main></div> : <p className="p-6 text-sm">Choose the architect’s updated export to compare additions, modifications and removals against this saved model.</p>}
    <footer className="p-3 border-t dark:border-prosota-line flex gap-3 items-center"><p className="text-xs flex-1">{applied ? 'Review saved. Reload to display the approved model and refreshed links.' : 'Rejected changes stay as they are. Accepted revisions flag BOQ quantities for review.'}</p>{!applied && review?.report && <button className={button} disabled={!!busy} onClick={() => void saveDraft()}>Save review draft</button>}<button className={button} disabled={!review?.report || !!busy} onClick={() => void exportReport()}>Export visual report</button>{applied ? <button className={button} disabled={!!busy} onClick={() => window.location.reload()}>Reload approved model</button> : <button className={`${button} bg-blue-600 text-white`} disabled={!review?.report || !complete || !!busy} onClick={() => void apply()}>Apply reviewed changes</button>}</footer>
  </div></div>
}
