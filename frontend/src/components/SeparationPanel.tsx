import { Check, X } from 'lucide-react'
import { useState } from 'react'
import type { SeparationStatus } from '../separation/useSeparation'

type SeparationPanelProps = {
  status: SeparationStatus
  /** Stems for this song are already playable (show the slim bar, not the big box). */
  stemsLoaded: boolean
  onSeparate: () => void
  onConfirm: (autoSeparate: boolean) => void
  onCancel: () => void
}

/** The top of the Stems panel: start, the one-time download OK, progress and errors. */
export function SeparationPanel({ status, stemsLoaded, onSeparate, onConfirm, onCancel }: SeparationPanelProps) {
  const [autoTicked, setAutoTicked] = useState(true)

  if (status.kind === 'unavailable') {
    return status.reason ? <Box>{status.reason}</Box> : null
  }
  if (status.kind === 'done') return null

  // Cancelled after some stems arrived: keep them, and offer to finish the job.
  if (status.kind === 'idle' && stemsLoaded) {
    return (
      <div className="mb-5 flex items-center justify-between gap-2 text-[11px] text-muted">
        <span>Only part of this song is separated</span>
        <button type="button" onClick={onSeparate} className="neu-soft shrink-0 rounded-full px-2.5 py-1 text-accent">
          Separate the rest
        </button>
      </div>
    )
  }

  if (status.kind === 'idle') {
    return (
      <Box>
        <p>Split this song into vocals, drums, bass, guitar, piano and other.</p>
        <button type="button" onClick={onSeparate} className="neu-soft my-3 w-full rounded-full px-3 py-2 text-sm font-semibold text-accent">
          Separate stems
        </button>
        <p className="text-faint">Runs on this computer · nothing is uploaded</p>
      </Box>
    )
  }

  if (status.kind === 'confirm') {
    return (
      <Box>
        <p>
          First time only: download the separation model ({Math.round(status.bytes / 1e6)} MB). It's saved in this browser.
        </p>
        <div className="my-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => onConfirm(autoTicked)}
            className="neu-soft flex-1 rounded-full px-3 py-2 text-sm font-semibold text-accent"
          >
            Download and separate
          </button>
          <button type="button" onClick={onCancel} className="px-2 text-xs text-muted hover:text-ink">
            Cancel
          </button>
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={autoTicked} onChange={(e) => setAutoTicked(e.target.checked)} className="accent-accent" />
          Separate new songs automatically
        </label>
      </Box>
    )
  }

  if (status.kind === 'error') {
    return (
      <Box>
        <p>{status.message}</p>
        <button type="button" onClick={onSeparate} className="neu-soft mt-3 w-full rounded-full px-3 py-1.5 text-xs text-ink hover:text-accent">
          Try again
        </button>
      </Box>
    )
  }

  // Running. Once the loop's stems play, shrink to one line so the faders are usable.
  const percent = Math.round(status.fraction * 100)
  if (stemsLoaded) {
    return (
      <div className="mb-5 flex items-center gap-2 text-[11px] text-muted">
        {status.loopReady && <Check className="size-3.5 shrink-0 text-accent" />}
        <span className="shrink-0">{!status.hasLoop ? 'Separating' : status.loopReady ? 'Loop ready · rest of song' : 'Separating your loop…'}</span>
        <Bar fraction={status.fraction} />
        <span className="w-8 shrink-0 text-right font-mono">{percent}%</span>
        <button type="button" aria-label="Cancel separation" title="Cancel" onClick={onCancel} className="shrink-0 text-faint hover:text-ink">
          <X className="size-3.5" />
        </button>
      </div>
    )
  }
  const label =
    status.phase === 'download'
      ? 'Downloading model…'
      : status.phase === 'prepare'
        ? 'Getting ready…'
        : status.hasLoop
          ? 'Separating your loop…'
          : 'Separating…'
  return (
    <Box>
      <div className="mb-2 flex justify-between">
        <span>{label}</span>
        {status.phase !== 'prepare' && <span className="font-mono">{percent}%</span>}
      </div>
      <Bar fraction={status.phase === 'prepare' ? 0 : status.fraction} />
      <div className="mt-2.5 flex items-center justify-between">
        <span className="text-faint">Keep this tab open for full speed</span>
        <button type="button" onClick={onCancel} className="text-muted hover:text-ink">
          Cancel
        </button>
      </div>
    </Box>
  )
}

function Box({ children }: { children: React.ReactNode }) {
  return <div className="mb-5 rounded-2xl border border-dashed border-line px-3 py-2.5 text-xs text-muted">{children}</div>
}

function Bar({ fraction }: { fraction: number }) {
  return (
    <div className="neu-inset h-1.5 w-full overflow-hidden rounded-full">
      <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${Math.round(fraction * 100)}%` }} />
    </div>
  )
}
