import { useEffect, useRef, useState } from 'react'

interface Props {
  containerRef: React.RefObject<HTMLDivElement>
  cameraName: string
  // Reuses the project's own Capture/Export Video output resolution
  // (renderCaptureSettings.ts) as the passepartout's frame aspect ratio —
  // confirmed with Maro: one source of truth for "what will actually
  // render," rather than a separate per-camera aspect field.
  resolutionWidth: number
  resolutionHeight: number
  onExit: () => void
  // Keyframing (2026-08-03) — needs the live camera/controls ref, which
  // only Viewport3D.tsx itself holds (same reasoning "+ Camera"/"Save
  // View" live in its own toolbar, one level up) — this overlay only
  // renders the button, Viewport3D.tsx's own handleKeyCameraPose does the
  // actual capture.
  onKeyframe: () => void
}

// Blender-style camera-view passepartout (2026-08-03, per Maro's own
// reference screenshot) — a dimmed border showing exactly what falls
// outside the active camera's output frame, drawn as a plain HTML overlay
// (not inside the R3F <Canvas>) on top of the viewport whenever a Camera
// is being looked through. Sized in JS off the container's own live
// client box rather than a pure-CSS aspect-ratio trick — `aspect-ratio`
// only ever constrains ONE dimension at a time (ignored once both width
// and height are already definite), which can't express "contain-fit a
// fixed-aspect box inside an arbitrarily-sized flex parent" on its own;
// measuring is simpler to reason about than fighting that edge case.
export function PassepartoutOverlay({ containerRef, cameraName, resolutionWidth, resolutionHeight, onExit, onKeyframe }: Props) {
  const [box, setBox] = useState<{ width: number; height: number } | null>(null)
  const frameRef = useRef<{ w: number; h: number }>({ w: resolutionWidth, h: resolutionHeight })
  frameRef.current = { w: resolutionWidth, h: resolutionHeight }

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const compute = () => {
      const { w, h } = frameRef.current
      const containerW = el.clientWidth
      const containerH = el.clientHeight
      if (containerW === 0 || containerH === 0 || w <= 0 || h <= 0) return
      const containerAspect = containerW / containerH
      const frameAspect = w / h
      const box = frameAspect > containerAspect
        ? { width: containerW, height: containerW / frameAspect }
        : { width: containerH * frameAspect, height: containerH }
      setBox(box)
    }
    compute()
    const observer = new ResizeObserver(compute)
    observer.observe(el)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, resolutionWidth, resolutionHeight])

  if (!box) return null

  return (
    <div className="absolute inset-0 z-20 pointer-events-none flex items-center justify-center">
      <div
        className="border border-amber-400/80"
        style={{ width: box.width, height: box.height, boxShadow: '0 0 0 9999px rgba(0,0,0,0.6)' }}
      />
      {/* top-12, not top-2 — the existing Select All/Frame Selected/Capture
          toolbars are also "absolute top-2" overlays on the left/right of
          this same container; on a narrow viewport (a side panel docked)
          they wrap close enough to the horizontal center that a top-2
          label here visually collided with them. */}
      <div className="absolute top-12 left-1/2 -translate-x-1/2 flex items-center gap-2 pointer-events-auto">
        <span className="text-xs font-medium text-white bg-black/70 rounded px-2 py-1">📹 {cameraName}</span>
        <button
          onClick={onKeyframe}
          title="Add Keyframe — captures this camera's current position, aim, and lens at the timeline's current date"
          className="text-xs font-medium text-white bg-black/70 hover:bg-black/90 rounded px-2 py-1"
        >
          🔑 Add Keyframe
        </button>
        <button
          onClick={onExit}
          title="Exit Camera View — back to free orbit"
          className="text-xs font-medium text-white bg-black/70 hover:bg-black/90 rounded px-2 py-1"
        >
          Exit Camera View ✕
        </button>
      </div>
    </div>
  )
}
