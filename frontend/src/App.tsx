import { AudioLines, FileAudio, Film, Minus, Play, Plus, Upload, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { usePlayer } from './audio/usePlayer'
import { parseYouTubeId } from './audio/youtube'
import { DropZone } from './components/DropZone'
import { SectionsPanel } from './components/SectionsPanel'
import { StemMixer } from './components/StemMixer'
import { Transport } from './components/Transport'
import { VideoPanel } from './components/VideoPanel'
import { Waveform } from './components/Waveform'
import { useSections } from './hooks/useSections'
import { homeUrl, isYouTubePage, videoIdInUrl, youTubeUrl } from './lib/routes'
import {
  addRecent,
  listRecents,
  loadProject,
  loadRecentFile,
  removeRecent,
  requestPersistentStorage,
  saveHandoff,
  saveProject,
  takeHandoff,
  type CarriedWork,
  type Recent,
} from './lib/storage'
import type { Stem, Track } from './lib/types'
import { formatTime, initialStems } from './lib/types'

const round2 = (v: number) => Math.round(v * 100) / 100
/** YouTube mode and file mode are separate pages; see lib/routes.ts. */
const youTubePage = isYouTubePage()

function App() {
  const [speed, setSpeed] = useState(1)
  const [pitch, setPitch] = useState(0)
  const [cents, setCents] = useState(0)
  const [preservePitch, setPreservePitch] = useState(true)
  const [stems, setStems] = useState<Stem[]>(initialStems)
  const [stemsOn, setStemsOn] = useState(false)
  const [mirrored, setMirrored] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [dragging, setDragging] = useState(false)
  const [recents, setRecents] = useState<Recent[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  /** Which track's saved work has been restored; saving waits for it so defaults never overwrite a project. */
  const [hydratedId, setHydratedId] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  /** Work to bring along when switching from a YouTube video to the user's audio file. */
  const carryOver = useRef<CarriedWork | null>(null)
  /** Imported work the user can still shift to line up with the file. */
  const [alignment, setAlignment] = useState<{ from: string; ids: Set<string>; markers: number[]; offset: number } | null>(null)

  const sec = useSections()
  const audio = usePlayer({ speed, semitones: pitch + cents / 100, preservePitch, loop: sec.activeLoop })
  const { track, time, capabilities: caps } = audio
  const duration = track?.duration ?? 0

  useEffect(() => {
    void listRecents().then(setRecents)
  }, [])

  // ---- Opening media and restoring saved work ----

  const resetWork = () => {
    setHydratedId(null)
    setNotice(null)
    setAlignment(null)
    sec.restore(null)
  }

  const afterLoad = async (loaded: Track | null, file?: File, carried?: CarriedWork | null) => {
    if (!loaded) return
    const saved = await loadProject(loaded.id)
    sec.restore(saved ?? null)
    if (carried) {
      const added = sec.merge(carried.work)
      setAlignment({ from: carried.from, ...added, offset: 0 })
    }
    setSpeed(saved?.speed ?? carried?.speed ?? 1)
    setPitch(saved?.pitch ?? 0)
    setCents(saved?.cents ?? 0)
    setPreservePitch(saved?.preservePitch ?? true)
    setStems(saved?.stems ?? initialStems)
    setMirrored(saved?.mirrored ?? false)
    setZoom(saved?.zoom ?? 1)
    setHydratedId(loaded.id)
    void requestPersistentStorage()
    const videoId = loaded.source === 'youtube' ? loaded.id.slice(3) : undefined
    await addRecent({ id: loaded.id, name: loaded.name, source: loaded.source, videoId, openedAt: Date.now() }, file)
    setRecents(await listRecents())
  }

  const openFile = async (file: File, carried?: CarriedWork | null) => {
    // Files open on the (isolated) home page: hand this one over and go there.
    // If it can't be saved, fall back to opening it here, just without fast separation.
    if (youTubePage && (await saveHandoff(file, carried ?? null))) return location.assign(homeUrl())
    resetWork()
    await afterLoad(await audio.loadFile(file), file, carried)
  }

  /** From YouTube mode: pick the audio file and bring this video's work along. */
  const switchToFile = () => {
    if (!track) return
    carryOver.current = {
      from: track.name,
      work: { sections: sec.sections, markers: sec.markers, loop: sec.loop, loopOn: sec.loopOn },
      speed,
    }
    fileInput.current?.click()
  }

  const shiftImported = (delta: number) => {
    if (!alignment) return
    const markers = sec.shift(delta, duration, alignment.ids, alignment.markers)
    setAlignment({ ...alignment, markers, offset: Math.round((alignment.offset + delta) * 10) / 10 })
  }

  const openYouTube = async (link: string) => {
    const videoId = parseYouTubeId(link)
    // YouTube plays on its own (non-isolated) page. Bad links fall through so the player reports them.
    if (!youTubePage && videoId) return location.assign(youTubeUrl(videoId))
    resetWork()
    const loaded = await audio.loadYouTube(link)
    if (loaded) history.replaceState(null, '', youTubeUrl(loaded.id.slice(3)))
    await afterLoad(loaded)
  }

  const openRecent = async (recent: Recent) => {
    if (recent.source === 'youtube' && recent.videoId) return openYouTube(recent.videoId)
    const file = await loadRecentFile(recent.id)
    if (file) return openFile(file)
    setNotice(`“${recent.name}” is too large to keep for quick reopening. Choose the file again.`)
  }

  const closeTrack = () => {
    if (youTubePage) return location.assign(homeUrl())
    audio.close()
    resetWork()
  }

  // On page load: the YouTube page opens the video in its address; the home page
  // opens a file handed over from the YouTube page, if any.
  const started = useRef(false)
  const startRef = useRef(() => {})
  useEffect(() => {
    startRef.current = () => {
      if (youTubePage) {
        const videoId = videoIdInUrl()
        if (videoId) void openYouTube(videoId)
        else location.replace(homeUrl())
      } else {
        void takeHandoff().then((handoff) => handoff && openFile(handoff.file, handoff.carried))
      }
    }
  })
  useEffect(() => {
    // Once only, even when React's StrictMode runs effects twice in development.
    if (started.current) return
    started.current = true
    startRef.current()
  }, [])

  // Save work for this track shortly after anything changes.
  useEffect(() => {
    if (!track || hydratedId !== track.id) return
    const id = track.id
    const timer = setTimeout(() => {
      void saveProject(id, {
        sections: sec.sections,
        markers: sec.markers,
        loop: sec.loop,
        loopOn: sec.loopOn,
        speed,
        pitch,
        cents,
        preservePitch,
        stems,
        mirrored,
        zoom,
      })
    }, 400)
    return () => clearTimeout(timer)
  }, [track, hydratedId, sec.sections, sec.markers, sec.loop, sec.loopOn, speed, pitch, cents, preservePitch, stems, mirrored, zoom])

  // ---- Actions that combine sections with the playhead ----

  const selectSection = (id: string) => {
    const t = sec.select(id)
    if (t !== null) audio.seek(t)
  }
  const jump = (dir: 1 | -1) => {
    const t = sec.jumpTarget(time, dir)
    if (t !== undefined) audio.seek(t)
  }
  const speedStep = Math.max(0.05, caps.speedStep)
  const changeSpeed = (delta: number) => setSpeed((v) => Math.min(1.5, Math.max(0.25, round2(v + delta))))

  // ---- Window listeners (read through refs so they always see fresh state) ----

  const openFileRef = useRef(openFile)
  const onKey = useRef<(e: KeyboardEvent) => void>(() => {})
  useEffect(() => {
    openFileRef.current = openFile
    onKey.current = (e) => {
      const el = e.target as HTMLElement
      if (!audio.ready || el.closest('input, textarea, [role="slider"]') || e.metaKey || e.ctrlKey) return
      const k = e.key.toLowerCase()
      if (e.code === 'Space') {
        e.preventDefault()
        void audio.togglePlay()
      } else if (k === 'l') sec.setLoopOn((v) => !v)
      else if (k === 's') {
        // Stop the keystroke from landing in the name field that opens.
        e.preventDefault()
        sec.saveLoop()
      } else if (k === 'm') sec.addMarker(time)
      else if (k === 'escape') sec.clearLoop()
      else if (k === 'arrowleft') audio.seek(time - 2)
      else if (k === 'arrowright') audio.seek(time + 2)
      else if (k === '[') changeSpeed(-speedStep)
      else if (k === ']') changeSpeed(speedStep)
    }
  })

  useEffect(() => {
    const key = (e: KeyboardEvent) => onKey.current(e)
    const over = (e: DragEvent) => {
      e.preventDefault()
      setDragging(true)
    }
    const leave = (e: DragEvent) => {
      if (!e.relatedTarget) setDragging(false)
    }
    const drop = (e: DragEvent) => {
      e.preventDefault()
      setDragging(false)
      const file = e.dataTransfer?.files[0]
      if (file) void openFileRef.current(file)
    }
    // Picker dismissed: don't carry work into whatever file is opened next.
    const cancel = () => (carryOver.current = null)
    const input = fileInput.current!
    input.addEventListener('cancel', cancel)
    window.addEventListener('keydown', key)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      input.removeEventListener('cancel', cancel)
      window.removeEventListener('keydown', key)
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [])

  // ---- Render ----

  const activeLoop = sec.activeLoop
  const status = activeLoop
    ? `Looping · ${sec.active?.name ?? `${formatTime(activeLoop.start, true)}–${formatTime(activeLoop.end, true)}`}`
    : audio.playing
      ? 'Playing'
      : 'Paused'
  const isVideo = track?.kind === 'video'
  const TrackIcon = track?.source === 'youtube' ? Play : isVideo ? Film : FileAudio

  const transport = (compact?: boolean) => (
    <Transport
      compact={compact}
      playing={audio.playing}
      loopOn={sec.loopOn}
      onTogglePlay={() => void audio.togglePlay()}
      onToggleLoop={() => sec.setLoopOn((v) => !v)}
      onBack={() => audio.seek(time - 2)}
      onPrevSection={() => jump(-1)}
      onNextSection={() => jump(1)}
    />
  )

  return (
    <div className="mx-auto flex min-h-screen max-w-[1480px] flex-col gap-6 p-4 sm:p-6 lg:h-screen lg:p-6">
      <input
        ref={fileInput}
        type="file"
        accept="audio/*,video/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          const carried = carryOver.current
          carryOver.current = null
          if (file) void openFile(file, carried)
          e.target.value = ''
        }}
      />

      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="neu-soft flex size-10 items-center justify-center rounded-xl text-accent">
            <AudioLines className="size-5" />
          </div>
          <span className="text-lg font-bold tracking-tight">musict</span>
        </div>

        {track && (
          <div className="neu-inset hidden max-w-[40%] items-center gap-2 rounded-full py-1.5 pr-1.5 pl-4 text-sm text-muted md:flex">
            <TrackIcon className="size-4 shrink-0" />
            <span className="truncate">{track.name}</span>
            <button
              type="button"
              aria-label="Close and go back to your files"
              title="Close"
              onClick={closeTrack}
              className="flex size-6 shrink-0 items-center justify-center rounded-full text-faint transition-colors hover:bg-white/5 hover:text-ink"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="neu-soft flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:text-accent"
        >
          <Upload className="size-4" />
          <span className="hidden sm:inline">{track ? 'Open another file' : 'Upload audio or video'}</span>
        </button>
      </header>

      <main className="grid flex-1 grid-cols-1 gap-6 lg:min-h-0 lg:grid-cols-[260px_minmax(0,1fr)_300px] xl:grid-cols-[290px_minmax(0,1fr)_340px]">
        <section className="neu-raised flex flex-col rounded-[32px] p-6 sm:p-8 lg:order-2 lg:overflow-y-auto">
          {!track ? (
            <DropZone
              loading={audio.loading}
              error={audio.error ?? notice}
              dragging={dragging}
              recents={recents}
              onBrowse={() => fileInput.current?.click()}
              onYouTube={(link) => void openYouTube(link)}
              onOpenRecent={(r) => void openRecent(r)}
              onRemoveRecent={(id) => void removeRecent(id).then(listRecents).then(setRecents)}
            />
          ) : (
            <>
              {isVideo && (
                <div className="mb-5 flex flex-1 flex-col">
                  <VideoPanel
                    media={track.youtube ? { youtube: track.youtube } : { src: track.url! }}
                    loading={!audio.ready}
                    time={time}
                    playing={audio.playing}
                    speed={speed}
                    mirrored={mirrored}
                    zoom={zoom}
                    onMirroredChange={setMirrored}
                    onZoomChange={setZoom}
                  />
                </div>
              )}

              {audio.ready && !isVideo && (
                <div className="mb-6 flex items-end justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold tracking-[0.18em] text-muted uppercase">{status}</p>
                    <p className="mt-2 font-mono text-4xl font-medium tracking-tight">
                      {formatTime(time, true)}
                      <span className="text-xl text-faint"> / {formatTime(duration)}</span>
                    </p>
                  </div>
                  <PlaybackInfo speed={speed} pitch={pitch} cents={cents} />
                </div>
              )}

              {audio.ready && alignment && (
                <AlignBar
                  from={alignment.from}
                  count={alignment.ids.size + alignment.markers.length}
                  offset={alignment.offset}
                  onShift={shiftImported}
                  onDone={() => setAlignment(null)}
                />
              )}

              {audio.ready && (
                <Waveform
                  key={track.id}
                  peaks={track.peaks}
                  peaksPerSecond={track.peaksPerSecond}
                  duration={duration}
                  time={time}
                  playing={audio.playing}
                  sections={sec.sections}
                  activeId={sec.activeId}
                  loop={sec.loop}
                  loopOn={sec.loopOn}
                  markers={sec.markers}
                  compact={isVideo}
                  onSeek={audio.seek}
                  onLoopChange={sec.changeLoop}
                  onDoubleClickAt={(t) => audio.seek(sec.loopBetweenMarkers(t, duration))}
                  onAddAudio={track.source === 'youtube' ? switchToFile : undefined}
                />
              )}

              {audio.ready &&
                (sec.loop ? (
                  <div className={`mt-4 grid grid-cols-2 gap-4 transition-opacity ${sec.loopOn ? '' : 'opacity-40'}`}>
                    <LoopEdge label="Loop start" value={sec.loop.start} onNudge={(d) => sec.nudge('start', d, duration)} />
                    <LoopEdge label="Loop end" value={sec.loop.end} onNudge={(d) => sec.nudge('end', d, duration)} />
                  </div>
                ) : (
                  <p className="mt-4 flex h-[52px] items-center justify-center rounded-2xl border border-dashed border-line text-sm text-faint">
                    Drag across the waveform to set a loop
                  </p>
                ))}

              {audio.ready &&
                (isVideo ? (
                  <div className="flex items-center justify-between gap-4 pt-5">
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-semibold tracking-[0.15em] text-muted uppercase">{status}</p>
                      <p className="mt-1 font-mono text-lg font-medium whitespace-nowrap">
                        {formatTime(time, true)}
                        <span className="text-xs text-faint"> / {formatTime(duration)}</span>
                      </p>
                    </div>
                    {transport(true)}
                  </div>
                ) : (
                  <div className="mt-auto pt-8">
                    {transport()}
                    <div className="mt-6 flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs text-faint">
                      <Shortcut keys="Space" label="play" />
                      <Shortcut keys="L" label="loop" />
                      <Shortcut keys="M" label="marker" />
                      <Shortcut keys="← →" label="±2s" />
                      <Shortcut keys="[ ]" label="speed" />
                      <Shortcut keys="= -" label="zoom" />
                    </div>
                  </div>
                ))}
            </>
          )}
        </section>

        <div className="lg:order-1 lg:min-h-0">
          <SectionsPanel
            sections={sec.sections}
            activeId={sec.activeId}
            editingId={sec.editingId}
            playing={audio.playing}
            track={track}
            canSaveLoop={!!sec.loop && !sec.active}
            onSelect={selectSection}
            onPlay={(id) => {
              selectSection(id)
              void audio.play()
            }}
            onSaveLoop={sec.saveLoop}
            onStartEdit={sec.setEditingId}
            onRename={sec.rename}
            onDelete={sec.remove}
          />
        </div>

        <div className="lg:order-3 lg:min-h-0">
          <StemMixer
            capabilities={caps}
            backendReady={false}
            stems={stems}
            onStemChange={(id, patch) => setStems((all) => all.map((s) => (s.id === id ? { ...s, ...patch } : s)))}
            stemsOn={stemsOn}
            onStemsOnChange={setStemsOn}
            speed={speed}
            onSpeedChange={setSpeed}
            pitch={pitch}
            onPitchChange={setPitch}
            cents={cents}
            onCentsChange={setCents}
            preservePitch={preservePitch}
            onPreservePitchChange={setPreservePitch}
            onAddAudio={track?.source === 'youtube' ? switchToFile : undefined}
          />
        </div>
      </main>
    </div>
  )
}

function LoopEdge({ label, value, onNudge }: { label: string; value: number; onNudge: (d: number) => void }) {
  return (
    <div className="neu-inset flex items-center justify-between rounded-2xl py-2 pr-2 pl-4">
      <div>
        <div className="text-[11px] text-faint">{label}</div>
        <div className="font-mono text-sm">{formatTime(value, true)}</div>
      </div>
      <div className="flex gap-1.5">
        <button type="button" aria-label={`${label} earlier`} onClick={() => onNudge(-0.1)} className="neu-soft flex size-8 items-center justify-center rounded-full text-muted hover:text-ink">
          <Minus className="size-3.5" />
        </button>
        <button type="button" aria-label={`${label} later`} onClick={() => onNudge(0.1)} className="neu-soft flex size-8 items-center justify-center rounded-full text-muted hover:text-ink">
          <Plus className="size-3.5" />
        </button>
      </div>
    </div>
  )
}

/** Shown after switching from YouTube: shift the imported work until it lines up with the file. */
function AlignBar({ from, count, offset, onShift, onDone }: { from: string; count: number; offset: number; onShift: (d: number) => void; onDone: () => void }) {
  const steps = [-1, -0.1, 0.1, 1]
  return (
    <div className="neu-inset mb-3 flex items-center gap-3 rounded-2xl py-2 pr-2 pl-4 text-xs">
      <p
        className="min-w-0 flex-1 truncate text-muted"
        title={`Brought ${count} ${count === 1 ? 'item' : 'items'} over from “${from}”. If they're early or late here, shift them.`}
      >
        {count} from <span className="text-ink">“{from}”</span> · line up:
      </p>
      <div className="flex items-center gap-1.5">
        {steps.slice(0, 2).map((d) => (
          <AlignButton key={d} delta={d} onShift={onShift} />
        ))}
        <span className="w-14 text-center font-mono text-xs text-ink">
          {offset > 0 ? '+' : ''}
          {offset.toFixed(1)}s
        </span>
        {steps.slice(2).map((d) => (
          <AlignButton key={d} delta={d} onShift={onShift} />
        ))}
        <button type="button" onClick={onDone} className="neu-soft ml-1 rounded-full px-3 py-1 text-xs text-accent">
          Done
        </button>
      </div>
    </div>
  )
}

function AlignButton({ delta, onShift }: { delta: number; onShift: (d: number) => void }) {
  return (
    <button
      type="button"
      aria-label={`Shift ${delta > 0 ? 'later' : 'earlier'} by ${Math.abs(delta)} seconds`}
      onClick={() => onShift(delta)}
      className="neu-soft rounded-full px-2 py-1 font-mono text-[11px] text-muted hover:text-ink"
    >
      {delta > 0 ? '+' : '−'}
      {Math.abs(delta)}
    </button>
  )
}

function PlaybackInfo({ speed, pitch, cents }: { speed: number; pitch: number; cents: number }) {
  const st = pitch + cents / 100
  return (
    <div className="text-right font-mono text-sm whitespace-nowrap text-muted">
      <div>{Math.round(speed * 100)}% speed</div>
      <div>{st === 0 ? 'Original pitch' : `${st > 0 ? '+' : ''}${Number(st.toFixed(2))} st`}</div>
    </div>
  )
}

function Shortcut({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <kbd className="neu-soft rounded-md px-1.5 py-0.5 font-mono text-[10px] text-muted">{keys}</kbd>
      {label}
    </span>
  )
}

export default App
