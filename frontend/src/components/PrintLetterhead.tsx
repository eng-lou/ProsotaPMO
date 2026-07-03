import type { CSSProperties } from 'react'
import { DEFAULT_GANTT_STYLE, type GanttStyle } from '@/lib/ganttLayout'
import type { LetterheadTokens, LetterheadZone, ProjectLetterhead } from '@/lib/letterhead'
import { applyLetterheadTokens } from '@/lib/letterhead'
import { GanttLegend } from './GanttLegend'

function zoneStyle(zone: LetterheadZone): CSSProperties {
  return {
    fontWeight: zone.bold ? 700 : 400,
    fontStyle: zone.italic ? 'italic' : 'normal',
    fontSize: zone.font_size,
    textAlign: zone.align,
    whiteSpace: 'pre-line',
  }
}

function Zone({ zone, tokens }: { zone: LetterheadZone; tokens: LetterheadTokens }) {
  const text = applyLetterheadTokens(zone.text, tokens)
  if (!text) return <div />
  return <div style={zoneStyle(zone)}>{text}</div>
}

// The shared, editable print header/footer used by every module's print view
// (see frontend/src/lib/letterhead.ts) — replaces each print view's own
// hardcoded "{project} — {module}" + "Printed {date}" block so a logo or
// custom header/footer set once (LetterheadEditorWidget) shows up consistently
// everywhere, per Maro (2026-07-03).
export function PrintLetterheadHeader({ letterhead, tokens }: { letterhead: ProjectLetterhead; tokens: LetterheadTokens }) {
  const logo = letterhead.logo_data_url && (
    <img src={letterhead.logo_data_url} alt="" style={{ maxHeight: 40, maxWidth: 160, objectFit: 'contain' }} />
  )

  return (
    <div className="mb-4 border-b border-gray-300 pb-3">
      <div className="grid grid-cols-3 gap-3 items-center">
        <div className="text-left">
          {letterhead.logo_position === 'left' && logo}
          <Zone zone={letterhead.header_left} tokens={tokens} />
        </div>
        <div className="text-center">
          {letterhead.logo_position === 'center' && <div className="flex justify-center">{logo}</div>}
          <Zone zone={letterhead.header_center} tokens={tokens} />
        </div>
        <div className="text-right">
          {letterhead.logo_position === 'right' && <div className="flex justify-end">{logo}</div>}
          <Zone zone={letterhead.header_right} tokens={tokens} />
        </div>
      </div>
    </div>
  )
}

// Fixed to the bottom of every printed page (position:fixed repeats per page
// in print in Chrome/Edge, the browsers this app targets) — only rendered at
// all if there's something to show (a footer zone has text, or the Gantt
// legend is on), so projects that haven't set one up don't get an empty bar
// reserving space at the bottom of each page.
// `ganttLegend` shows the "how to read the Gantt" key (see GanttLegend.tsx) —
// only Scheduling's print view passes this true, since Risk/ICD/Cost don't
// have a Gantt chart to explain even if the project's letterhead has the
// preset switched on.
// `preview` drops the print-only/fixed positioning so LetterheadEditorWidget
// can show the same markup inline, on-screen, while editing.
export function PrintLetterheadFooter({
  letterhead, tokens, ganttLegend = false, ganttStyle = DEFAULT_GANTT_STYLE, preview = false,
}: {
  letterhead: ProjectLetterhead; tokens: LetterheadTokens; ganttLegend?: boolean; ganttStyle?: GanttStyle; preview?: boolean
}) {
  const showLegend = ganttLegend && letterhead.show_gantt_legend
  const hasContent = [letterhead.footer_left, letterhead.footer_center, letterhead.footer_right].some(z => z.text.trim() !== '')
  if (!hasContent && !showLegend && !preview) return null

  const body = (
    <div className="border-t border-gray-300 px-8 pt-2 pb-3">
      {showLegend && <div className="mb-1.5"><GanttLegend style={ganttStyle} /></div>}
      <div className="grid grid-cols-3 gap-3 items-center">
        <div className="text-left"><Zone zone={letterhead.footer_left} tokens={tokens} /></div>
        <div className="text-center"><Zone zone={letterhead.footer_center} tokens={tokens} /></div>
        <div className="text-right"><Zone zone={letterhead.footer_right} tokens={tokens} /></div>
      </div>
    </div>
  )

  if (preview) return body
  return <div className="print-only" style={{ position: 'fixed', bottom: 0, left: 0, right: 0 }}>{body}</div>
}
