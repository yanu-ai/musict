import { useRef } from 'react'

type FaderProps = {
  label: string
  value: number
  onChange: (v: number) => void
  dimmed?: boolean
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

export function Fader({ label, value, onChange, dimmed }: FaderProps) {
  const track = useRef<HTMLDivElement>(null)

  const setFromY = (clientY: number) => {
    const r = track.current!.getBoundingClientRect()
    onChange(clamp01(1 - (clientY - r.top) / r.height))
  }

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={`${label} level`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      className={`relative flex h-36 w-10 cursor-ns-resize touch-none select-none justify-center transition-opacity ${dimmed ? 'opacity-35' : ''}`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        setFromY(e.clientY)
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) setFromY(e.clientY)
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp') onChange(clamp01(value + 0.05))
        else if (e.key === 'ArrowDown') onChange(clamp01(value - 0.05))
        else return
        e.preventDefault()
      }}
    >
      {/* tick marks */}
      <div className="pointer-events-none absolute inset-y-2 left-0 flex flex-col justify-between">
        {Array.from({ length: 9 }, (_, i) => (
          <div key={i} className={`h-px bg-faint ${i % 4 === 0 ? 'w-2' : 'w-1'}`} />
        ))}
      </div>
      <div ref={track} className="neu-inset relative my-2 w-2 rounded-full">
        <div
          className="absolute inset-x-0 bottom-0 rounded-full bg-accent/60 shadow-[0_0_8px_rgba(127,224,208,0.5)]"
          style={{ height: `${value * 100}%` }}
        />
        <div
          className="neu-soft absolute left-1/2 flex h-7 w-8 -translate-x-1/2 translate-y-1/2 items-center justify-center rounded-md"
          style={{ bottom: `${value * 100}%` }}
        >
          <div className="h-[2px] w-4 rounded-full bg-ink/80" />
        </div>
      </div>
    </div>
  )
}
