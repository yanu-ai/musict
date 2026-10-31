import { FlipHorizontal2, LoaderCircle } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef } from 'react'

type VideoPanelProps = {
  /** Object URL of an uploaded video, or the YouTube player's host element. */
  media: { src: string } | { youtube: HTMLElement }
  loading: boolean
  time: number
  playing: boolean
  speed: number
  mirrored: boolean
  zoom: number
  onMirroredChange: (v: boolean) => void
  onZoomChange: (v: number) => void
}

const ZOOMS = [1, 1.5, 2]

export function VideoPanel(p: VideoPanelProps) {
  const isYouTube = 'youtube' in p.media
  return (
    // YouTube requires the embed to be at least 200px in each direction.
    <div
      className={`neu-inset relative flex flex-1 items-center justify-center overflow-hidden rounded-2xl bg-black ${
        isYouTube ? 'min-h-[200px]' : 'min-h-[150px]'
      }`}
    >
      {'youtube' in p.media ? (
        <YouTubeHost element={p.media.youtube} />
      ) : (
        <FileVideo src={p.media.src} time={p.time} playing={p.playing} speed={p.speed} mirrored={p.mirrored} zoom={p.zoom} />
      )}

      {p.loading && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-deep/80 text-sm text-muted">
          <LoaderCircle className="size-5 animate-spin text-accent" />
          Loading video…
        </div>
      )}

      {/* Mirror/zoom only for uploaded files: YouTube's terms don't allow altering its player. */}
      {!isYouTube && (
        <div className="absolute right-3 bottom-3 flex items-center gap-2">
          <button
            type="button"
            aria-pressed={p.mirrored}
            onClick={() => p.onMirroredChange(!p.mirrored)}
            title="Mirror video (match a player facing you)"
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs backdrop-blur transition-colors ${
              p.mirrored ? 'bg-accent/15 text-accent' : 'bg-deep/70 text-muted hover:text-ink'
            }`}
          >
            <FlipHorizontal2 className="size-3.5" />
            Mirror
          </button>
          <div className="flex rounded-full bg-deep/70 p-0.5 backdrop-blur" role="group" aria-label="Zoom">
            {ZOOMS.map((z) => (
              <button
                key={z}
                type="button"
                aria-pressed={p.zoom === z}
                onClick={() => p.onZoomChange(z)}
                className={`rounded-full px-2.5 py-1 font-mono text-[11px] transition-colors ${
                  p.zoom === z ? 'bg-accent/15 text-accent' : 'text-muted hover:text-ink'
                }`}
              >
                {z}×
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** Mounts the YouTube player's element; the YouTubePlayer drives it. */
function YouTubeHost({ element }: { element: HTMLElement }) {
  const host = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = host.current!
    el.appendChild(element)
    return () => {
      if (element.parentNode === el) el.removeChild(element)
    }
  }, [element])
  return <div ref={host} className="absolute inset-0" />
}

/**
 * Muted picture that follows the audio engine's clock. The audio is the
 * source of truth, so the video is steered back whenever it drifts.
 */
function FileVideo({ src, time, playing, speed, mirrored, zoom }: { src: string; time: number; playing: boolean; speed: number; mirrored: boolean; zoom: number }) {
  const video = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const v = video.current!
    if (playing) v.play().catch(() => {})
    else v.pause()
  }, [playing])

  useEffect(() => {
    const v = video.current!
    const drift = time - v.currentTime
    if (!playing) {
      v.playbackRate = speed
      if (Math.abs(drift) > 0.04) v.currentTime = time
    } else if (Math.abs(drift) > 0.5) {
      // Big jumps (seeks, loop wraps): seek the video.
      v.currentTime = time
    } else {
      // Small drift: run slightly fast or slow to catch up smoothly instead of stuttering.
      v.playbackRate = speed * (1 + Math.max(-0.25, Math.min(0.25, drift)))
    }
  }, [time, playing, speed])

  return (
    <video
      ref={video}
      src={src}
      muted
      playsInline
      preload="auto"
      className="absolute inset-0 size-full object-contain transition-transform duration-300"
      style={{ transform: `scale(${mirrored ? -zoom : zoom}, ${zoom})` }}
    />
  )
}
