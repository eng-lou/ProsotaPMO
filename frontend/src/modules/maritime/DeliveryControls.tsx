import { DEFAULT_DELIVERY, dateLabel, gbp, timestamp, type DeliveryInputs, type DeliveryResult } from './delivery'

export function DeliveryControls({ inputs, change, result, loading, error, retry, baseline, setBaseline }: {
  inputs: DeliveryInputs; change: (v: DeliveryInputs) => void; result: DeliveryResult | null; loading: boolean; error: string; retry: () => void; baseline: boolean; setBaseline: (v: boolean) => void
}) {
  return <>
    <span className="mt-eyebrow">4D / 5D DELIVERY</span><h2>Bring the next berth online.</h2>
    <p>Test a working-duration extension. Prosota recalculates dependencies, resource demand and forecast cost.</p>
    <label>Programme start<input type="date" min="2020-01-01" max="2040-12-31" value={inputs.start_date} onChange={e => change({ ...inputs, start_date: e.target.value })}/></label>
    <label>Delay activity<select aria-label="Delay activity" value={inputs.delay_activity} onChange={e => change({ ...inputs, delay_activity: e.target.value })}>
      {[['foundation','Crane foundation'],['deck','Berth deck'],['procurement','Crane procurement'],['installation','Crane installation'],['commission','Commissioning']].map(([id,name]) => <option key={id} value={id}>{name}</option>)}
    </select></label>
    <label>Additional working days<input type="number" min={0} max={90} step={1} value={inputs.delay_days} onChange={e => change({ ...inputs, delay_days: Number(e.target.value) })}/></label>
    <label>Site overhead (£ / working day)<input type="number" min={0} max={100000} value={inputs.overhead_day_rate} onChange={e => change({ ...inputs, overhead_day_rate: Number(e.target.value) })}/></label>
    <div className="mt-segment"><button aria-pressed={!baseline} onClick={() => setBaseline(false)}>Scenario sequence</button><button aria-pressed={baseline} onClick={() => setBaseline(true)}>Baseline sequence</button></div>
    {loading && <p role="status">Calculating with Prosota…</p>}
    {error && <div role="alert"><p>{error}</p><button onClick={retry}>Retry calculation</button></div>}
    {result && <p className="mt-explanation">Readiness moves by <strong>{result.impact.working_days} working days</strong> ({result.impact.calendar_days} calendar days), with {gbp(result.impact.cost)} additional forecast cost. Procurement runs in parallel and has {result.baseline.activities.find(a => a.id === 'procurement')?.float_days} working days of baseline float.</p>}
    <button onClick={() => change({ ...DEFAULT_DELIVERY })}>Restore delivery scenario</button>
    <p className="mt-footnote">Mon–Fri · 8 hours/day · Synthetic GBP rates. Additional duration consumes crew and plant time; material quantities remain fixed. No actual progress is assumed.</p>
  </>
}

export function DeliveryKpis({ result }: { result: DeliveryResult }) {
  return <div className="mt-kpis">
    <article><span>Baseline readiness</span><strong>{dateLabel(result.baseline.finish)}</strong><small>{result.baseline.working_days} working days</small></article>
    <article><span>Scenario readiness</span><strong>{dateLabel(result.scenario.finish)}</strong><small>+{result.impact.working_days} working days</small></article>
    <article><span>Forecast cost</span><strong>{gbp(result.scenario.total_cost)}</strong><small>Baseline {gbp(result.baseline.total_cost)} · +{gbp(result.impact.cost)}</small></article>
    <article><span>Additional resource demand</span><strong>+{result.impact.resource_hours} h</strong><small>Crew / equipment assignment hours</small></article>
  </div>
}

