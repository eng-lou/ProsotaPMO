interface Props {
  onDrag: (deltaY: number) => void
}

// Drag handle between a window dock and the 3D viewport (2026-07-11, per
// Maro: "the dividers separating the windows and the main the 3d
// viewport"). Reports raw mouse deltaY per move rather than an absolute
// position — FourD.tsx owns which direction that delta should grow
// (dragging the top divider down grows the top dock; dragging the bottom
// divider up grows the bottom dock), this component doesn't need to know
// which side it's on.
export function DockDivider({ onDrag }: Props) {
  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault()
    let lastY = e.clientY

    const onMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientY - lastY
      lastY = moveEvent.clientY
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
      className="h-1.5 shrink-0 cursor-row-resize bg-gray-100 hover:bg-gray-300 active:bg-gray-400 transition-colors rounded my-1"
    />
  )
}
