// Throwaway test page for the separator (build plan step 1). It checks that:
//   1. BrowserSeparator works end to end (model download, worker, four stems back).
//   2. The page stays responsive while it separates (the work is in a Web Worker).
//   3. Cancel stops it.
// Delete this file and spike.html once separation is wired into the app.

import { AudioEngine } from './audio/engine'
import { PLAYBACK_STEMS, stemGains } from './audio/stems'
import { initialStems, type Stem } from './lib/types'
import { BrowserSeparator } from './separation/browserSeparator'
import type { StereoAudio } from './separation/separator'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const fileInput = $<HTMLInputElement>('file')
const startInput = $<HTMLInputElement>('start')
const lengthInput = $<HTMLInputElement>('length')
const runButton = $<HTMLButtonElement>('run')
const cancelButton = $<HTMLButtonElement>('cancel')
const fpsEl = $<HTMLSpanElement>('fps')
const logEl = $<HTMLPreElement>('log')
const stemsEl = $<HTMLDivElement>('stems')

const pageStart = performance.now()
function log(message: string) {
  const line = `[${((performance.now() - pageStart) / 1000).toFixed(1)}s] ${message}`
  logEl.textContent += line + '\n'
  console.log(line)
}

// Responsiveness: the longest gap between drawn frames. A frozen page shows a big gap.
let lastFrame = performance.now()
let longestGap = 0
function measureFrames(now: number) {
  longestGap = Math.max(longestGap, now - lastFrame)
  lastFrame = now
  fpsEl.textContent = `longest frame gap ${Math.round(longestGap)} ms`
  requestAnimationFrame(measureFrames)
}
requestAnimationFrame(measureFrames)

async function describeEnvironment() {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
  const adapter = gpu ? await gpu.requestAdapter().catch(() => null) : null
  log(`Browser: ${navigator.userAgent}`)
  log(`Cross-origin isolated: ${crossOriginIsolated}`)
  log(`WebGPU: ${adapter ? 'available' : 'not available'}`)
}

/** Decodes the file and cuts out the clip at the file's own sample rate (the separator resamples). */
async function decodeClip(file: File, startSeconds: number, lengthSeconds: number): Promise<StereoAudio> {
  const ctx = new AudioContext()
  const buffer = await ctx.decodeAudioData(await file.arrayBuffer())
  void ctx.close()
  const rate = buffer.sampleRate
  const from = Math.min(Math.floor(startSeconds * rate), buffer.length)
  const to = Math.min(from + Math.floor(lengthSeconds * rate), buffer.length)
  const left = buffer.getChannelData(0).slice(from, to)
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1).slice(from, to) : left.slice()
  log(`Audio: ${buffer.duration.toFixed(1)}s song at ${rate} Hz, clip is ${(left.length / rate).toFixed(1)}s`)
  return { left, right, sampleRate: rate }
}

/** 16-bit WAV, so each stem can be played in an <audio> element. */
function toWav({ left, right, sampleRate }: StereoAudio): Blob {
  const frames = left.length
  const view = new DataView(new ArrayBuffer(44 + frames * 4))
  const text = (offset: number, s: string) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)))
  text(0, 'RIFF')
  view.setUint32(4, 36 + frames * 4, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 2, true) // stereo
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 4, true)
  view.setUint16(32, 4, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, frames * 4, true)
  for (let i = 0; i < frames; i++) {
    view.setInt16(44 + i * 4, Math.max(-1, Math.min(1, left[i])) * 0x7fff, true)
    view.setInt16(46 + i * 4, Math.max(-1, Math.min(1, right[i])) * 0x7fff, true)
  }
  return new Blob([view], { type: 'audio/wav' })
}

function showStem(name: string, audio: StereoAudio) {
  const row = document.createElement('div')
  row.className = 'stem'
  const label = document.createElement('span')
  label.textContent = name
  const player = document.createElement('audio')
  player.controls = true
  player.src = URL.createObjectURL(toWav(audio))
  row.append(label, player)
  stemsEl.append(row)
}

let controller: AbortController | null = null
const params = new URLSearchParams(location.search)