export function DeliveryAnalysis({ result, select, day }: { result: DeliveryResult; select: (id: string, date: string) => void; day: number }) {
  const origin = timestamp(result.inputs.start_date), span = Math.max(timestamp(result.scenario.finish), timestamp(result.baseline.finish)) - origin
  const pos = (date: string) => (timestamp(date) - origin) / span * 100
  const plot = result.scenario.daily, base = result.baseline.daily
  const maxCost = Math.max(result.scenario.total_cost, result.baseline.total_cost, 1)
  const points = (series: typeof plot) => series.map(p => `${35 + pos(p.date) * 5.3},${165 - p.cumulative_cost / maxCost * 140}`).join(' ')
  return <section className="mt-card mt-delivery-analysis">
    <div className="mt-card-head"><h2>Berth expansion programme</h2><span>Grey: baseline · Teal: scenario · Amber: critical</span></div>
    <div className="mt-table-scroll"><table className="mt-programme"><thead><tr><th>Activity / predecessor</th><th>Baseline finish</th><th>Scenario finish</th><th>Work days</th><th>Float</th><th>Sequence</th></tr></thead><tbody>
      {result.scenario.activities.map((a,i) => { const b = result.baseline.activities[i]; return <tr key={a.id}>
        <td><button onClick={() => select(a.asset_id, a.start)}>{a.name}</button><small>{a.predecessors.length ? `After ${a.predecessors.join(', ')}` : 'Programme start'}{a.critical ? ' · Critical' : ''}</small></td>
        <td>{dateLabel(b.finish)}</td><td>{dateLabel(a.finish)}</td><td>{a.duration_days}</td><td>{a.float_days} d</td>
        <td><div className="mt-gantt-track"><i style={{left:`${pos(b.start)}%`,width:`${Math.max(.5,pos(b.finish)-pos(b.start))}%`}}/><b style={{left:`${pos(a.start)}%`,width:`${Math.max(.5,pos(a.finish)-pos(a.start))}%`,background:a.critical?'#e6b465':'#6cdbc8'}}/><em style={{left:`${Math.min(100,day*86400000/span*100)}%`}}/></div></td>
      </tr>})}
    </tbody></table></div>
    <div className="mt-lower-grid"><div><h3>Resource and cost impacts</h3><div className="mt-table-scroll"><table><thead><tr><th>Resource</th><th>Rate</th><th>Baseline h</th><th>Scenario h</th><th>Cost change</th></tr></thead><tbody>{result.scenario.resources.map((r,i) => <tr key={r.id}><td>{r.name}</td><td>{gbp(r.rate)}/{r.rate_unit}</td><td>{r.hours ? result.baseline.resources[i].hours : '—'}</td><td>{r.hours || '—'}</td><td>{gbp(r.cost-result.baseline.resources[i].cost)}</td></tr>)}</tbody></table></div><p className="mt-footnote">Hours represent each named crew or plant assignment, not individual workers. This does not perform resource levelling.</p></div>
    <div><h3>Forecast cost over time</h3><svg viewBox="0 0 600 200" role="img" aria-label={`Cumulative planned cost: baseline ${gbp(result.baseline.total_cost)}, scenario ${gbp(result.scenario.total_cost)}`}>
      {[0,.5,1].map(f => <g key={f}><line x1="35" y1={165-f*140} x2="570" y2={165-f*140} stroke="#365260"/><text x="36" y={160-f*140} fill="#a9bdc7" fontSize="10">{gbp(maxCost*f)}</text></g>)}
      <polyline points={points(base)} fill="none" stroke="#8c9eaa" strokeWidth="2"/><polyline points={points(plot)} fill="none" stroke="#6cdbc8" strokeWidth="3"/>
      <text x="35" y="190" fill="#a9bdc7" fontSize="10">{dateLabel(result.inputs.start_date)}</text><text x="570" y="190" textAnchor="end" fill="#a9bdc7" fontSize="10">{dateLabel(result.scenario.finish)}</text>
    </svg><p>Direct work: {gbp(result.baseline.direct_cost)} → {gbp(result.scenario.direct_cost)}<br/>Site overhead: {gbp(result.baseline.overhead_cost)} → {gbp(result.scenario.overhead_cost)}</p>
    <details><summary>Calculation assumptions</summary><ul>{result.assumptions.map(a => <li key={a}>{a}</li>)}</ul></details></div></div>
  </section>
}
