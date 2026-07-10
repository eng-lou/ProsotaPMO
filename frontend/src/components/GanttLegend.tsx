import type { ReactNode } from 'react'
import { DEFAULT_GANTT_STYLE, FONT_FAMILY_CSS, wbsLevelColor, withAlpha, type GanttFontFamily, type GanttStyle } from '@/lib/ganttLayout'

// Explains the Gantt chart's symbols (colour, shape) on the printed page —
// swatches mirror GanttChart.tsx's actual rendering (including whichever
// custom `style` a project has applied via the Layout widget) so what's
// printed matches what's on screen. Only meaningful where a Gantt actually
// appears (Scheduling's print view) — see PrintLetterheadFooter's
// ganttLegend prop.
function buildItems(style: GanttStyle): { swatch: ReactNode; label: string }[] {
  return [
    ...(style.show_sub_critical ? [{
      swatch: (
        <div
          className="w-6 h-3 rounded-sm border-2 overflow-hidden"
          style={{ borderColor: style.non_critical_color, backgroundColor: withAlpha(style.non_critical_color, 0.25), boxShadow: `0 0 0 2px ${style.sub_critical_color}` }}
        />
      ),
      label: 'Critical within its own sub-project',
    }] : []),
    {
      swatch: (
        <div className="w-6 h-3 rounded-sm border-2 overflow-hidden" style={{ borderColor: style.critical_color, backgroundColor: withAlpha(style.critical_color, 0.25) }}>
          <div className="h-full w-1/2" style={{ backgroundColor: style.critical_color }} />
        </div>
      ),
      label: 'Critical activity (fill = % complete)',
    },
    {
      swatch: (
        <div className="w-6 h-3 rounded-sm border-2 overflow-hidden" style={{ borderColor: style.non_critical_color, backgroundColor: withAlpha(style.non_critical_color, 0.25) }}>
          <div className="h-full w-1/2" style={{ backgroundColor: style.non_critical_color }} />
        </div>
      ),
      label: 'Non-critical activity',
    },
    {
      swatch: (
        <span className="inline-flex items-center gap-0.5">
          <span className="w-2.5 h-2.5 rotate-45 border inline-block" style={{ backgroundColor: style.milestone_critical_color, borderColor: withAlpha(style.milestone_critical_color, 0.7) }} />
          <span className="w-2.5 h-2.5 rotate-45 border inline-block" style={{ backgroundColor: style.milestone_noncritical_color, borderColor: withAlpha(style.milestone_noncritical_color, 0.7) }} />
        </span>
      ),
      label: 'Milestone (critical / non-critical)',
    },
    {
      swatch: (
        <svg width="24" height="10" viewBox="0 0 24 10">
          <path d="M0,5 H16 L20,5" fill="none" stroke="#94a3b8" strokeWidth={1.5} />
          <path d="M20,2 L24,5 L20,8 Z" fill="#94a3b8" />
        </svg>
      ),
      label: 'Dependency link (red = critical path)',
    },
    {
      swatch: (
        <span className="inline-flex items-center gap-1">
          {[0, 1, 2].map(level => (
            <svg key={level} width="14" height="10" viewBox="0 0 14 10">
              <path d="M0,3 L0,8 L4,3 M4,3 L10,3 L14,8 L14,3 M10,3" fill="none" stroke={wbsLevelColor(style, level)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            </svg>
          ))}
        </span>
      ),
      label: 'WBS summary (shade = nesting level)',
    },
    {
      swatch: <div className="rounded-sm border" style={{ width: 24, height: Math.max(style.baseline_thickness, 4), backgroundColor: withAlpha(style.baseline_color, 0.55), borderColor: style.baseline_color }} />,
      label: 'Baseline',
    },
    {
      swatch: <div className="w-2.5 h-2.5 rotate-45 border-2 bg-white inline-block" style={{ borderColor: style.baseline_color }} />,
      label: 'Baseline milestone',
    },
  ]
}

// fontSize defaults to the pre-existing hardcoded 9px (`text-[9px]`) so a
// project that's never customized it renders unchanged — 2026-07-07, per
// Maro: "that gantt legend (add a size for this one too)" — see
// ProjectLetterhead.gantt_legend_font_size (the only print-only font size
// this component had no control for until now).
export function GanttLegend({ style = DEFAULT_GANTT_STYLE, fontSize = 9, fontFamily = 'sans' }: { style?: GanttStyle; fontSize?: number; fontFamily?: GanttFontFamily }) {
  const items = buildItems(style)
  return (
    <div className="flex items-center gap-4 flex-wrap text-gray-500" style={{ fontSize, fontFamily: FONT_FAMILY_CSS[fontFamily] }}>
      <span className="font-semibold text-gray-600 uppercase tracking-wide" style={{ fontSize }}>Legend</span>
      {items.map(item => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          {item.swatch}
          {item.label}
        </span>
      ))}
    </div>
  )
}
