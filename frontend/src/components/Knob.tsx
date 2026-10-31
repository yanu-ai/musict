import { useRef, useState, type ReactNode } from 'react'

type KnobProps = {
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
  /** Draw the arc from the center value instead of from min (e.g. pitch ±). */
  bipolar?: boolean
  /** Turns typed text into a value; enables click-to-type on the readout. */
  parse?: (text: string) => number | null
  disabled?: boolean
  /** Extra controls under the readout, e.g. presets. */
  children?: ReactNode
}

const SWEEP = 135
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

function polar(r: number, deg: number) {
  const rad = (deg * Math.PI) / 180
  return [60 + r * Math.sin(rad), 60 - r * Math.cos(rad)]
}

function arc(r: number, from: number, to: number) {
  const [a, b] = from <= to ? [from, to] : [to, from]
  const [x1, y1] = polar(r, a)
  const [x2, y2] = polar(r, b)
  return `M ${x1} ${y1} A ${r} ${r} 0 ${b - a > 180 ? 1 : 0} 1 ${x2} ${y2}`
}

export function Knob({ label, value, min, max, step, format, onChange, bipolar, parse, disabled, children }: KnobProps) {
  const drag = useRef<{ y: number; v: number } | null>(null)
  const [typing, setTyping] = useState(false)
  const toAngle = (v: number) => -SWEEP + ((v - min) / (max - min)) * SWEEP * 2
  const angle = toAngle(value)
  const origin = bipolar ? toAngle((min + max) / 2) : -SWEEP
  const snap = (v: number) => clamp(Number((Math.round(v / step) * step).toFixed(4)), min, max)

  return (
    <div className={`flex flex-col items-center gap-2 transition-opacity ${disabled ? 'pointer-events-none opacity-35' : ''}`}>
      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={format(value)}
        className="relative size-24 cursor-ns-resize touch-none select-none rounded-full"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { y: e.clientY, v: value }
        }}
        onPointerMove={(e) => {
          if (!drag.current) return
          const delta = ((drag.current.y - e.clientY) / 160) * (max - min)
          onChange(snap(drag.current.v + delta))
        }}
        onPointerUp={() => (drag.current = null)}
        onDoubleClick={() => onChange(bipolar ? (min + max) / 2 : max)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowRight') onChange(snap(value + step))
          else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') onChange(snap(value - step))
          else return
          e.preventDefault()
        }}
      >
        <svg viewBox="0 0 120 120" className="absolute inset-0">
          <path d={arc(54, -SWEEP, SWEEP)} className="fill-none stroke-deep" strokeWidth={6} strokeLinecap="round" />
          {angle !== origin && (
            <path
              d={arc(54, origin, angle)}
              className="fill-none stroke-accent drop-shadow-[0_0_6px_rgba(127,224,208,0.7)]"
              strokeWidth={6}
              strokeLinecap="round"
            />
          )}
        </svg>
        <div className="neu-soft absolute inset-[15px] rounded-full">
          <div className="absolute inset-[9px] rounded-full bg-deep shadow-[inset_2px_2px_6px_#0e0f13]" />
          <div className="absolute inset-0" style={{ transform: `rotate(${angle}deg)` }}>
            <div className="mx-auto mt-[11px] h-3 w-[3px] rounded-full bg-muted" />
          </div>
        </div>
      </div>
      <div className="flex flex-col items-center text-center">
        <div className="text-xs font-medium text-muted">{label}</div>
        {typing && parse ? (
          <input
            autoFocus
            aria-label={`${label} value`}
            defaultValue={format(value)}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => {
              const v = parse(e.currentTarget.value)
              if (v !== null) onChange(clamp(v, min, max))
              setTyping(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') setTyping(false)
            }}
            className="w-20 rounded-md bg-deep px-1 text-center font-mono text-sm text-ink outline-none ring-1 ring-accent/50"
          />
        ) : (
          <button
            type="button"
            disabled={!parse}
            title={parse ? 'Click to type a value' : undefined}
            onClick={() => setTyping(true)}
            className="rounded-md px-1 font-mono text-sm text-ink enabled:hover:bg-white/5"
          >
            {format(value)}
          </button>
        )}
        {children}
      </div>
    </div>
  )
}
