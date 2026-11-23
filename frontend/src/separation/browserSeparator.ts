import type { SeparateOptions, Separator, StemName, Stems, StereoAudio } from './separator'
import type { WorkerMessage, WorkerRequest } from './browser.worker'

// 4-stem HTDemucs exported to ONNX by the demucs-web project.
// TODO: host our own copy with a versioned filename (CLAUDE.md rule).
const MODEL_URL = 'https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx'
const MODEL_BYTES = 180_534_758
const MODEL_CACHE = 'musict-models'
const SAMPLE_RATE = 44_100

/**
 * Separates in this browser with Demucs on ONNX Runtime, in a Web Worker.
 * Fast (several threads) only when the page is cross-origin isolated (file mode).
 */
export class BrowserSeparator implements Separator {
  readonly stems: StemName[] = ['vocals', 'drums', 'bass', 'other']
  private readonly backend: 'wasm' | 'webgpu'

  /** CPU (wasm) by default: in testing WebGPU was slower on an 8 GB Mac. */
  constructor(options: { backend?: 'wasm' | 'webgpu' } = {}) {
    this.backend = options.backend ?? 'wasm'
  }

  get label() {
    if (this.backend === 'webgpu') return 'This browser · GPU'
    return `This browser · CPU, ${crossOriginIsolated ? 'multi-threaded' : 'single thread (slow)'}`
  }

  async downloadSize() {
    try {
      const cached = await (await caches.open(MODEL_CACHE)).match(MODEL_URL)
      return cached ? 0 : MODEL_BYTES
    } catch {
      return MODEL_BYTES
    }
  }

  async separate(audio: StereoAudio, { onProgress, signal }: SeparateOptions = {}): Promise<Stems> {
    signal?.throwIfAborted()
    const { left, right } = await to44k(audio)
    signal?.throwIfAborted()

    const worker = new Worker(new URL('./browser.worker.ts', import.meta.url), { type: 'module' })
    return new Promise<Stems>((resolve, reject) => {
      const finish = () => {
        worker.terminate() // also frees the worker's memory
        signal?.removeEventListener('abort', abort)
      }
      const abort = () => {
        finish()
        reject(signal!.reason)
      }
      signal?.addEventListener('abort', abort, { once: true })

      worker.onmessage = ({ data }: MessageEvent<WorkerMessage>) => {
        if (data.type === 'progress') onProgress?.({ phase: data.phase, fraction: data.fraction })
        else if (data.type === 'error') {
          finish()
          reject(new Error(data.message))
        } else {
          finish()
          const stems: Stems = {}
          for (const [name, track] of Object.entries(data.stems)) stems[name as StemName] = { ...track, sampleRate: SAMPLE_RATE }
          resolve(stems)
        }
      }
      worker.onerror = (event) => {
        finish()
        reject(new Error(event.message || 'The separation worker failed to start.'))
      }

      const request: WorkerRequest = { left, right, modelUrl: MODEL_URL, modelCache: MODEL_CACHE, backend: this.backend }
      worker.postMessage(request, [left.buffer, right.buffer]) // moved to the worker, not copied
    })
  }
}

/**
 * Demucs needs 44.1 kHz. Resampling happens here because OfflineAudioContext
 * doesn't exist inside workers. Always returns fresh arrays, so they can be
 * transferred without detaching the caller's audio.
 */
async function to44k({ left, right, sampleRate }: StereoAudio) {
  if (sampleRate === SAMPLE_RATE) return { left: new Float32Array(left), right: new Float32Array(right) }
  const ctx = new OfflineAudioContext(2, Math.ceil((left.length * SAMPLE_RATE) / sampleRate), SAMPLE_RATE)
  const buffer = ctx.createBuffer(2, left.length, sampleRate)
  buffer.copyToChannel(new Float32Array(left), 0)
  buffer.copyToChannel(new Float32Array(right), 1)
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.connect(ctx.destination)
  source.start()
  const out = await ctx.startRendering()
  return { left: out.getChannelData(0), right: out.getChannelData(1) }
}
