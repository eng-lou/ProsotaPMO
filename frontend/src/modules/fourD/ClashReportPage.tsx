import { unpackSnapshot, readClashTransfer } from './clashSnapshot'
import { useEffect, useState } from 'react'
import { ClashViewport } from './ClashViewport'
import type { ClashRunSnapshot } from './clashTests'

interface Comment { name: string; text: string; result_id: string; created_at: string }
interface Report { snapshot: ClashRunSnapshot; expires_at: string; allow_comments: boolean; comments: Comment[] }
export function ClashReportPage() {
  // Keep bearer links out of the page URL path/query and referrer headers.
  const [token] = useState(() => window.location.hash.slice(1))
  const [report, setReport] = useState<Report | null>(null), [selected, setSelected] = useState('')
  const [error, setError] = useState(''), [name, setName] = useState(''), [text, setText] = useState(''), [busy, setBusy] = useState(false)
  const endpoint = `${import.meta.env.VITE_API_URL ?? ''}/api/v1/public/clash-reports/${encodeURIComponent(token)}`
  useEffect(() => {
    const abort = new AbortController()
    fetch(endpoint, { signal: abort.signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error('This report has expired, was revoked, or is unavailable.')
      const value = await readClashTransfer<any>(await response.json()); value.snapshot = await unpackSnapshot(value.snapshot); setReport(value); setSelected(value.snapshot.results[0]?.id ?? '')
    }).catch(e => { if (e.name !== 'AbortError') setError(e.message) })
    return () => abort.abort()
  }, [endpoint])
  const result = report?.snapshot.results.find(r => r.id === selected)
  async function sendComment() {
    setBusy(true); setError('')
    try {
      const response = await fetch(endpoint + '/comments', { method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, text, result_id: selected }) })
      if (!response.ok) throw new Error('Comment could not be saved. The link may have expired or comments may be disabled.')
      const value = await readClashTransfer<any>(await response.json()); setReport(r => r && ({ ...r, comments: value.comments })); setText('')
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return <main className="clash-report min-h-screen bg-slate-950 text-slate-100 p-6" style={{ colorScheme: 'dark' }}>
    <style>{`@media print { .clash-report { color: #111 !important; background: white !important; padding: 0 !important; } .clash-report button, .clash-report input, .clash-report select { display: none !important; } .clash-report table { width: 100%; border-collapse: collapse; } .clash-report td, .clash-report th { border-bottom: 1px solid #ccc; padding: 6px; } .clash-report tr { break-inside: avoid; } }`}</style>
    <div className="max-w-6xl mx-auto space-y-4"><header><h1 className="text-xl font-semibold">{report?.snapshot.name ?? 'Clash report'}</h1><p className="text-sm text-slate-400">Prosota · Shared review snapshot</p></header>
      {error && <p role="alert" className="text-red-400">{error}</p>}
      {!report && !error && <p>Loading report…</p>}
      {report && <>
        <p className="text-sm">Run: {new Date(report.snapshot.run_at).toLocaleString()} · {report.snapshot.test_type} {report.snapshot.test_type === 'clearance' && `${report.snapshot.tolerance_mm} mm`} · Scope: {report.snapshot.scope} · {report.snapshot.timeline_date ? `Timeline: ${new Date(report.snapshot.timeline_date).toLocaleString()}` : 'Static model'} · Expires {new Date(report.expires_at).toLocaleDateString()}</p>
        <p className="text-xs">Coverage: {report.snapshot.resolved} tested, {report.snapshot.excluded} excluded by scope. Read-only report{report.allow_comments ? ' with reviewer comments' : ''}.</p>
        {report.snapshot.warnings.length > 0 && <details><summary>Geometry limitations ({report.snapshot.warnings.length})</summary>{report.snapshot.warnings.map((w, i) => <p key={i} className="text-xs">{w}</p>)}</details>}
        <label className="block">Clash <select className="bg-slate-800 border border-slate-600 rounded p-2 max-w-full" value={selected} onChange={e => setSelected(e.target.value)}>{report.snapshot.results.map(r => <option key={r.id} value={r.id}>{r.element_a_label} / {r.element_b_label} — {r.status}</option>)}</select></label>
        {result && <><ClashViewport geometry={report.snapshot.geometry ?? []} result={result} viewpoint={report.snapshot.viewpoints?.[result.id]} /><p>Status: {result.status} · {result.distance_mm === null ? 'Hard intersection' : `Gap: ${result.distance_mm.toFixed(2)} mm`}</p><p>{result.comment}</p></>}
        <button className="border rounded px-3 py-1 print:hidden" onClick={() => window.print()}>Print report</button>
        <section><h2 className="font-semibold">Included clashes ({report.snapshot.results.length})</h2><table className="w-full text-left text-sm"><thead><tr><th>A / B</th><th>Status</th><th>Gap</th><th>Notes</th></tr></thead><tbody>{report.snapshot.results.map(r => <tr key={r.id} className="border-b border-slate-700"><td className="py-2"><button className="text-sky-400" onClick={() => setSelected(r.id)}>{r.element_a_label} / {r.element_b_label}</button><span className="hidden print:inline">{r.element_a_label} / {r.element_b_label}</span></td><td>{r.status === 'approved' ? 'Accepted' : r.status}</td><td>{r.distance_mm === null ? 'Hard' : `${r.distance_mm.toFixed(2)} mm`}</td><td>{r.comment}</td></tr>)}</tbody></table></section>
        <section><h2 className="font-semibold">Reviewer comments</h2>{report.comments.filter(c => c.result_id === selected).map((c, i) => <p key={i} className="py-2 text-sm"><strong>{c.name}</strong> (external reviewer, unverified) · {new Date(c.created_at).toLocaleString()}<br />{c.text}</p>)}</section>
        {report.allow_comments && <form className="space-y-2 print:hidden" onSubmit={e => { e.preventDefault(); void sendComment() }}><input required maxLength={100} className="block bg-slate-800 p-2 rounded" placeholder="Your name" value={name} onChange={e => setName(e.target.value)} /><textarea required maxLength={2000} className="block w-full bg-slate-800 p-2 rounded" placeholder="Comment on this clash" value={text} onChange={e => setText(e.target.value)} /><button disabled={busy} className="bg-blue-600 rounded px-3 py-2">{busy ? 'Saving…' : 'Add comment'}</button></form>}
      </>}
    </div>
  </main>
}