async function run(given?: File) {
  const file = given ?? fileInput.files?.[0]
  if (!file) return
  const separator = new BrowserSeparator()
  // Optional: ?priority=10-18 (seconds within the clip) and ?background=1 (2 threads).
  const [pStart, pEnd] = (params.get('priority') ?? '').split('-').map(Number)
  const priority = Number.isFinite(pStart) && pEnd > pStart ? { start: pStart, end: pEnd } : null
  const background = params.get('background') === '1'
  runButton.disabled = true
  cancelButton.disabled = false
  stemsEl.replaceChildren()
  controller = new AbortController()
  try {
    log(`--- Run: ${file.name} · ${separator.label} ---`)
    const clip = await decodeClip(file, Number(startInput.value), Number(lengthInput.value))

    const bytes = await separator.downloadSize()
    if (bytes > 0 && !confirm(`Download the separation model (${Math.round(bytes / 1e6)} MB)? It's saved in the browser after the first time.`)) {
      throw new Error('Model download declined')
    }

    longestGap = 0
    const started = performance.now()
    let lastReport = ''
    log(`Priority: ${priority ? `${priority.start}-${priority.end}s` : 'none'} · ${background ? 'background (2 threads)' : 'foreground (4 threads)'}`)
    const job = separator.separate(clip, {
      signal: controller.signal,
      priority,
      background,
      onProgress: ({ phase, fraction }) => {
        const report = `${phase} ${Math.floor(fraction * 10) * 10}%`
        if (report !== lastReport) log((lastReport = report))
      },
      onPartial: ({ ready }) =>
        log(`PRIORITY READY after ${((performance.now() - started) / 1000).toFixed(1)}s · ready: ${ready.map((r) => `${r.start.toFixed(1)}-${r.end.toFixed(1)}s`).join(', ')}`),
    })
    const stems = await job.result
    const seconds = (performance.now() - started) / 1000
    const clipSeconds = clip.left.length / clip.sampleRate
    log(`DONE: ${clipSeconds.toFixed(1)}s separated in ${seconds.toFixed(1)}s (${(clipSeconds / seconds).toFixed(2)}x real time)`)
    log(`Longest frame gap while separating: ${Math.round(longestGap)} ms`)
    log(`Original still intact: ${clip.left.length > 0}`)

    showStem('original', clip)
    for (const [name, audio] of Object.entries(stems)) showStem(name, audio)
  } catch (error) {
    const name = error instanceof DOMException && error.name === 'AbortError' ? 'CANCELLED' : 'ERROR'
    log(`${name}: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    controller = null
    cancelButton.disabled = true
    runButton.disabled = !fileInput.files?.length
  }
}

fileInput.addEventListener('change', () => (runButton.disabled = !fileInput.files?.length))
runButton.addEventListener('click', () => run())
cancelButton.addEventListener('click', () => controller?.abort())

// For automated runs: spike.html?audio=<url>&start=30&length=30[&priority=10-18][&background=1][&cancelAfter=5]
// The model must already be cached, since automation can't answer the download prompt.
/**
 * Engine mode (?engine=1): the real flow. Load the whole song into the AudioEngine,
 * separate it with the loop (start..start+length) first, play the stems as soon as the
 * loop is ready, then stop separating (to save time while testing).
 */
async function engineTest(file: File) {
  const start = Number(startInput.value)
  const loop = { start, end: start + Number(lengthInput.value) }
  const engine = new AudioEngine()
  const section = $<HTMLElement>('engine-test')
  section.hidden = false
  let mixer: Stem[] = initialStems.map((s) => ({ ...s, shown: s.id !== 'rest' })) // every stem gets its own mute
  const stemsOn = $<HTMLInputElement>('stems-on')
  const applyGains = () => engine.setStemGains(stemGains(mixer, stemsOn.checked))
  $<HTMLDivElement>('mutes').replaceChildren(
    ...PLAYBACK_STEMS.map((name) => {
      const label = document.createElement('label')
      const box = document.createElement('input')
      box.type = 'checkbox'
      box.onchange = () => {
        mixer = mixer.map((s) => (s.id === name ? { ...s, muted: box.checked } : s))
        applyGains()
      }
      label.append(box, ` mute ${name}`)
      return label
    }),
  )
  stemsOn.onchange = applyGains
  $<HTMLSelectElement>('speed').onchange = (e) => engine.setRate(Number((e.target as HTMLSelectElement).value))
  $<HTMLSelectElement>('pitch').onchange = (e) => engine.setPitch(Number((e.target as HTMLSelectElement).value))
  let playing = false
  $<HTMLButtonElement>('play').onclick = () => {
    playing = !playing
    if (playing) void engine.play()
    else engine.pause()
  }
  setInterval(() => ($<HTMLParagraphElement>('clock').textContent = `${engine.currentTime.toFixed(1)} s · stems: ${engine.hasStems}`), 250)
  Object.assign(window, { engine }) // for poking at it from the console

  log(`Engine: loading ${file.name}`)
  await engine.load(file)
  engine.setRate(0.75)
  engine.setLoop(loop)
  engine.seek(loop.start)
  const audio = engine.audio!
  log(`Engine: loaded ${engine.duration.toFixed(1)}s at ${audio.sampleRate} Hz; separating with ${loop.start}-${loop.end}s first`)

  const started = performance.now()
  controller = new AbortController()
  const job = new BrowserSeparator().separate(audio, {
    priority: loop,
    signal: controller.signal,
    onProgress: ({ phase, fraction }) => phase !== 'download' && fraction % 0.1 < 0.02 && log(`${phase} ${Math.round(fraction * 100)}%`),
    onPartial: async ({ stems, ready }) => {
      log(`LOOP READY after ${((performance.now() - started) / 1000).toFixed(1)}s · ready ${ready.map((r) => `${r.start.toFixed(1)}-${r.end.toFixed(1)}s`).join(', ')}`)
      const t = performance.now()
      await engine.setStems(stems, ready)
      applyGains()
      log(`Stems loaded into the engine in ${Math.round(performance.now() - t)} ms; press Play`)
      controller?.abort() // testing only: skip the rest of the song
    },
  })
  await job.result.catch((e) => log(`Separation stopped: ${e instanceof Error ? e.message : e}`))
}

describeEnvironment().then(async () => {
  for (const key of ['start', 'length']) {
    const value = params.get(key)
    if (value) $<HTMLInputElement>(key).value = value
  }
  const audio = params.get('audio')
  if (!audio) return
  const cancelAfter = Number(params.get('cancelAfter'))
  if (cancelAfter) setTimeout(() => controller?.abort(), cancelAfter * 1000)
  const response = await fetch(audio)
  const file = new File([await response.blob()], audio.split('/').pop() ?? 'audio')
  if (params.get('engine') === '1') return engineTest(file)
  await run(file)
  log('AUTORUN FINISHED')
})
