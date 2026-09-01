interface Props {
  onDrag: (delta: number) => void
  // 'y' (default) — original vertical divider between a window dock and
  // the 3D viewport, reports deltaY. 'x' (2026-09-01, per Maro: "allow me
  // increase the width of this contextual side panel") — a vertical BAR
  // for resizing a *side* dock's width, reports deltaX instead.
  axis?: 'x' | 'y'
}

// Drag handle between a window dock and the 3D viewport (2026-07-11, per
// Maro: "the dividers separating the windows and the main the 3d
// viewport"). Reports a raw mouse delta per move rather than an absolute
// position — FourD.tsx owns which direction that delta should grow
// (dragging the top divider down grows the top dock; dragging the bottom
// divider up grows the bottom dock; dragging the left side-dock's own
// right edge right grows it, the mirror for the right dock's left edge),
// this component doesn't need to know which side it's on.
export function DockDivider({ onDrag, axis = 'y' }: Props) {
  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault()
    let last = axis === 'x' ? e.clientX : e.clientY

    const onMove = (moveEvent: MouseEvent) => {
      const pos = axis === 'x' ? moveEvent.clientX : moveEvent.clientY
      const delta = pos - last
      last = pos
      onDrag(delta)
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return (
    <div
      onMouseDown={startDrag}
      title="Drag to resize"
      className={
        axis === 'x'
          ? 'w-1.5 shrink-0 cursor-col-resize bg-gray-100 dark:bg-prosota-panel2 hover:bg-gray-300 dark:hover:bg-prosota-line active:bg-gray-400 dark:active:bg-prosota-azure/40 transition-colors rounded mx-1'
          : 'h-1.5 shrink-0 cursor-row-resize bg-gray-100 dark:bg-prosota-panel2 hover:bg-gray-300 dark:hover:bg-prosota-line active:bg-gray-400 dark:active:bg-prosota-azure/40 transition-colors rounded my-1'
      }
    />
  )
}
