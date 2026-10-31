import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { resamplePeaks } from '../audio/peaks'
import type { Range, Section } from '../lib/types'
import { formatTime } from '../lib/types'

type WaveformProps = {
  /** null when there's no audio data (YouTube): a plain timeline is drawn instead. */
  peaks: Float32Array | null
  peaksPerSecond: number
  duration: number
  time: number
  playing: boolean
  sections: Section[]
  activeId: string | null
  loop: Range | null
  loopOn: boolean
  markers: number[]
  compact?: boolean
  onSeek: (t: number) => void
  /** `new` when drawing a fresh loop, `edit` when dragging an existing edge. */
  onLoopChange: (range: Range, kind: 'new' | 'edit') => void
  onDoubleClickAt: (t: number) => void
}

type Drag = { mode: 'new' | 'start' | 'end'; anchor: number; x: number; moved: boolean }

const MIN_LOOP = 0.5
const MIN_VIEW = 2
const BAR_PX = 4
const STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function Waveform(p: WaveformProps) {
  const area = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  /** Pinch scale seen so far in the current Safari gesture. */
  const gestureScale = useRef(1)
  const [width, setWidth] = useState(600)
  const [view, setView] = useState<Range>({ start: 0, end: p.duration })
  const viewLen = view.end - view.start
  const zoomed = viewLen < p.duration - 0.01

  // Keep the playhead on screen while playing (adjusting state during render is fine here).
  if (p.playing && zoomed && (p.time > view.end || p.time < view.start)) {
    const start = clamp(p.time - viewLen * 0.1, 0, p.duration - viewLen)
    setView({ start, end: start + viewLen })
  }

  useEffect(() => {
    const el = area.current!
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const zoomAround = (t: number, factor: number) => {
    const len = clamp(viewLen * factor, Math.min(MIN_VIEW, p.duration), p.duration)
    const start = clamp(t - (t - view.start) * (len / viewLen), 0, p.duration - len)
    setView({ start, end: start + len })
  }
  const panBy = (dt: number) => {
    const start = clamp(view.start + dt, 0, p.duration - viewLen)
    setView({ start, end: start + viewLen })
  }
  const fit = () => setView({ start: 0, end: p.duration })
  const centerOn = (t: number) => panBy(t - viewLen / 2 - view.start)

  // Native listener: React's wheel handler is passive and can't stop browser zoom.
  useEffect(() => {
    const el = area.current!
    const onWheel = (e: WheelEvent) => {
      const r = el.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        zoomAround(view.start + ((e.clientX - r.left) / r.width) * viewLen, Math.exp(e.deltaY * 0.01))
      } else if (zoomed && (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey)) {
        e.preventDefault()
        panBy(((e.shiftKey ? e.deltaY : e.deltaX) / r.width) * viewLen)
      }
    }
    // Safari reports trackpad pinches as its own gesture events rather than ctrl+wheel,
    // and zooms the whole page unless they're cancelled.
    const onGesture = (e: Event) => {
      const g = e as Event & { scale: number; clientX: number }
      e.preventDefault()
      if (e.type === 'gesturestart') gestureScale.current = 1
      else if (e.type === 'gesturechange' && g.scale > 0) {
        const r = el.getBoundingClientRect()
        zoomAround(view.start + ((g.clientX - r.left) / r.width) * viewLen, gestureScale.current / g.scale)
        gestureScale.current = g.scale
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) el.addEventListener(type, onGesture)
    return () => {
      el.removeEventListener('wheel', onWheel)
      for (const type of ['gesturestart', 'gesturechange', 'gestureend']) el.removeEventListener(type, onGesture)
    }
  })

  // = / - zoom around the playhead, 0 fits the whole song.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, [role="slider"]') || e.metaKey || e.ctrlKey) return
      if (e.key === '=' || e.key === '+') zoomAround(p.time, 0.5)
      else if (e.key === '-') zoomAround(p.time, 2)
      else if (e.key === '0') fit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const pct = (t: number) => `${((t - view.start) / viewLen) * 100}%`
  const timeAt = (clientX: number) => {
    const r = area.current!.getBoundingClientRect()
    return clamp(view.start + ((clientX - r.left) / r.width) * viewLen, 0, p.duration)
  }

  const startEdgeDrag = (e: ReactPointerEvent, mode: 'start' | 'end') => {
    if (!p.loop) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { mode, anchor: mode === 'start' ? p.loop.end : p.loop.start, x: e.clientX, moved: true }
  }

  const barCount = Math.max(40, Math.floor(width / BAR_PX))
  const bars = p.peaks ? resamplePeaks(p.peaks, p.peaksPerSecond, view.start, view.end, barCount) : null
  const step = STEPS.find((s) => viewLen / s <= 8) ?? 1200
  const ticks: number[] = []
  // Skip a label hugging the right edge, where it would be cut off.
  for (let t = Math.ceil(view.start / step) * step; t < view.end - step * 0.4; t += step) ticks.push(t)

  return (
    <div className="select-none">
      {/* saved section labels */}
      <div className="relative mb-2 h-5 overflow-hidden">
        {p.sections
          .filter((s) => s.end > view.start && s.start < view.end)
          .map((s) => {
            const from = Math.max(s.start, view.start)
            return (
              <button
                key={s.id}
                type="button"
                title={s.name}
                onClick={() => p.onSeek(s.start)}
                className={`absolute top-0 truncate border-l pl-1.5 text-[11px] leading-5 transition-colors ${
                  p.activeId === s.id ? 'border-accent text-accent' : 'border-faint text-faint hover:text-muted'
                }`}
                style={{ left: pct(from), maxWidth: `${((s.end - from) / viewLen) * 100}%` }}
              >
                {s.name}
              </button>
            )
          })}
      </div>

      <div className="neu-inset relative rounded-2xl p-3">
        <div
          ref={area}
          className={`relative cursor-crosshair touch-none overflow-x-clip ${p.compact ? 'h-20' : 'h-36'}`}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            drag.current = { mode: 'new', anchor: timeAt(e.clientX), x: e.clientX, moved: false }
          }}
          onPointerMove={(e) => {
            const d = drag.current
            if (!d) return
            if (!d.moved && Math.abs(e.clientX - d.x) < 4) return
            d.moved = true
            const t = timeAt(e.clientX)
            if (d.mode === 'new') p.onLoopChange({ start: Math.min(d.anchor, t), end: Math.max(d.anchor, t) }, 'new')
            else if (d.mode === 'start') p.onLoopChange({ start: Math.min(t, d.anchor - MIN_LOOP), end: d.anchor }, 'edit')
            else p.onLoopChange({ start: d.anchor, end: Math.max(t, d.anchor + MIN_LOOP) }, 'edit')
          }}
          onPointerUp={() => {
            const d = drag.current
            if (d?.mode === 'new' && !d.moved) p.onSeek(d.anchor)
            drag.current = null
          }}
          onDoubleClick={(e) => p.onDoubleClickAt(timeAt(e.clientX))}
        >
          {p.loop && (
            <div
              className={`absolute inset-y-[-4px] rounded-lg border-x-2 transition-opacity ${
                p.loopOn ? 'border-accent/80 bg-accent/[0.07]' : 'border-dashed border-faint bg-white/[0.02]'
              }`}
              style={{ left: pct(p.loop.start), width: `${((p.loop.end - p.loop.start) / viewLen) * 100}%` }}
            >
              <span
                onPointerDown={(e) => startEdgeDrag(e, 'start')}
                className={`absolute -top-px -left-[2px] cursor-ew-resize rounded-br-md px-1.5 font-mono text-[10px] font-medium text-deep ${p.loopOn ? 'bg-accent' : 'bg-faint'}`}
              >
                A
              </span>
              <span
                onPointerDown={(e) => startEdgeDrag(e, 'end')}
                className={`absolute -top-px -right-[2px] cursor-ew-resize rounded-bl-md px-1.5 font-mono text-[10px] font-medium text-deep ${p.loopOn ? 'bg-accent' : 'bg-faint'}`}
              >
                B
              </span>
              <span onPointerDown={(e) => startEdgeDrag(e, 'start')} className="absolute inset-y-0 -left-2 w-4 cursor-ew-resize" />
              <span onPointerDown={(e) => startEdgeDrag(e, 'end')} className="absolute inset-y-0 -right-2 w-4 cursor-ew-resize" />
            </div>
          )}

          {bars ? (
            <Bars bars={bars} start={view.start} span={viewLen} time={p.time} loop={p.loopOn ? p.loop : null} />
          ) : (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="absolute inset-x-0 top-1/2 h-px bg-line" />
              <span className="relative rounded-full bg-deep px-3 py-1 text-[11px] text-faint">
                No waveform for YouTube videos
              </span>
            </div>
          )}

          {p.markers.map((m) => (
            <div key={m} className="pointer-events-none absolute inset-y-0 w-px bg-ink/40" style={{ left: pct(m) }}>
              <div className="absolute -top-1 left-1/2 size-2 -translate-x-1/2 rotate-45 bg-ink/70" />
            </div>
          ))}

          <div
            className="pointer-events-none absolute inset-y-[-6px] w-[2px] -translate-x-1/2 rounded-full bg-ink shadow-[0_0_10px_rgba(236,238,245,0.8)]"
            style={{ left: pct(p.time) }}
          />
        </div>

        {/* zoom controls */}
        <div
          className="absolute right-2 bottom-2 flex items-center rounded-full bg-deep/80 p-0.5 text-muted backdrop-blur"
          title="Ctrl/⌘ + scroll or pinch to zoom · scroll sideways to pan"
        >
          <ZoomButton label="Zoom out (-)" onClick={() => zoomAround(p.time, 2)} disabled={!zoomed}>
            <ZoomOut className="size-3.5" />
          </ZoomButton>
          <ZoomButton label="Zoom in (=)" onClick={() => zoomAround(p.time, 0.5)} disabled={viewLen <= MIN_VIEW}>
            <ZoomIn className="size-3.5" />
          </ZoomButton>
          <ZoomButton label="Show whole song (0)" onClick={fit} disabled={!zoomed}>
            <Maximize2 className="size-3" />
          </ZoomButton>
        </div>
      </div>

      <div className="relative mt-2 h-4 overflow-hidden font-mono text-[10px] text-faint">
        {ticks.map((t) => (
          <span key={t} className="absolute -translate-x-1/2 first:translate-x-0" style={{ left: pct(t) }}>
            {formatTime(t, step < 1)}
          </span>
        ))}
      </div>

      {zoomed && (
        <Overview
          peaks={p.peaks}
          perSecond={p.peaksPerSecond}
          duration={p.duration}
          view={view}
          time={p.time}
          onCenter={centerOn}
        />
      )}
    </div>
  )
}

