import { UserError, type Range } from '../lib/types'
import type { Capabilities, Player } from './player'

// Minimal types for the parts of the YouTube IFrame API we use.
type YTPlayer = {
  playVideo(): void
  pauseVideo(): void
  seekTo(seconds: number, allowSeekAhead: boolean): void
  getCurrentTime(): number
  getDuration(): number
  setPlaybackRate(rate: number): void
  getVideoData?(): { title?: string; author?: string }
  destroy(): void
}
type YTNamespace = {
  Player: new (
    el: HTMLElement,
    options: {
      videoId: string
      width: string
      height: string
      playerVars: Record<string, number | string>
      events: {
        onReady: () => void
        onError: (e: { data: number }) => void
        onStateChange: (e: { data: number }) => void
      }
    },
  ) => YTPlayer
}
declare global {
  interface Window {
    YT?: YTNamespace
    onYouTubeIframeAPIReady?: () => void
  }
}

let api: Promise<YTNamespace> | null = null
function loadApi(): Promise<YTNamespace> {
  api ??= new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT)
    window.onYouTubeIframeAPIReady = () => resolve(window.YT!)
    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    script.onerror = () => {
      api = null
      reject(new UserError('Couldn’t reach YouTube. Check your connection and try again.'))
    }
    document.head.appendChild(script)
  })
  return api
}

const ERRORS: Record<number, string> = {
  2: 'That doesn’t look like a valid YouTube video.',
  5: 'YouTube couldn’t play this video in the browser.',
  100: 'That video is private or was removed.',
  101: 'The owner of this video doesn’t allow it to be played on other sites.',
  150: 'The owner of this video doesn’t allow it to be played on other sites.',
}

/** Pulls the video id out of the common YouTube URL shapes. */
export function parseYouTubeId(input: string): string | null {
  const text = input.trim()
  if (/^[\w-]{11}$/.test(text)) return text
  try {
    const url = new URL(text.startsWith('http') ? text : `https://${text}`)
    const host = url.hostname.replace(/^(www|m|music)\./, '')
    if (host === 'youtu.be') return url.pathname.slice(1, 12) || null
    if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') return null
    const v = url.searchParams.get('v')
    if (v) return v.slice(0, 11)
    const match = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

const PLAYING = 1
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Drives the official embedded YouTube player. YouTube doesn't expose the
 * audio, so there's no pitch shifting, stems or waveform, and loops are done
 * by seeking back, which can hiccup while YouTube buffers.
 */
export class YouTubePlayer implements Player {
  readonly capabilities: Capabilities = { pitch: false, stems: false, videoTransform: false, speedStep: 0.25 }
  /** Mounted into the page by VideoPanel; the iframe is created inside it. */
  readonly element: HTMLDivElement
  duration = 0
  title = ''

  private yt: YTPlayer | null = null
  private loop: Range | null = null
  private rate = 1
  private isPlaying = false
  private watcher = 0
  private pendingSeek: number | null = null

  constructor() {
    this.element = document.createElement('div')
    this.element.style.cssText = 'position:absolute;inset:0'
  }

  get currentTime(): number {
    return this.pendingSeek ?? this.yt?.getCurrentTime() ?? 0
  }

  get looping(): boolean {
    return this.loop !== null
  }

  async load(videoId: string): Promise<void> {
    const YT = await loadApi()
    // The iframe only loads once its host is in the document.
    for (let i = 0; i < 100 && !this.element.isConnected; i++) await sleep(20)

    const target = document.createElement('div')
    this.element.appendChild(target)
    let failure: string | null = null
    await new Promise<void>((resolve, reject) => {
      this.yt = new YT.Player(target, {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: { controls: 0, disablekb: 1, rel: 0, playsinline: 1, iv_load_policy: 3 },
        events: {
          onReady: () => resolve(),
          onError: (e) => {
            failure = ERRORS[e.data] ?? 'YouTube couldn’t load that video.'
            reject(new UserError(failure))
          },
          onStateChange: (e) => {
            this.isPlaying = e.data === PLAYING
            if (this.isPlaying) this.yt?.setPlaybackRate(this.rate)
          },
        },
      })
    })

    // Duration arrives with the video's metadata, a little after onReady.
    for (let i = 0; i < 100 && !(this.yt!.getDuration() > 0); i++) {
      if (failure) throw new UserError(failure)
      await sleep(100)
    }
    this.duration = this.yt!.getDuration()
    if (!(this.duration > 0)) throw new UserError('YouTube didn’t report how long this video is. Try again.')
    this.title = this.yt!.getVideoData?.().title || 'YouTube video'
  }

  async play() {
    this.yt?.playVideo()
    clearInterval(this.watcher)
    this.watcher = window.setInterval(() => {
      if (!this.yt) return
      const t = this.yt.getCurrentTime()
      if (this.pendingSeek !== null && Math.abs(t - this.pendingSeek) < 0.5) this.pendingSeek = null
      if (this.loop && t >= this.loop.end) this.seek(this.loop.start)
    }, 25)
  }

  pause() {
    clearInterval(this.watcher)
    this.yt?.pauseVideo()
  }

  seek(t: number) {
    const target = Math.min(this.duration, Math.max(0, t))
    this.pendingSeek = target
    this.yt?.seekTo(target, true)
  }

  setRate(rate: number) {
    this.rate = rate
    // A speed set while not playing is recorded but never applied, and setting the same
    // value again later is ignored, so only send it while playing (and on each start).
    if (this.isPlaying) this.yt?.setPlaybackRate(rate)
  }

  setPitch() {}
  setPreservePitch() {}

  setLoop(loop: Range | null) {
    this.loop = loop
  }

  dispose() {
    clearInterval(this.watcher)
    this.yt?.destroy()
    this.element.remove()
  }
}
