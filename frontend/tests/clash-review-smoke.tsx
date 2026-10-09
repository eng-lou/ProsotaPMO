import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../src/index.css'
import * as THREE from 'three'
import { ClashDetectionPanel } from '../src/modules/fourD/ClashDetectionPanel'
import { ClashReportPage } from '../src/modules/fourD/ClashReportPage'
import { api } from '../src/lib/api'
import type { ClashTest } from '../src/modules/fourD/clashTests'
import { captureClashGeometry, computeClashesInWorker } from '../src/modules/fourD/sceneClash'
const now = '2026-10-09T12:00:00Z'
const a = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4)), b = new THREE.Mesh(new THREE.BoxGeometry(1, 6, 1))
b.position.x = 1.5
const geometry = captureClashGeometry([{ ref: { sourceKind: 'mesh', ref: 'wall', label: 'Wall' }, meshes: [a] }, { ref: { sourceKind: 'mesh', ref: 'pipe', label: 'Pipe' }, meshes: [b] }])
const result = { id: 'r1', clash_test_id: 'test1', element_a_source_kind: 'mesh' as const, element_a_ref: 'wall', element_a_label: 'Ground floor wall', element_b_source_kind: 'mesh' as const, element_b_ref: 'pipe', element_b_label: 'Mechanical pipe', distance_mm: null, status: 'new' as const, comment: 'Review the service penetration.', created_at: now, updated_at: now, clash_point: [1.5, 2, 0] as [number, number, number] }
const initial: ClashTest = { id: 'test1', project_id: 'p1', name: 'Structure vs services', group_a_collection_id: 'a', group_b_collection_id: 'b', test_type: 'hard', tolerance_mm: 0, last_run_at: now, created_at: now, updated_at: now, results: [result] }
const snapshot = { id: 'run1', name: initial.name, test_type: 'hard', tolerance_mm: 0, run_at: now, scope: 'all', timeline_date: null, expected: 2, resolved: 2, excluded: 0, warnings: [], results: [result], geometry }
api.defaults.adapter = async config => {
  let data: unknown = {}
  if (config.url?.endsWith('/runs')) data = [snapshot]
  else if (config.url?.endsWith('/runs/run1')) data = snapshot
  else if (config.url?.endsWith('/reports')) data = config.method === 'post' ? { id: 'share1', token: 'mock-token', expires_at: '2026-10-23T12:00:00Z' } : []
  else if (config.url?.includes('/periods/')) data = [{ id: 'period1', period_label: 'October', freeze_status: 'live' }]
  return { data, status: 200, statusText: 'OK', headers: {}, config }
}
if (new URLSearchParams(location.search).has('public')) {
  window.fetch = async () => new Response(JSON.stringify({ snapshot, expires_at: '2026-10-23T12:00:00Z', allow_comments: true, comments: [] }), { headers: { 'Content-Type': 'application/json' } })
  createRoot(document.getElementById('root')!).render(<ClashReportPage />)
} else {
  function Smoke() {
    const [test, setTest] = useState(initial), [dark, setDark] = useState(true), [notice, setNotice] = useState('')
    return <div className={dark ? 'dark' : ''}><main className="min-h-screen p-4 bg-slate-100 dark:bg-prosota-ink"><button onClick={() => setDark(!dark)}>Toggle theme</button><p role="status">{notice}</p><div style={{ width: 520, maxWidth: '100%' }} className="bg-white dark:bg-prosota-panel rounded-lg border"><ClashDetectionPanel collections={['a', 'b'].map((id, i) => ({ id, project_id: 'p1', parent_collection_id: null, name: i ? 'Services' : 'Structure', sort_order: null, created_at: now, updated_at: now, members: [{ id: id + '1', collection_id: id, source_kind: 'mesh', element_ref: i ? 'pipe' : 'wall', element_label: i ? 'Pipe' : 'Wall', created_at: now }] }))} clashTests={[test]} error={null} runProgress={null} onChanged={setTest} onCreate={async () => {}} onDelete={() => {}} onCancelRun={() => {}} onSelectPair={() => {}} onRun={async () => { const { hits } = await computeClashesInWorker(geometry, ['mesh:wall'], ['mesh:pipe'], 'hard', 0, 1); setNotice(`Worker completed: ${hits.length} clash`); return test }} onUpdateResult={async (id, data) => setTest(t => ({ ...t, results: t.results.map(r => r.id === id ? { ...r, ...data } : r) }))} /></div></main></div>
  }
  createRoot(document.getElementById('root')!).render(<Smoke />)
}
