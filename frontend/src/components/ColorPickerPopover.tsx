import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

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

// Accepts "#rgb", "rgb", "#rrggbb" or "rrggbb"; returns normalized
// lowercase "#rrggbb", or null if it isn't a valid hex colour.
export function normalizeHex(input: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim())
  if (!m) return null
  const h = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1]
  return `#${h.toLowerCase()}`
}

// `anchor` (2026-10-02, per Maro: the picker was clipped inside the narrow
// Animation Profiles panel — "expand to fit so can use the color picker
// well"): when given, the popover renders into document.body at fixed
// coordinates next to that element, flipping above it if there isn't room
// below and clamped inside the window, so no scrolling/overflow container
// can cut it off. Without it, the original in-place absolute positioning is
// unchanged for existing callers. `recentColors` adds a clickable swatch
// row; a hex box is always shown.
export function ColorPickerPopover({ value, onChange, onClose, anchor, recentColors }: {
  value: string
  onChange: (hex: string) => void
  onClose: () => void
  anchor?: HTMLElement | null
  recentColors?: string[]
}) {
  const [hsv, setHsv] = useState(() => hexToHsv(value))
  const [hexDraft, setHexDraft] = useState(value)
  const [fixedPos, setFixedPos] = useState<{ top: number; left: number } | null>(null)
  // Keep the square/hue in sync when the value changes from outside (typing
  // a hex code, clicking a recent swatch).
  useEffect(() => {
    if (hsvToHex(hsv.h, hsv.s, hsv.v) !== value.toLowerCase()) setHsv(hexToHsv(value))
    setHexDraft(value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
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

  useLayoutEffect(() => {
    if (!anchor) return
    const place = () => {
      const a = anchor.getBoundingClientRect()
      const el = popoverRef.current
      const w = el?.offsetWidth ?? 208
      const h = el?.offsetHeight ?? 260
      const margin = 8
      let top = a.bottom + 4
      if (top + h > window.innerHeight - margin) top = Math.max(margin, a.top - h - 4)
      const left = Math.min(Math.max(margin, a.right - w), window.innerWidth - w - margin)
      setFixedPos({ top, left })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [anchor])

  const commitHexDraft = () => {
    const hex = normalizeHex(hexDraft)
    if (hex) onChange(hex)
    else setHexDraft(value)
  }

  const pureHue = hsvToHex(hsv.h, 1, 1)

  const popover = (
    <div
      ref={popoverRef}
      className={`${anchor ? 'fixed z-[1000]' : 'absolute z-50 top-full left-0 mt-1'} bg-white dark:bg-prosota-panel border border-gray-200 dark:border-prosota-line rounded-lg shadow-lg p-3 w-52`}
      style={anchor ? { top: fixedPos?.top ?? -9999, left: fixedPos?.left ?? -9999 } : undefined}
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
      <div className="flex items-center gap-1.5 mt-2">
        <span className="w-5 h-5 rounded border border-gray-300 dark:border-prosota-line shrink-0" style={{ backgroundColor: value }} />
        <input
          value={hexDraft}
          onChange={e => setHexDraft(e.target.value)}
          onBlur={commitHexDraft}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitHexDraft() } }}
          spellCheck={false}
          aria-label="Hex colour"
          className="flex-1 min-w-0 text-xs font-mono border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5"
        />
      </div>
      {recentColors && recentColors.length > 0 && (
        <div className="mt-2">
          <div className="text-[10px] text-gray-400 dark:text-prosota-muted mb-1">Recent in this project</div>
          <div className="flex flex-wrap gap-1">
            {recentColors.map(c => (
              <button
                key={c}
                onClick={() => onChange(c)}
                title={c}
                className={`w-5 h-5 rounded border ${c === value.toLowerCase() ? 'border-gray-900 dark:border-prosota-paper ring-1 ring-gray-900 dark:ring-prosota-paper' : 'border-gray-300 dark:border-prosota-line'}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
  return anchor ? createPortal(popover, document.body) : popover
}
