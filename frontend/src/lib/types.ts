export interface Period {
  id: string
  project_id: string
  period_label: string
  freeze_status: string
  // The CPM anchor / "data date" — activities with no predecessors can't start
  // earlier than this. Reschedule (Scheduling module) shifts it directly.
  start_date: string | null
  // The data date's time-of-day ("HH:MM:SS") — null means "the default
  // calendar's day start". Only ever set via Reschedule's "set data date
  // directly" mode.
  start_time: string | null
}

export type RecordType = 'activity' | 'risk' | 'cost_element' | 'issue' | 'change' | 'decision'

export interface RecordLink {
  id: string
  source_type: string
  source_id: string
  target_type: string
  target_id: string
  link_type: string
  note: string | null
  created_at: string
}

export const LINK_TYPES = ['causes', 'impacts', 'mitigates', 'relates_to'] as const
