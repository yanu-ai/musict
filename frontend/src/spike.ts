// Throwaway experiment for build plan step 1. Questions it answers:
//   1. Does demucs-web run on this machine, with and without COOP/COEP headers?
//   2. How long does a clip take on WebGPU (GPU) vs WebAssembly (CPU)?
//   3. How much memory does it need?
// Delete this file and spike.html once the numbers are written down.

import { CONSTANTS, DemucsProcessor } from 'demucs-web'
import * as ort from 'onnxruntime-web'
// Vite gives us a served URL for the engine's .wasm file, so ONNX Runtime can find it.
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url'

ort.env.wasm.wasmPaths = { wasm: wasmUrl }

type StereoTrack = { left: Float32Array; right: Float32Array }

const SAMPLE_RATE: number = CONSTANTS.SAMPLE_RATE // Demucs expects 44.1 kHz stereo
const MODEL_URL: string = CONSTANTS.DEFAULT_MODEL_URL

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const fileInput = $<HTMLInputElement>('file')
const startInput = $<HTMLInputElement>('start')
const lengthInput = $<HTMLInputElement>('length')
const backendSelect = $<HTMLSelectElement>('backend')
const runButton = $<HTMLButtonElement>('run')
const logEl = $<HTMLPreElement>('log')
const stemsEl = $<HTMLDivElement>('stems')

const pageStart = performance.now()
function log(message: string) {
  const line = `[${((performance.now() - pageStart) / 1000).toFixed(1)}s] ${message}`
  logEl.textContent += line + '\n'
  console.log(line)
}
/** Gives the browser a moment to repaint the log before heavy work blocks the page. */
const breathe = () => new Promise((resolve) => setTimeout(resolve, 0))

/** JS heap size; Chrome only. Watch Activity Monitor for the full picture. */
function memory(): string {
  const m = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
  return m ? `${Math.round(m.usedJSHeapSize / 1e6)} MB JS heap` : 'n/a in this browser'
}

async function describeEnvironment() {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
  const adapter = gpu ? await gpu.requestAdapter().catch(() => null) : null
  log(`Browser: ${navigator.userAgent}`)
  log(`Cross-origin isolated (COOP/COEP headers on): ${crossOriginIsolated}`)
  log(`WebGPU: ${adapter ? 'available' : 'not available'}`)
  log(`CPU cores: ${navigator.hardwareConcurrency}`)
  if (!adapter) backendSelect.value = 'wasm'
}

/** The model is 172 MB, so keep it in the browser's Cache Storage after the first download. */
async function loadModelBytes(): Promise<ArrayBuffer> {
  const cache = await caches.open('musict-spike-model')
  const cached = await cache.match(MODEL_URL)
  if (cached) {
    log('Model: found in browser cache')
    return cached.arrayBuffer()
  }
  if (!confirm('Download the Demucs model (about 172 MB) from Hugging Face? It is saved in the browser after the first time.')) {
    throw new Error('Model download cancelled')
  }
  log('Model: downloading from Hugging Face…')
  const response = await fetch(MODEL_URL)
  if (!response.ok || !response.body) throw new Error(`Model download failed: HTTP ${response.status}`)
  const total = Number(response.headers.get('Content-Length')) || 0
  const reader = response.body.getReader()
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let received = 0
  let nextReport = 0.1
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    if (total && received / total >= nextReport) {
      log(`Model: ${Math.round((received / total) * 100)}% of ${Math.round(total / 1e6)} MB`)
      nextReport += 0.1
    }
  }
  const blob = new Blob(chunks)
  await cache.put(MODEL_URL, new Response(blob))
  log(`Model: downloaded ${Math.round(received / 1e6)} MB and cached`)
  return blob.arrayBuffer()
}

