import { useEffect, useState } from 'react'
import { useMaritime, type SavedRun } from './workspaceData'

/** Same live attempt controls in the exercise workspace and imported model viewer. */
export function AttemptControls({onComplete}: {onComplete: (run: SavedRun) => void}) {
  const {attempt, attemptSaving, recordAction, restartAttempt, discardAttempt, finishAttempt} = useMaritime()
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!attempt) return
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [attempt?.startedAt])
  if (!attempt) return null
  return <section className="mw-attempt"><p className="mw-kicker">Exercise in progress</p>
    <h3>{attempt.exercise.name}</h3><p>{attempt.exercise.hazard}</p>
    <p className="mw-notice">{attempt.asset.name} · {Math.max(0, Math.floor((now - attempt.startedAt) / 1000))}s elapsed</p>
    <div className="mw-run-list">{attempt.exercise.required_actions.map(action => <button key={action}
      disabled={attemptSaving || attempt.actions.some(a => a.action === action)} onClick={() => recordAction(action)}>
      {action}{attempt.actions.some(a => a.action === action) && ' ✓'}</button>)}</div>
    <div className="mw-toolbar"><button className="primary" disabled={attemptSaving}
      onClick={async () => {const r = await finishAttempt(); if (r) onComplete(r)}}>Finish & save attempt</button>
      <button disabled={attemptSaving} onClick={() => {if (window.confirm('Discard the recorded actions and restart this attempt?')) restartAttempt()}}>Restart attempt</button>
      <button disabled={attemptSaving} onClick={() => {if (window.confirm('Discard this unsaved exercise attempt?')) discardAttempt()}}>Discard attempt</button></div>
    <p className="mw-muted">Actions are recorded for review; these controls do not operate imported equipment.</p>
  </section>
}
