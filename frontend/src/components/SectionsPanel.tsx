import { BookmarkPlus, MousePointerClick, Play, X } from 'lucide-react'
import type { Section, Track } from '../lib/types'
import { formatTime } from '../lib/types'

type SectionsPanelProps = {
  sections: Section[]
  activeId: string | null
  editingId: string | null
  playing: boolean
  track: Track | null
  canSaveLoop: boolean
  onSelect: (id: string) => void
  onPlay: (id: string) => void
  onSaveLoop: () => void
  onStartEdit: (id: string) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
}

export function SectionsPanel(p: SectionsPanelProps) {
  return (
    <aside className="neu-raised flex h-full flex-col rounded-[32px] p-6">
      {p.track?.kind === 'video' ? (
        <div className="pb-5">
          <TrackTitle track={p.track} />
        </div>
      ) : (
        <div className="flex flex-col items-center pb-5 text-center">
          <div className={`vinyl relative size-28 rounded-full ${p.playing ? 'animate-spin-slow' : ''}`}>
            <div className="neu-metal absolute inset-[38%] rounded-full" />
            <div className="absolute inset-[47%] rounded-full bg-deep" />
          </div>
          <div className="mt-5 w-full">
            {p.track ? <TrackTitle track={p.track} centered /> : <p className="text-sm text-faint">No file loaded</p>}
          </div>
        </div>
      )}

      <div className="mb-3 flex items-baseline justify-between px-1">
        <h3 className="text-xs font-semibold tracking-[0.18em] text-muted uppercase">Sections</h3>
        <span className="font-mono text-[11px] text-faint">{p.sections.length}</span>
      </div>

      {p.sections.length === 0 ? (
        <EmptyHint />
      ) : (
        <ul className="-mx-2 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 py-1">
          {p.sections.map((s) => {
            const active = s.id === p.activeId
            return (
              <li
                key={s.id}
                className={`group flex items-center gap-2 rounded-2xl py-2 pr-2 pl-3 transition-colors ${
                  active ? 'neu-inset' : 'hover:bg-white/[0.03]'
                }`}
              >
                {p.editingId === s.id ? (
                  <input
                    autoFocus
                    defaultValue={s.name}
                    aria-label="Section name"
                    onFocus={(e) => e.currentTarget.select()}
                    onBlur={(e) => p.onRename(s.id, e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                      if (e.key === 'Escape') p.onRename(s.id, s.name)
                    }}
                    className="min-w-0 flex-1 rounded-lg bg-deep px-2 py-1 text-sm text-ink outline-none ring-1 ring-accent/50"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => p.onSelect(s.id)}
                    onDoubleClick={() => p.onStartEdit(s.id)}
                    title="Click to loop · double-click to rename"
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className={`block truncate text-sm ${active ? 'text-ink' : 'text-ink/85'}`}>{s.name}</span>
                    <span className="block font-mono text-[11px] text-faint">
                      {formatTime(s.start, true)} – {formatTime(s.end, true)}
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  aria-label={`Delete ${s.name}`}
                  onClick={() => p.onDelete(s.id)}
                  className="flex size-6 items-center justify-center rounded-full text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-ink focus-visible:opacity-100"
                >
                  <X className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={`Play ${s.name}`}
                  onClick={() => p.onPlay(s.id)}
                  className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
                    active ? 'neu-metal text-deep' : 'neu-soft text-faint hover:text-muted'
                  }`}
                >
                  <Play className="ml-0.5 size-3.5" fill="currentColor" />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <button
        type="button"
        disabled={!p.canSaveLoop}
        onClick={p.onSaveLoop}
        className="mt-4 flex items-center justify-center gap-2 rounded-2xl border border-dashed border-line py-3 text-sm text-muted transition-colors enabled:hover:border-accent/50 enabled:hover:text-accent disabled:opacity-40"
      >
        <BookmarkPlus className="size-4" />
        Save loop as section
        <kbd className="neu-soft rounded px-1.5 font-mono text-[10px]">S</kbd>
      </button>
    </aside>
  )
}

function TrackTitle({ track, centered }: { track: Track; centered?: boolean }) {
  const title = track.name
  const chips = track.duration ? [formatTime(track.duration), ...track.details] : track.details
  return (
    <>
      <h2 className="truncate text-lg font-semibold" title={track.name}>
        {title}
      </h2>
      <div className={`mt-3 flex flex-wrap gap-2 font-mono text-[11px] text-muted ${centered ? 'justify-center' : ''}`}>
        {chips.map((c) => (
          <span key={c} className="neu-inset rounded-full px-2.5 py-1">
            {c}
          </span>
        ))}
      </div>
    </>
  )
}

function EmptyHint() {
  const steps = [
    ['Drag', 'across the waveform to loop a passage'],
    ['S', 'saves the loop as a named section'],
    ['M', 'drops a marker while listening'],
    ['Double-click', 'between markers to loop that span'],
  ]
  return (
    <div className="neu-inset flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-2xl p-4">
      <MousePointerClick className="size-5 text-accent" />
      <p className="text-sm text-ink/85">No sections yet. Mark out the parts you want to work on.</p>
      <ul className="flex flex-col gap-2 text-xs text-muted">
        {steps.map(([key, text]) => (
          <li key={key} className="flex items-baseline gap-2">
            <kbd className="neu-soft shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] text-ink/80">{key}</kbd>
            {text}
          </li>
        ))}
      </ul>
    </div>
  )
}
