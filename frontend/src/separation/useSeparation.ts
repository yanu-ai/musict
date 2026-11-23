import { useEffect, useRef, useState } from 'react'
import type { AudioEngine } from '../audio/engine'
import { getAutoSeparate, setAutoSeparate } from '../lib/storage'
import { UserError, type Range, type Track } from '../lib/types'
import { BrowserSeparator } from './browserSeparator'
import type { Progress, SeparationJob } from './separator'

/** What the Stems panel shows. */
export type SeparationStatus =
  /** Not possible for this track (no file, or too long). `reason` is shown if set. */
  | { kind: 'unavailable'; reason: string | null }
  | { kind: 'idle' }
  /** Waiting for the one-time OK to download the model. */
  | { kind: 'confirm'; bytes: number }
  /** `loopReady`: the current loop's stems are playable (false right after the loop moves). */
  | { kind: 'running'; phase: Progress['phase']; fraction: number; hasLoop: boolean; loopReady: boolean }
  | { kind: 'done' }
  | { kind: 'error'; message: string }

type RunningStored = { kind: 'running'; phase: Progress['phase']; fraction: number }
/** Status as stored: tagged with the track it belongs to, so a new track starts fresh. */
type Stored = (Exclude<SeparationStatus, { kind: 'unavailable' | 'running' }> | RunningStored) & { trackId: string }

const loopKey = (loop: Range | null) => (loop ? `${loop.start}-${loop.end}` : null)

type Options = {
  engine: AudioEngine
  track: Track | null
  /** The active loop, separated first. */
  loop: Range | null
  /** Called when a track's first stems are playable (e.g. to switch the mixer on). */
  onStemsReady: () => void
}

/**
 * Runs stem separation for the open file: on request (with a one-time download OK),
 * or automatically once the user has allowed it. The loop goes first and is playable
 * early; moving the loop moves the work; opening another track cancels.
 */
export function useSeparation({ engine, track, loop, onStemsReady }: Options) {
  const [separator] = useState(() => new BrowserSeparator())
  const [stored, setStored] = useState<Stored | null>(null)
  /** Track whose stems are (at least partly) loaded in the engine. */
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [autoSeparate, setAuto] = useState(false)
  /** The loop whose stems were last made playable. */
  const [readyLoop, setReadyLoop] = useState<string | null>(null)
  const job = useRef<{ id: number; controller: AbortController; handle: SeparationJob } | null>(null)
  const jobCounter = useRef(0)
  const latest = useRef({ loop, onStemsReady })
  useEffect(() => {
    latest.current = { loop, onStemsReady }
  })

  const trackId = track?.id ?? null
  const eligible = track?.source === 'file' && track.duration > 0
  const tooLong = eligible && track.duration > separator.maxDuration
  const status: SeparationStatus = !eligible
    ? { kind: 'unavailable', reason: null }
    : tooLong
      ? { kind: 'unavailable', reason: `Stems work on songs up to ${separator.maxDuration / 60} minutes for now.` }
      : stored && stored.trackId === trackId
        ? stored.kind === 'running'
          ? { ...stored, hasLoop: !!loop, loopReady: !!loop && readyLoop === loopKey(loop) }
          : stored
        : { kind: 'idle' }

  const stop = () => {
    job.current?.controller.abort()
    job.current = null
  }

  /** Starts separating the loaded file. `background`: started automatically, so use fewer threads. */
  const start = (background: boolean) => {
    const audio = engine.audio
    if (!audio || !trackId) return
    stop()
    const id = ++jobCounter.current
    const controller = new AbortController()
    const current = () => job.current?.id === id
    let announced = false
    const stemsPlayable = () => {
      setLoadedFor(trackId)
      if (!announced) latest.current.onStemsReady()
      announced = true
    }
    let lastPercent = -1
    setStored({ trackId, kind: 'running', phase: 'prepare', fraction: 0 })

    const handle = separator.separate(audio, {
      priority: latest.current.loop,
      background,
      signal: controller.signal,
      onProgress: ({ phase, fraction }) => {
        const percent = Math.floor(fraction * 100)
        if (!current() || percent === lastPercent) return // at most one update per percent
        lastPercent = percent
        setStored({ trackId, kind: 'running', phase, fraction })
      },
      onPartial: async ({ stems, ready }) => {
        if (!current()) return
        const loop = latest.current.loop
        await engine.setStems(stems, ready)
        if (!current()) return
        setReadyLoop(loopKey(loop))
        stemsPlayable()
      },
    })
    job.current = { id, controller, handle }

    handle.result.then(
      async (stems) => {
        if (!current()) return
        await engine.setStems(stems, [{ start: 0, end: engine.duration }])
        if (!current()) return
        job.current = null
        stemsPlayable()
        setStored({ trackId, kind: 'done' })
      },
      (error) => {
        if (!current() || controller.signal.aborted) return // cancelled: not an error
        job.current = null
        const message = error instanceof UserError ? error.message : `Separation stopped: ${error instanceof Error ? error.message : error}`
        setStored({ trackId, kind: 'error', message })
      },
    )
  }

  // Remember whether the user allowed automatic separation.
  useEffect(() => {
    void getAutoSeparate().then(setAuto)
  }, [])

  // A new track (or closing it) cancels whatever was running for the old one.
  useEffect(() => stop, [trackId])

  // Auto-start: once allowed, newly opened songs separate by themselves, if the model is already here.
  const startRef = useRef(start)
  useEffect(() => {
    startRef.current = start
  })
  const autoStartedFor = useRef<string | null>(null)
  const canAutoStart = autoSeparate && eligible && !tooLong && status.kind === 'idle' && loadedFor !== trackId
  useEffect(() => {
    // Once per track, so cancelling doesn't immediately start it again.
    if (!canAutoStart || autoStartedFor.current === trackId) return
    autoStartedFor.current = trackId
    void separator.downloadSize().then((bytes) => bytes === 0 && startRef.current(true))
  }, [canAutoStart, trackId, separator])

  // Moving the loop moves the work there.
  const loopStart = loop?.start
  const loopEnd = loop?.end
  useEffect(() => {
    job.current?.handle.prioritize(loopStart !== undefined && loopEnd !== undefined ? { start: loopStart, end: loopEnd } : null)
  }, [loopStart, loopEnd])

  return {
    status,
    /** Stems for this track are in the engine (the mixer can be used). */
    stemsLoaded: loadedFor !== null && loadedFor === trackId,
    label: separator.label,
    autoSeparate,
    setAutoSeparate: (on: boolean) => {
      setAuto(on)
      void setAutoSeparate(on)
    },
    /** "Separate stems": asks first if the model still needs downloading. */
    request: () => {
      if (!trackId) return
      void separator.downloadSize().then((bytes) => (bytes > 0 ? setStored({ trackId, kind: 'confirm', bytes }) : start(false)))
    },
    /** The one-time OK. */
    confirm: (auto: boolean) => {
      setAuto(auto)
      void setAutoSeparate(auto)
      start(false)
    },
    /** Back to idle (from the OK box, a running job, or an error). Stems already loaded keep playing. */
    cancel: () => {
      stop()
      if (trackId) setStored({ trackId, kind: 'idle' })
    },
  }
}
