export type Range = { start: number; end: number }
export type Section = Range & { id: string; name: string }
export type Stem = { id: string; name: string; level: number; muted: boolean; solo: boolean; shown: boolean }
export type MediaKind = 'audio' | 'video'
export type Source = 'file' | 'youtube'

export type Track = {
  /** Stable key for saving work: `file:<name>:<size>` or `yt:<videoId>`. */
  id: string
  name: string
  source: Source
  kind: MediaKind
  /** Object URL for an uploaded video file. */
  url: string | null
  /** Host element for the YouTube iframe. */
  youtube: HTMLElement | null
  /** 0 until the media is ready. */
  duration: number
  /** Normalized peak heights at `peaksPerSecond`; null when there's no audio data (YouTube). */
  peaks: Float32Array | null
  peaksPerSecond: number
  /** Short facts shown as chips, e.g. "44.1 kHz". */
  details: string[]
}

// The six stems the separator makes, plus Rest: stems you don't pick play through the Rest fader.
export const initialStems: Stem[] = [
  { id: 'vocals', name: 'Vocals', level: 0.8, muted: false, solo: false, shown: true },
  { id: 'drums', name: 'Drums', level: 0.8, muted: false, solo: false, shown: true },
  { id: 'bass', name: 'Bass', level: 0.8, muted: false, solo: false, shown: true },
  { id: 'guitar', name: 'Guitar', level: 0.8, muted: false, solo: false, shown: true },
  { id: 'piano', name: 'Piano', level: 0.8, muted: false, solo: false, shown: true },
  { id: 'other', name: 'Other', level: 0.8, muted: false, solo: false, shown: false },
  { id: 'rest', name: 'Rest', level: 0.8, muted: false, solo: false, shown: true },
]

/** Saved mixer settings, with any stems added since they were saved. */
export const withAllStems = (saved?: Stem[]): Stem[] => initialStems.map((s) => saved?.find((x) => x.id === s.id) ?? s)

export function formatTime(seconds: number, precise = false): string {
  const m = Math.floor(seconds / 60)
  const s = seconds - m * 60
  const ss = precise ? s.toFixed(1).padStart(4, '0') : Math.floor(s).toString().padStart(2, '0')
  return `${m}:${ss}`
}

/** An error whose message is safe to show the user as-is. */
export class UserError extends Error {}
