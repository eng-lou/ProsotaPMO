import { useState } from 'react'

export type PanelSide = 'left' | 'right'

export interface DockedPanel {
  id: string
  label: string
  onToggleDock: () => void
  onClose: () => void
  content: React.ReactNode
}

interface Props {
  side: PanelSide
  panels: DockedPanel[]
}

// A shared side-dock slot (2026-07-09, per Maro: "make section contextual
// like profiles, i can fit in the profile panel or dock on each side.
// effectively sharing a side dock if i want") — Animation Profiles and
// Section Box are each independently dockable (own open/close toggle in
// the toolbar, own left/right preference), but when two of them land on
// the *same* side they'd otherwise stack up as two separate w-72 columns
// eating a lot of width. This renders whichever panels are currently open
// AND docked to `side` as one shared w-72 slot — a single header (no tab
// bar) when there's only one, a small tab strip when there's more than
// one, so "sharing a dock" only costs anything visually once it's actually
// happening.
//
// The dock-toggle (▸/◂) and close (✕) buttons act on whichever tab is
// currently active, not on the dock as a whole — moving one shared
// panel to the other side splits it back out into its own single-panel
// dock, exactly as if it had never been sharing. FourD.tsx builds
// `panels` fresh every render (a plain array, not persisted state), so
// this component's own `activeId` is the only piece of local state here —
// falls back to the first panel whenever the currently-active one isn't
// in the list any more (e.g. it just closed), rather than tracking that
// as an effect.
export function SideDock({ side, panels }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null)
  if (panels.length === 0) return null

  const active = panels.find(p => p.id === activeId) ?? panels[0]

  return (
    <div className={`w-72 shrink-0 bg-white dark:bg-prosota-panel flex flex-col overflow-hidden ${side === 'left' ? 'border-r' : 'border-l'} border-gray-200 dark:border-prosota-line`}>
      {panels.length > 1 ? (
        <div className="flex items-center border-b border-gray-200 dark:border-prosota-line shrink-0">
          {panels.map(p => (
            <button
              key={p.id}
              onClick={() => setActiveId(p.id)}
              className={`flex-1 text-xs font-bold px-3 py-2 border-b-2 ${
                p.id === active.id ? 'border-gray-900 text-gray-900 dark:text-prosota-paper' : 'border-transparent text-gray-400 dark:text-prosota-muted hover:text-gray-600 dark:hover:text-prosota-paper'
              }`}
            >
              {p.label}
            </button>
          ))}
          <button onClick={active.onToggleDock} title={side === 'left' ? 'Move to right' : 'Move to left'} className="px-1.5 text-gray-400 dark:text-prosota-muted hover:text-gray-600 dark:hover:text-prosota-paper shrink-0">
            {side === 'left' ? '▸' : '◂'}
          </button>
          <button onClick={active.onClose} title="Hide" className="px-1.5 text-gray-400 dark:text-prosota-muted hover:text-gray-600 dark:hover:text-prosota-paper shrink-0">✕</button>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-prosota-line shrink-0">
          <span className="text-sm font-bold text-gray-700 dark:text-prosota-muted">{active.label}</span>
          <button onClick={active.onToggleDock} title={side === 'left' ? 'Move to right' : 'Move to left'} className="ml-auto text-gray-400 dark:text-prosota-muted hover:text-gray-600 dark:hover:text-prosota-paper">
            {side === 'left' ? '▸' : '◂'}
          </button>
          <button onClick={active.onClose} title="Hide" className="text-gray-400 dark:text-prosota-muted hover:text-gray-600 dark:hover:text-prosota-paper">✕</button>
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        {active.content}
      </div>
    </div>
  )
}
