import { Pause, Play, Repeat, RotateCcw, SkipBack, SkipForward } from 'lucide-react'
import type { ReactNode } from 'react'

type TransportProps = {
  playing: boolean
  loopOn: boolean
  onTogglePlay: () => void
  onToggleLoop: () => void
  onBack: () => void
  onPrevSection: () => void
  onNextSection: () => void
  compact?: boolean
}

export function Transport(p: TransportProps) {
  return (
    <div className={`flex items-center justify-center ${p.compact ? 'gap-3' : 'gap-5'}`}>
      <RoundButton compact={p.compact} label="Back 2 seconds" onClick={p.onBack}>
        <RotateCcw className="size-4" />
      </RoundButton>
      <RoundButton compact={p.compact} label="Previous section" onClick={p.onPrevSection}>
        <SkipBack className="size-4" fill="currentColor" />
      </RoundButton>
      <button
        type="button"
        aria-label={p.playing ? 'Pause' : 'Play'}
        onClick={p.onTogglePlay}
        className={`neu-metal flex items-center ${p.compact ? 'size-14' : 'size-20'} justify-center rounded-full text-deep transition-transform active:scale-95`}
      >
        {p.playing ? (
          <Pause className={p.compact ? 'size-5' : 'size-7'} fill="currentColor" />
        ) : (
          <Play className={`ml-1 ${p.compact ? 'size-5' : 'size-7'}`} fill="currentColor" />
        )}
      </button>
      <RoundButton compact={p.compact} label="Next section" onClick={p.onNextSection}>
        <SkipForward className="size-4" fill="currentColor" />
      </RoundButton>
      <RoundButton compact={p.compact} label="Loop section" onClick={p.onToggleLoop} active={p.loopOn}>
        <Repeat className="size-4" />
      </RoundButton>
    </div>
  )
}

function RoundButton({ label, onClick, active, compact, children }: { label: string; onClick: () => void; active?: boolean; compact?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={`flex items-center ${compact ? 'size-10' : 'size-12'} justify-center rounded-full transition-colors ${
        active ? 'neu-inset text-accent' : 'neu-soft text-muted hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}
