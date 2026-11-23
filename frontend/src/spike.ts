// Throwaway test page for the separator (build plan step 1). It checks that:
//   1. BrowserSeparator works end to end (model download, worker, four stems back).
//   2. The page stays responsive while it separates (the work is in a Web Worker).
//   3. Cancel stops it.
// Delete this file and spike.html once separation is wired into the app.

import { BrowserSeparator } from './separation/browserSeparator'
import type { StereoAudio } from './separation/separator'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const fileInput = $<HTMLInputElement>('file')
const startInput = $<HTMLInputElement>('start')
const lengthInput = $<HTMLInputElement>('length')
const backendSelect = $<HTMLSelectElement>('backend')
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
  backendSelect.value = 'wasm'
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

async function run(given?: File) {
  const file = given ?? fileInput.files?.[0]
  if (!file) return
  const separator = new BrowserSeparator({ backend: backendSelect.value as 'wasm' | 'webgpu' })
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
    const stems = await separator.separate(clip, {
      signal: controller.signal,
      onProgress: ({ phase, fraction }) => {
        const report = `${phase} ${Math.floor(fraction * 10) * 10}%`
        if (report !== lastReport) log((lastReport = report))
      },
    })
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

// For automated runs: spike.html?audio=<url>&backend=wasm&start=30&length=30[&cancelAfter=5]
// The model must already be cached, since automation can't answer the download prompt.
const params = new URLSearchParams(location.search)
describeEnvironment().then(async () => {
  for (const key of ['backend', 'start', 'length']) {
    const value = params.get(key)
    if (value) $<HTMLInputElement>(key).value = value
  }
  const audio = params.get('audio')
  if (!audio) return
  const cancelAfter = Number(params.get('cancelAfter'))
  if (cancelAfter) setTimeout(() => controller?.abort(), cancelAfter * 1000)
  const response = await fetch(audio)
  await run(new File([await response.blob()], audio.split('/').pop() ?? 'audio'))
  log('AUTORUN FINISHED')
})
