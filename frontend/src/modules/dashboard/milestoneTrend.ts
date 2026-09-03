import { api } from '@/lib/api'

// Milestone Trend Analysis (2026-09-03, per Maro: "i need charts across
// baseline periods e.g milestones over time a trend analysis... whether
// milestones have improved or delayed over time") — a genuinely different
// data source from every other dashboard widget's shared DashboardOverviewResponse
// (same "gets its own fetch" precedent Camera Views/4D Video already
// established): this needs every saved ScheduleBaseline's own captured
// milestone dates, not a single current-schedule snapshot. See
// backend/app/services/schedule_baseline.py:get_milestone_trend.
export interface MilestoneTrendPoint {
  baseline_id: string | null
  baseline_name: string
  baseline_date: string
  finish: string | null
}

export interface MilestoneTrendSeries {
  activity_id: string
  code: string
  task_name: string
  points: MilestoneTrendPoint[]
}

export async function getMilestoneTrend(schedulePeriodId: string): Promise<MilestoneTrendSeries[]> {
  const { data } = await api.get<{ series: MilestoneTrendSeries[] }>('/api/v1/schedule-baselines/milestone-trend', {
    params: { schedule_period_id: schedulePeriodId },
  })
  return data.series
}
