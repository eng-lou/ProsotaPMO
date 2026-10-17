import type { ReactNode } from 'react'

export function Field({label, children}: {label: string; children: ReactNode}) {
  return <label>{label}{children}</label>
}
export function NumberInput({value, onChange, min = 0, max = 1000000, step = 'any'}: {
  value: number; onChange: (n: number) => void; min?: number; max?: number; step?: string
}) {
  return <input type="number" min={min} max={max} step={step} value={value}
    onChange={e => {if (Number.isFinite(e.target.valueAsNumber)) onChange(e.target.valueAsNumber)}}/>
}
export function Empty({children}: {children: ReactNode}) {return <div className="mw-empty">{children}</div>}
export function money(value: number, currency: string) {
  return new Intl.NumberFormat('en-GB', {style: 'currency', currency, maximumFractionDigits: 2}).format(value)
}
