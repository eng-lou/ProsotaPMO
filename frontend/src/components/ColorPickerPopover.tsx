import { useEffect, useRef, useState } from 'react'

// Plain HSV <-> hex conversions — no dependency, this is the entire reason
// this component exists: the native <input type="color"> dialog on Windows/
// Chrome was hanging the whole browser tab (2026-07-05, per Maro), and two
// rounds of trying to work around React's side of that didn't fix it, only
// removing the native dialog entirely did. This reimplements the same
// "drag a square + a hue bar" picker Maro liked, but built from ordinary
// divs/CSS gradients/pointer events — nothing here ever invokes an OS-level
// dialog, so there's nothing left for that class of bug to attach to.
function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return [0, 0, 0]
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  const s = max === 0 ? 0 : d / max
  return { h, s, v: max }
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let r = 0, g = 0, b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255]
}

function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const [r, g, b] = hexToRgb(hex)
  return rgbToHsv(r, g, b)
}

function hsvToHex(h: number, s: number, v: number): string {
  const [r, g, b] = hsvToRgb(h, s, v)
  return rgbToHex(r, g, b)
}

// Tracks a pointer drag across an element's own bounding box, clamped to
// 0-1 on each axis, for the lifetime of one press-drag-release gesture.
function trackDrag(el: HTMLElement, onMove: (x: number, y: number) => void) {
  const rect = el.getBoundingClientRect()
  const update = (clientX: number, clientY: number) => {
    const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    const y = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height))
    onMove(x, y)
  }
  const onPointerMove = (e: PointerEvent) => update(e.clientX, e.clientY)
  const onPointerUp = () => {
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
  }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  return update
}

export function ColorPickerPopover({ value, onChange, onClose }: { value: string; onChange: (hex: string) => void; onClose: () => void }) {
  const [hsv, setHsv] = useState(() => hexToHsv(value))
  const squareRef = useRef<HTMLDivElement>(null)
  const hueRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Closes on an outside click — attaching the listener a tick late
  // (setTimeout 0) rather than immediately in this effect. Confirmed by
  // direct render logging (2026-07-05, per Maro) that attaching it
  // immediately let it catch the very same click that opened the popover
  // (the swatch's onClick and this effect both run as part of handling that
  // one native click event, and the event is still bubbling/dispatching at
  // that point) — so it closed on the same click that opened it, every
  // time. Deferring to a new task guarantees the opening click has fully
  // finished dispatching before this listener can see anything.
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) onClose()
    }
    const timer = setTimeout(() => document.addEventListener('click', onDocClick), 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('click', onDocClick)
    }
  }, [onClose])

  const commit = (next: { h: number; s: number; v: number }) => {
    setHsv(next)
    onChange(hsvToHex(next.h, next.s, next.v))
  }

  const handleSquarePointerDown = (e: React.PointerEvent) => {
    const el = squareRef.current
    if (!el) return
    const update = trackDrag(el, (x, y) => commit({ h: hsv.h, s: x, v: 1 - y }))
    update(e.clientX, e.clientY)
  }

  const handleHuePointerDown = (e: React.PointerEvent) => {
    const el = hueRef.current
    if (!el) return
    const update = trackDrag(el, x => commit({ h: x * 360, s: hsv.s, v: hsv.v }))
    update(e.clientX, e.clientY)
  }

  const pureHue = hsvToHex(hsv.h, 1, 1)

  return (
    <div
      ref={popoverRef}
      className="absolute z-50 top-full left-0 mt-1 bg-white dark:bg-prosota-panel border border-gray-200 dark:border-prosota-line rounded-lg shadow-lg p-3 w-48"
    >
      <div
        ref={squareRef}
        onPointerDown={handleSquarePointerDown}
        className="relative w-full h-32 rounded cursor-crosshair touch-none select-none"
        style={{
          backgroundColor: pureHue,
          backgroundImage: 'linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, rgba(255,255,255,0))',
        }}
      >
        <div
          className="absolute w-3 h-3 rounded-full border-2 border-white shadow pointer-events-none"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, marginLeft: -6, marginTop: -6, backgroundColor: value }}
        />
      </div>
      <div
        ref={hueRef}
        onPointerDown={handleHuePointerDown}
        className="relative w-full h-3 rounded mt-2 cursor-pointer touch-none select-none"
        style={{ background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' }}
      >
        <div
          className="absolute top-0 w-1.5 h-3 rounded-sm border border-white shadow pointer-events-none bg-white/40"
          style={{ left: `${(hsv.h / 360) * 100}%`, marginLeft: -3 }}
        />
      </div>
    </div>
  )
}
