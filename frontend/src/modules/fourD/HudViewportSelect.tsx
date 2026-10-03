// "Show in" picker for a HUD widget (Radial Chart / Timeline Strip) —
// 2026-10-03, per Maro: "allow me add radial charts/timeline strips per
// baseline views". null = the main 4D viewport; 0..2 = that comparison
// view's slot (the same index FourD.tsx's paneConfigs and the export
// layout's comparisonViewRects use). A view that isn't open right now is
// still selectable — the widget simply shows up once that view is opened.
export function HudViewportSelect({ value, openViewCount, onChange }: {
  value: number | null
  openViewCount: number
  onChange: (slot: number | null) => void
}) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-prosota-muted">
      <span className="w-16 shrink-0">Show in</span>
      <select
        value={value === null ? 'main' : String(value)}
        onChange={e => onChange(e.target.value === 'main' ? null : Number(e.target.value))}
        className="flex-1 border border-gray-200 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5"
      >
        <option value="main">Main view</option>
        {[0, 1, 2].map(slot => (
          <option key={slot} value={slot}>View {slot + 1}{slot >= openViewCount ? ' (not open)' : ''}</option>
        ))}
      </select>
    </label>
  )
}
