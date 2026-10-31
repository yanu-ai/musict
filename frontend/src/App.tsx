import { AudioLines, FileAudio, Film, Minus, Play, Plus, Upload, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { usePlayer } from './audio/usePlayer'
import { DropZone } from './components/DropZone'
import { SectionsPanel } from './components/SectionsPanel'
import { StemMixer } from './components/StemMixer'
import { Transport } from './components/Transport'
import { VideoPanel } from './components/VideoPanel'
import { Waveform } from './components/Waveform'
import { useSections } from './hooks/useSections'
import { addRecent, listRecents, loadProject, loadRecentFile, removeRecent, requestPersistentStorage, saveProject, type Recent } from './lib/storage'
import type { Stem, Track } from './lib/types'
import { formatTime, initialStems } from './lib/types'

const round2 = (v: number) => Math.round(v * 100) / 100

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
    sec.restore(null)
  }

  const afterLoad = async (loaded: Track | null, file?: File) => {
    if (!loaded) return
    const saved = await loadProject(loaded.id)
    sec.restore(saved ?? null)
    setSpeed(saved?.speed ?? 1)
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

  const openFile = async (file: File) => {
    resetWork()
    await afterLoad(await audio.loadFile(file), file)
  }

  const openYouTube = async (link: string) => {
    resetWork()
    await afterLoad(await audio.loadYouTube(link))
  }

  const openRecent = async (recent: Recent) => {
    if (recent.source === 'youtube' && recent.videoId) return openYouTube(recent.videoId)
    const file = await loadRecentFile(recent.id)
    if (file) return openFile(file)
    setNotice(`“${recent.name}” is too large to keep for quick reopening. Choose the file again.`)
  }

  const closeTrack = () => {
    audio.close()
    resetWork()
  }

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
    window.addEventListener('keydown', key)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
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
          if (file) void openFile(file)
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
