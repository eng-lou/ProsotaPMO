import { useRef, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { apiUrl, dateLabel, gbp, readResponse, type DeliveryInputs, type DeliveryResult } from './delivery'
import type { Scenario } from './simulation'

type Proposal = { inputs: DeliveryInputs; impact: DeliveryResult['impact']; finish: string; total_cost: number }
type Message = { role: 'user' | 'assistant'; content: string }

export function MaritimePoe({ delivery, operations, apply, ready }: { delivery: DeliveryInputs; operations: Scenario; apply: (v: DeliveryInputs) => void; ready: boolean }) {
  const { isAuthenticated, loginWithRedirect, getAccessTokenSilently } = useAuth0()
  const [question, setQuestion] = useState(''), [messages, setMessages] = useState<Message[]>([])
  const [proposals, setProposals] = useState<Proposal[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const requestId = useRef(0)
  async function ask(text: string) {
    if (!text.trim() || busy || !ready) return
    const id = ++requestId.current
    setBusy(true); setError(''); setProposals([])
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 120000)
    try {
      const token = await getAccessTokenSilently()
      const response = await fetch(apiUrl('/poe'), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ question: text, delivery, operations, history: messages.slice(-8).map(m => ({ ...m, content: m.content.slice(0, 4000) })) }), signal: controller.signal })
      const data = await readResponse(response)
      if (id === requestId.current) {
        setMessages(m => [...m.slice(-6), { role: 'user', content: text }, { role: 'assistant', content: data.text }])
        setProposals(data.proposals); setQuestion('')
      }
    } catch (e) { if (id === requestId.current) setError(e instanceof Error ? e.message : 'Poe is unavailable. Try again.') }
    finally { clearTimeout(timeout); if (id === requestId.current) setBusy(false) }
  }
  return <section className="mt-card mt-poe"><div className="mt-card-head"><h2>Poe · Maritime assistant</h2><span>Uses calculated scenario results</span></div>
    <p>Ask about the critical path, resource demand or forecast cost. Poe can calculate a proposed delivery scenario for you to apply.</p>
    {!isAuthenticated ? <button onClick={() => loginWithRedirect({ appState: { returnTo: '/maritime/workspace' } })}>Sign in to use Poe</button> : <>
      <div className="mt-poe-prompts">{['Explain the 15-day foundation delay and its cost.', 'What if procurement takes 10 extra working days?', 'Explain the crane outage impact.'].map(q => <button key={q} disabled={busy || !ready} onClick={() => { setQuestion(q); void ask(q) }}>{q}</button>)}</div>
      <div className="mt-poe-history" aria-live="polite">{messages.map((m,i) => <article key={i}><strong>{m.role === 'user' ? 'You' : 'Poe'}</strong><p>{m.content}</p></article>)}</div>
      {proposals.map((p,i) => <div className="mt-explanation" key={i}><strong>Proposed: {p.inputs.delay_activity} +{p.inputs.delay_days} working days</strong><p>Start {dateLabel(p.inputs.start_date)} · Overhead {gbp(p.inputs.overhead_day_rate)}/working day<br/>Readiness {dateLabel(p.finish)} · Forecast {gbp(p.total_cost)} · Impact +{p.impact.working_days} working days / +{gbp(p.impact.cost)}</p><button disabled={busy} onClick={() => { apply(p.inputs); setProposals([]) }}>Apply this scenario</button></div>)}
      <form onSubmit={e => { e.preventDefault(); void ask(question) }}><label htmlFor="mt-poe-question">Ask Poe</label><textarea id="mt-poe-question" value={question} maxLength={2000} rows={2} onChange={e => setQuestion(e.target.value)} placeholder="Why has readiness moved?"/><button disabled={busy || !ready || !question.trim()}>{busy ? 'Poe is calculating…' : 'Send'}</button></form>
      {error && <p role="alert" className="mt-amber">{error}</p>}
    </>}
    <p className="mt-footnote">Answers refer to the inputs when sent. Uses your existing Poe access and allowance. Proposals affect only this demo after you apply them; Construction projects are unchanged.</p>
  </section>
}
