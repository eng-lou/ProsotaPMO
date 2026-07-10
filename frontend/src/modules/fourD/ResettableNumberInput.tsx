import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react'

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type'> {
  value: number
  defaultValue: number
  onChange: (value: number) => void
}

// Hover-and-press-Backspace-to-reset (2026-07-11, per Maro, mirroring
// Blender's own numeric fields: hover one — no need to click into it first —
// and Backspace resets it to its default). Used across
// PropertiesPanel.tsx/TransformPanel.tsx instead of a plain <input
// type="number"> wherever a field has a well-defined default.
//
// The reset listener is attached to `document`, not the input's own
// onKeyDown, and only while the mouse is actually over this field (added on
// mouseenter, removed on mouseleave/unmount) — that's what lets Backspace
// reset it on hover alone, unlike a focus-gated onKeyDown which would need
// a click first. It explicitly backs off when the field is focused
// (document.activeElement check) so normal text editing — backspacing out
// a digit you're mid-typing — isn't hijacked; the reset behaviour only
// applies to the hover-only, not-currently-editing state.
export function ResettableNumberInput({ value, defaultValue, onChange, ...rest }: Props) {
  const [hovered, setHovered] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!hovered || rest.disabled) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Backspace') return
      if (document.activeElement === inputRef.current) return
      e.preventDefault()
      onChange(defaultValue)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [hovered, defaultValue, onChange, rest.disabled])

  return (
    <input
      {...rest}
      ref={inputRef}
      type="number"
      value={value}
      onChange={e => {
        // Number.isFinite, not `|| defaultValue` (2026-07-08 fix) — the OR
        // treated a legitimately-typed 0 as falsy and silently snapped it to
        // defaultValue instead (invisible for Location/Rotation fields,
        // whose default *is* 0, but wrong for Scale, whose default is 1).
        const parsed = Number(e.target.value)
        onChange(Number.isFinite(parsed) ? parsed : defaultValue)
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={rest.title ?? `Backspace (while hovering) to reset to ${defaultValue}`}
    />
  )
}