/** Decodes the file at 44.1 kHz and cuts out the clip, as left/right channels. */
async function decodeClip(file: File, startSeconds: number, lengthSeconds: number) {
  const decoder = new OfflineAudioContext(2, 1, SAMPLE_RATE) // decodeAudioData resamples to this rate
  const buffer = await decoder.decodeAudioData(await file.arrayBuffer())
  const from = Math.min(Math.floor(startSeconds * SAMPLE_RATE), buffer.length)
  const to = Math.min(from + Math.floor(lengthSeconds * SAMPLE_RATE), buffer.length)
  const left = buffer.getChannelData(0).slice(from, to)
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1).slice(from, to) : left.slice()
  log(`Audio: ${buffer.numberOfChannels} channel(s), song is ${buffer.duration.toFixed(1)}s, clip is ${(left.length / SAMPLE_RATE).toFixed(1)}s`)
  return { left, right }
}

/** 16-bit WAV, so each stem can be played in an <audio> element. */
function toWav({ left, right }: StereoTrack): Blob {
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
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * 4, true)
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

function showStem(name: string, track: StereoTrack) {
  const row = document.createElement('div')
  row.className = 'stem'
  const label = document.createElement('span')
  label.textContent = name
  const audio = document.createElement('audio')
  audio.controls = true
  audio.src = URL.createObjectURL(toWav(track))
  row.append(label, audio)
  stemsEl.append(row)
}

async function run(given?: File) {
  const file = given ?? fileInput.files?.[0]
  if (!file) return
  const backend = backendSelect.value
  runButton.disabled = true
  stemsEl.replaceChildren()
  try {
    log(`--- Run: ${file.name}, backend ${backend} ---`)
    log(`Memory before: ${memory()}`)
    const clip = await decodeClip(file, Number(startInput.value), Number(lengthInput.value))
    const clipSeconds = clip.left.length / SAMPLE_RATE

    const modelBytes = await loadModelBytes()
    await breathe()
    let started = performance.now()
    const processor = new DemucsProcessor({
      ort,
      // Only the chosen backend, so a failure shows up instead of silently falling back to the CPU.
      sessionOptions: { executionProviders: [backend] },
      onProgress: ({ currentSegment, totalSegments }: { currentSegment: number; totalSegments: number }) =>
        log(`Separating: segment ${currentSegment} of ${totalSegments}`),
    })
    await processor.loadModel(modelBytes)
    log(`Model ready on ${backend} in ${((performance.now() - started) / 1000).toFixed(1)}s, CPU threads: ${ort.env.wasm.numThreads}`)
    log(`Memory after model load: ${memory()}`)
    await breathe()

    started = performance.now()
    const stems: Record<string, StereoTrack> = await processor.separate(clip.left, clip.right)
    const seconds = (performance.now() - started) / 1000
    log(`DONE: ${clipSeconds.toFixed(1)}s of audio separated in ${seconds.toFixed(1)}s (${(clipSeconds / seconds).toFixed(2)}x real time)`)
    log(`Memory after separation: ${memory()}`)

    showStem('original', clip)
    for (const [name, track] of Object.entries(stems)) showStem(name, track)
  } catch (error) {
    log(`ERROR: ${error instanceof Error ? error.message : String(error)}`)
    console.error(error)
  } finally {
    runButton.disabled = !fileInput.files?.length
  }
}

fileInput.addEventListener('change', () => (runButton.disabled = !fileInput.files?.length))
runButton.addEventListener('click', () => run())

// For automated runs: spike.html?audio=<url>&backend=wasm&start=30&length=30 fetches the song and starts.
// The model must already be cached, since automation can't answer the download prompt.
const params = new URLSearchParams(location.search)
describeEnvironment().then(async () => {
  for (const key of ['backend', 'start', 'length']) {
    const value = params.get(key)
    if (value) $<HTMLInputElement>(key).value = value
  }
  const audio = params.get('audio')
  if (!audio) return
  const response = await fetch(audio)
  await run(new File([await response.blob()], audio.split('/').pop() ?? 'audio'))
  log('AUTORUN FINISHED')
})
