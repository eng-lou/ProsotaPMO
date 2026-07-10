import type { Activity } from '@/modules/scheduling/types'

interface Props {
  activities: Activity[]
  selectedActivityIds: Set<string>
  onSelectActivity: (id: string, additive: boolean) => void
}

// "Linked Activities" widget (2026-07-09, per Maro: "there should be a
// widget to filter the activities the isolated elements are assigned to,
// if not assigned to any then nothing happens") — shown in the viewport
// while Isolate is active, listing whichever activities the *currently
// isolated* elements are linked to (resolved in FourD.tsx via
// linkedElements.ts's resolveIsolationTargetsToActivityIds). Renders
// nothing at all when that list is empty, per "if not assigned to any then
// nothing happens" — not an empty-state message, since an isolated plain
// prop/decoration with no schedule tie is a completely normal, expected
// case, not an error to call out.
//
// Clicking a row selects it the same way a row click in the Activity Table
// itself does (selectedActivityIds, handleSelectActivity) — so this is a
// real reciprocal of "Isolate Linked" (activities -> elements): this widget
// is elements -> activities, and clicking through here highlights the
// activity back in the Activity Table/Gantt windows too.
export function LinkedActivitiesWidget({ activities, selectedActivityIds, onSelectActivity }: Props) {
  if (activities.length === 0) return null
  return (
    <div className="w-56 max-h-40 overflow-y-auto rounded-md border border-gray-300 bg-white/95 shadow-sm text-xs">
      <div className="px-2 py-1 border-b border-gray-100 font-bold text-gray-500 sticky top-0 bg-white/95">
        Linked Activities ({activities.length})
      </div>
      {activities.map(a => (
        <div
          key={a.id}
          onClick={e => onSelectActivity(a.id, e.ctrlKey || e.metaKey)}
          className={`px-2 py-1 cursor-pointer hover:bg-gray-50 truncate ${selectedActivityIds.has(a.id) ? 'bg-blue-50 text-blue-700' : 'text-gray-600'}`}
          title={`${a.code}: ${a.task_name}`}
        >
          <span className="font-mono text-gray-400 mr-1">{a.code}</span>
          {a.task_name}
        </div>
      ))}
    </div>
  )
}
