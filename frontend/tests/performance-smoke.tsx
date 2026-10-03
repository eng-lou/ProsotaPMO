// Open /tests/performance-smoke.html on the Vite development server.
// Synthetic records only; no backend, authentication or production writes.
import React, { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { ActivityPicker } from '../src/modules/scheduling/ActivityPicker'
import { ScheduleWindow } from '../src/modules/fourD/ScheduleWindow'
import type { Activity } from '../src/modules/scheduling/types'
import { GANTT_ROW_HEIGHT } from '../src/modules/scheduling/GanttChart'
import '../src/index.css'

const activities = Array.from({ length: 5000 }, (_, i) => ({
  id: `activity-${i}`, code: `A-${String(i).padStart(4, '0')}`, task_name: `Construction activity ${i}`,
  activity_type: 'task', parent_id: null, start: null, finish: null, duration_days: 5,
  animation_profile_id: null,
})) as Activity[]
const noop = () => {}
const root = createRoot(document.getElementById('root')!)
const results: Record<string, unknown> = {}
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
const settle = async () => { await frame(); await frame(); await frame() }
const check = (name: string, pass: boolean) => { results[name] = pass; if (!pass) throw new Error(name) }
let selectedCount = 0
function Picker() {
  const [value, setValue] = useState('')
  return <div style={{width: 480}}><ActivityPicker activities={activities} value={value} onChange={setValue} showDates scrollToId="activity-4900" /></div>
}
function Schedule({ count = 5000 }: { count?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState(new Set<string>())
  selectedCount = selected.size
  return <div style={{height: 500}}><ScheduleWindow activities={activities} visibleActivities={activities.slice(0, count)}
    collapsedIds={new Set()} onToggleCollapsed={noop} selectedActivityIds={selected}
    onSelectActivity={(id, add) => setSelected(prev => new Set(add ? [...prev, id] : [id]))}
    onSelectActivities={setSelected} onApplyProfile={async () => {}}
    scrollContainerRef={ref} onScroll={noop} animationProfiles={[]} modelElementLinks={[]} onUpdateActivity={async () => {}} /></div>
}
try {
  flushSync(() => root.render(<Picker />))
  let start = performance.now()
  flushSync(() => (document.querySelector('input') as HTMLInputElement).focus())
  await frame()
  results.pickerOpenMs = Math.round(performance.now() - start)
  results.pickerRenderedOptions = document.querySelectorAll('#root button').length
  results.pickerAnchorPresent = document.querySelector('#root')!.textContent!.includes('Construction activity 4900')
  check('pickerWindowBounded', Number(results.pickerRenderedOptions) < 50)
  flushSync(() => document.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
  flushSync(() => document.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  check('pickerKeyboardSelectsAnchorNeighbour', (document.querySelector('input') as HTMLInputElement).value.includes('4901'))
  start = performance.now()
  flushSync(() => root.render(<Schedule />))
  await frame()
  results.scheduleMountMs = Math.round(performance.now() - start)
  results.scheduleRenderedActivities = [...document.querySelectorAll('tbody tr')].filter(row => row.textContent!.includes('Construction activity')).length
  results.scheduleDomNodes = document.querySelectorAll('#root *').length
  check('scheduleWindowBounded', Number(results.scheduleRenderedActivities) < 50)
  const container = document.querySelector('table')!.parentElement!
  flushSync(() => (document.querySelector('tr[aria-rowindex="2"]') as HTMLElement).click())
  container.scrollTop = 4000 * GANTT_ROW_HEIGHT
  container.dispatchEvent(new Event('scroll'))
  await settle()
  const distantRow = document.querySelector('tr[aria-rowindex="4002"]')!
  check('deepScrollRendersTarget', !!distantRow)
  check('rowHeightMatchesGantt', Math.abs(distantRow.getBoundingClientRect().height - GANTT_ROW_HEIGHT) < 1)
  flushSync(() => distantRow.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })))
  check('shiftSelectIncludesUnmountedRows', selectedCount === 4001)
  flushSync(() => distantRow.children[1].dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
  const editor = distantRow.querySelector('input')!
  check('inlineEditorOpened', !!editor)
  container.scrollTop = 0
  container.dispatchEvent(new Event('scroll'))
  await settle()
  check('offscreenEditorPreserved', document.contains(editor))
  flushSync(() => editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  container.scrollTop = 4000 * GANTT_ROW_HEIGHT
  container.dispatchEvent(new Event('scroll'))
  await settle()
  flushSync(() => root.render(<Schedule count={3} />))
  await settle()
  check('filterWhileScrolledShowsRemainingRows', document.querySelectorAll('tr[aria-rowindex]').length === 3)
  check('filterClampsScroll', container.scrollTop === 0)
  document.getElementById('results')!.textContent = JSON.stringify(results, null, 2)
} catch (error) { document.getElementById('results')!.textContent = `FAIL: ${error}` }
