import { FileAudio, LoaderCircle, Play, Upload, X } from 'lucide-react'
import { useState } from 'react'
import type { Recent } from '../lib/storage'

type DropZoneProps = {
  loading: boolean
  error: string | null
  dragging: boolean
  recents: Recent[]
  onBrowse: () => void
  onYouTube: (link: string) => void
  onOpenRecent: (recent: Recent) => void
  onRemoveRecent: (id: string) => void
}

export function DropZone(p: DropZoneProps) {
  const [link, setLink] = useState('')

  return (
    <div
      className={`neu-inset flex flex-1 flex-col items-center justify-center gap-5 overflow-y-auto rounded-3xl border-2 border-dashed p-6 text-center transition-colors sm:p-8 ${
        p.dragging ? 'border-accent/70' : 'border-transparent'
      }`}
    >
      {p.loading ? (
        <>
          <LoaderCircle className="size-10 animate-spin text-accent" />
          <p className="text-muted">Decoding audio…</p>
        </>
      ) : (
        <>
          <div className="neu-soft flex size-16 shrink-0 items-center justify-center rounded-full text-accent">
            <Upload className="size-7" />
          </div>
          <div>
            <p className="text-xl font-semibold">Drop a song or video here</p>
            <p className="mt-1 text-sm text-muted">MP3, WAV, M4A, FLAC or MP4. Everything stays on your computer.</p>
          </div>
          <button
            type="button"
            onClick={p.onBrowse}
            className="neu-soft rounded-full px-6 py-2.5 text-sm font-medium transition-colors hover:text-accent"
          >
            Browse files
          </button>

          <form
            className="flex w-full max-w-md items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (link.trim()) p.onYouTube(link)
            }}
          >
            <span className="text-xs text-faint">or</span>
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="Paste a YouTube link"
              aria-label="YouTube link"
              className="neu-inset min-w-0 flex-1 rounded-full px-4 py-2 text-sm text-ink outline-none placeholder:text-faint focus-visible:ring-1 focus-visible:ring-accent/50"
            />
            <button
              type="submit"
              disabled={!link.trim()}
              className="neu-soft rounded-full px-4 py-2 text-sm transition-colors enabled:hover:text-accent disabled:opacity-40"
            >
              Open
            </button>
          </form>

          {p.error && <p className="max-w-md text-sm text-[#f0a3a3]">{p.error}</p>}

          {p.recents.length > 0 && (
            <div className="w-full max-w-md text-left">
              <h3 className="mb-2 px-1 text-xs font-semibold tracking-[0.18em] text-muted uppercase">Recent</h3>
              <ul className="flex flex-col gap-1">
                {p.recents.map((r) => (
                  <li key={r.id} className="group flex items-center gap-2 rounded-xl pr-1 hover:bg-white/[0.03]">
                    <button
                      type="button"
                      onClick={() => p.onOpenRecent(r)}
                      className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left"
                    >
                      {r.source === 'youtube' ? (
                        <Play className="size-4 shrink-0 text-[#f28b82]" fill="currentColor" />
                      ) : (
                        <FileAudio className="size-4 shrink-0 text-muted" />
                      )}
                      <span className="truncate text-sm text-ink/85">{r.name}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${r.name} from recent`}
                      onClick={() => p.onRemoveRecent(r.id)}
                      className="flex size-6 items-center justify-center rounded-full text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-ink focus-visible:opacity-100"
                    >
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  )
}
