import { useEffect, useState } from 'react'

// Drop-in replacement for `window.confirm(message)` that remembers "don't
// show this again" per a stable `key`, until reset from the sidebar's "Reset
// dismissed warnings" link (2026-07-04, per Maro: repeatedly re-confirming
// the same routine action — e.g. duplicating an activity — gets old fast).
// Every call site owns its own key so dismissing one warning never silently
// suppresses an unrelated one.

const STORAGE_KEY = 'prosota:dismissedWarnings'

function readDismissed(): Record<string, true> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function writeDismissed(map: Record<string, true>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
}

const countListeners = new Set<() => void>()
function notifyCountListeners(): void {
  countListeners.forEach(fn => fn())
}

export function countDismissedWarnings(): number {
  return Object.keys(readDismissed()).length
}

export function resetAllDismissedWarnings(): void {
  localStorage.removeItem(STORAGE_KEY)
  notifyCountListeners()
}

export function useDismissedWarningsCount(): number {
  const [count, setCount] = useState(countDismissedWarnings)
  useEffect(() => {
    const update = () => setCount(countDismissedWarnings())
    countListeners.add(update)
    return () => { countListeners.delete(update) }
  }, [])
  return count
}

interface PendingConfirm {
  id: number
  key: string
  message: string
  resolve: (ok: boolean) => void
}

let nextId = 1
let pending: PendingConfirm | null = null
const stateListeners = new Set<(p: PendingConfirm | null) => void>()
function notifyState(): void {
  stateListeners.forEach(fn => fn(pending))
}

/** Call sites: `if (!(await confirmWithDontAsk('scheduling.bulk-duplicate', message))) return` */
export function confirmWithDontAsk(key: string, message: string): Promise<boolean> {
  if (readDismissed()[key]) return Promise.resolve(true)
  return new Promise(resolve => {
    pending = { id: nextId++, key, message, resolve }
    notifyState()
  })
}

function usePendingConfirm(): PendingConfirm | null {
  const [state, setState] = useState<PendingConfirm | null>(pending)
  useEffect(() => {
    stateListeners.add(setState)
    return () => { stateListeners.delete(setState) }
  }, [])
  return state
}

function respond(dontAskAgain: boolean, ok: boolean): void {
  if (!pending) return
  const { key, resolve } = pending
  if (ok && dontAskAgain) {
    const map = readDismissed()
    map[key] = true
    writeDismissed(map)
    notifyCountListeners()
  }
  pending = null
  notifyState()
  resolve(ok)
}

/** Mount once near the app root — renders the modal for any pending confirmWithDontAsk() call. */
export function ConfirmHost() {
  const state = usePendingConfirm()
  const [dontAsk, setDontAsk] = useState(false)

  useEffect(() => { setDontAsk(false) }, [state?.id])

  if (!state) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 no-print">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-5">
        <p className="text-sm text-gray-800 whitespace-pre-line mb-4">{state.message}</p>
        <label className="flex items-center gap-2 text-xs text-gray-500 mb-4 select-none">
          <input type="checkbox" checked={dontAsk} onChange={e => setDontAsk(e.target.checked)} />
          Don't show this warning again
        </label>
        <div className="flex justify-end gap-2">
          <button
            onClick={() => respond(dontAsk, false)}
            className="text-sm px-4 py-1.5 rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={() => respond(dontAsk, true)}
            className="text-sm px-4 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700"
            autoFocus
          >
            OK
          </button>
        </div>
      </div>
    </div>
  )
}