function Bars({ bars, start, span, time, loop }: { bars: number[]; start: number; span: number; time: number; loop: Range | null }) {
  return (
    // SVG so any number of bars scales to any width.
    <svg className="pointer-events-none absolute inset-0 size-full" viewBox={`0 0 ${bars.length} 100`} preserveAspectRatio="none">
      {bars.map((peak, i) => {
        const t = start + ((i + 0.5) / bars.length) * span
        const played = t <= time
        const inLoop = loop && t >= loop.start && t <= loop.end
        const h = peak * 88
        return (
          <rect
            key={i}
            x={i + 0.2}
            y={50 - h / 2}
            width={0.6}
            height={h}
            className={played ? 'fill-accent' : inLoop ? 'fill-[#a3aac0]' : 'fill-[#454a5d]'}
            opacity={played && loop && !inLoop ? 0.45 : 1}
          />
        )
      })}
    </svg>
  )
}

/** Whole-song strip shown while zoomed; click or drag to move the view. */
function Overview(p: { peaks: Float32Array | null; perSecond: number; duration: number; view: Range; time: number; onCenter: (t: number) => void }) {
  const bars = p.peaks ? resamplePeaks(p.peaks, p.perSecond, 0, p.duration, 120) : null
  const at = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    p.onCenter(((e.clientX - r.left) / r.width) * p.duration)
  }
  return (
    <div
      className="neu-inset relative mt-2 h-7 cursor-pointer touch-none overflow-hidden rounded-lg"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        at(e)
      }}
      onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && at(e)}
    >
      {bars && (
        <svg className="pointer-events-none absolute inset-0 size-full" viewBox={`0 0 ${bars.length} 100`} preserveAspectRatio="none">
          {bars.map((b, i) => (
            <rect key={i} x={i + 0.15} y={50 - b * 40} width={0.7} height={b * 80} className="fill-[#454a5d]" />
          ))}
        </svg>
      )}
      <div
        className="pointer-events-none absolute inset-y-0 rounded-md border border-accent/70 bg-accent/10"
        style={{ left: `${(p.view.start / p.duration) * 100}%`, width: `${((p.view.end - p.view.start) / p.duration) * 100}%` }}
      />
      <div className="pointer-events-none absolute inset-y-0 w-px bg-ink" style={{ left: `${(p.time / p.duration) * 100}%` }} />
    </div>
  )
}

function ZoomButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded-full transition-colors hover:text-ink disabled:opacity-30"
    >
      {children}
    </button>
  )
}
