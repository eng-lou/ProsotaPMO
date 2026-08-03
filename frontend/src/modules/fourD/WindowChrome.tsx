export type DockSide = 'top' | 'bottom'

interface Props {
  title: string
  subtitle?: string
  // Extra header controls specific to one window (2026-07-09, per Maro's
  // "sometimes it doesn't pull exactly the activities from the schedule" —
  // added first for a manual Refresh button on the Schedule/Gantt windows)
  // — rendered between the subtitle and the shared dock-toggle/close
  // buttons every window already gets.
  headerActions?: React.ReactNode
  dock: DockSide
  onToggleDock: () => void
  onClose: () => void
  children: React.ReactNode
}

// Shared header (title, dock-toggle, close) for every 4D window — Schedule/
// Resource Tracking/Resource Usage/Gantt Chart/Animation Timeline
// (2026-07-11, per Maro: dock windows above *or* below the viewport, not
// just above). One chrome component rather than five bespoke headers, same
// content-only-panel-plus-shared-wrapper split as DataPanel.tsx's IFC/3D
// tabs. The dock-toggle just flips FourD.tsx's windowDock[key] between
// 'top'/'bottom' — actual placement (which SplitRow this window ends up in)
// is entirely FourD.tsx's concern, this component doesn't know or care
// which dock it's currently in beyond which icon to show.
export function WindowChrome({ title, subtitle, headerActions, dock, onToggleDock, onClose, children }: Props) {
  return (
    <div className="bg-white dark:bg-prosota-panel border border-gray-200 dark:border-prosota-line rounded-lg flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-200 dark:border-prosota-line bg-gray-50 dark:bg-prosota-panel2 shrink-0">
        <span className="text-xs font-bold text-gray-700 dark:text-prosota-muted">{title}</span>
        {subtitle && <span className="text-xs text-gray-400 dark:text-prosota-muted">{subtitle}</span>}
        {headerActions}
        <button
          onClick={onToggleDock}
          title={dock === 'top' ? 'Move to bottom' : 'Move to top'}
          className="ml-auto text-gray-400 dark:text-prosota-muted hover:text-gray-600 dark:hover:text-prosota-paper"
        >
          {dock === 'top' ? '▾' : '▴'}
        </button>
        <button onClick={onClose} title="Close" className="text-gray-400 dark:text-prosota-muted hover:text-gray-600 dark:hover:text-prosota-paper">✕</button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">{children}</div>
    </div>
  )
}
