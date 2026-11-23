import { UserError, type Range } from '../lib/types'
import type { WorkerMessage, WorkerRequest } from './browser.worker'
import {
  addRange,
  chunkCount,
  chunkStart,
  chunkWindow,
  contains,
  newlyReady,
  nextChunk,
  SAMPLE_RATE,
  SEGMENT,
  STEM_ORDER,
  type SampleRange,
} from './chunks'
import type { SeparateOptions, SeparationJob, Separator, StemName, Stems, StereoAudio } from './separator'

// HT-Demucs 6-stem, exported to ONNX by StemSplit (MIT). fp16-stored weights: half the download,
// same quality (it computes in fp32). TODO: host our own copy with a versioned filename (CLAUDE.md).
const MODEL_URL = 'https://huggingface.co/StemSplitio/htdemucs-6s-onnx/resolve/main/htdemucs_6s_fp16weights.onnx'
const MODEL_BYTES = 136_428_532
const MODEL_CACHE = 'musict-models'
/** Separation needs roughly 1–2 GB on top of playback; beyond this, 8 GB machines struggle. */
const MAX_SEPARATION_MINUTES = 10

/**
 * Separates in this browser with HT-Demucs (6 stems) on ONNX Runtime, in a Web Worker.
 * Fast (several threads) only when the page is cross-origin isolated (file mode).
 */
export class BrowserSeparator implements Separator {
  readonly stems: StemName[] = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other']
  readonly maxDuration = MAX_SEPARATION_MINUTES * 60

  get label() {
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

  separate(audio: StereoAudio, options: SeparateOptions = {}): SeparationJob {
    const job = new Job(audio, options, this.maxDuration)
    return { result: job.run(), prioritize: (range) => job.prioritize(range) }
  }
}

/** One separation: sends chunks to a worker in priority order and stitches the results. */
class Job {
  private priority: SampleRange | null = null
  private partialSent = false
  private ready: SampleRange[] = []
  private stems: Stems = {}
  private check = () => {}
  private readonly audio: StereoAudio
  private readonly options: SeparateOptions
  private readonly maxDuration: number

  constructor(audio: StereoAudio, options: SeparateOptions, maxDuration: number) {
    this.audio = audio
    this.options = options
    this.maxDuration = maxDuration
    this.prioritize(options.priority ?? null)
  }

  prioritize(range: Range | null) {
    this.priority = range && [Math.floor(range.start * SAMPLE_RATE), Math.ceil(range.end * SAMPLE_RATE)]
    this.partialSent = false
    this.check()
  }

  async run(): Promise<Stems> {
    const { signal, onProgress, onPartial, background } = this.options
    const duration = this.audio.left.length / this.audio.sampleRate
    if (duration > this.maxDuration) {
      throw new UserError(`Stems work on songs up to ${this.maxDuration / 60} minutes for now; this one is ${Math.round(duration / 60)}.`)
    }
    signal?.throwIfAborted()
    const mix = await to44k(this.audio) // only read from, never transferred
    signal?.throwIfAborted()

    const total = mix.left.length
    const count = chunkCount(total)
    // Six stereo stems, filled in chunk by chunk.
    const out = STEM_ORDER.map(() => [new Float32Array(total), new Float32Array(total)])
    STEM_ORDER.forEach((name, s) => (this.stems[name] = { left: out[s][0], right: out[s][1], sampleRate: SAMPLE_RATE }))

    // Whenever the priority range is fully separated, hand over what we have.
    this.check = () => {
      if (onPartial && this.priority && !this.partialSent && contains(this.ready, this.priority)) {
        this.partialSent = true
        onPartial({ stems: this.stems, ready: this.ready.map(([a, b]) => ({ start: a / SAMPLE_RATE, end: b / SAMPLE_RATE })) })
      }
    }

    const worker = new Worker(new URL('./browser.worker.ts', import.meta.url), { type: 'module' })
    try {
      // Every request gets exactly one answer (or an error); this turns that into a promise.
      const ask = (request: WorkerRequest, transfer: Transferable[] = []) =>
        new Promise<WorkerMessage>((resolve, reject) => {
          const abort = () => reject(signal!.reason)
          signal?.addEventListener('abort', abort, { once: true })
          worker.onerror = (e) => reject(new Error(e.message || 'The separation worker failed to start.'))
          worker.onmessage = ({ data }: MessageEvent<WorkerMessage>) => {
            if (data.type === 'download') {
              // Once downloaded, the model still takes a few seconds to load: show that as "prepare".
              return onProgress?.(data.fraction >= 1 ? { phase: 'prepare', fraction: 0 } : { phase: 'download', fraction: data.fraction })
            }
            signal?.removeEventListener('abort', abort)
            if (data.type === 'error') reject(new Error(data.message))
            else resolve(data)
          }
          worker.postMessage(request, transfer)
        })

      onProgress?.({ phase: 'prepare', fraction: 0 })
      await ask({ type: 'init', modelUrl: MODEL_URL, modelCache: MODEL_CACHE, threads: background ? 2 : 4 })

      const done = new Array<boolean>(count).fill(false)
      const remaining = new Set(done.map((_, i) => i))
      onProgress?.({ phase: 'separate', fraction: 0 })
      for (let i = nextChunk(remaining, total, this.priority); i !== undefined; i = nextChunk(remaining, total, this.priority)) {
        const start = chunkStart(i)
        const end = Math.min(start + SEGMENT, total)
        // Fresh, zero-padded copies, so they can be transferred.
        const left = new Float32Array(SEGMENT)
        const right = new Float32Array(SEGMENT)
        left.set(mix.left.subarray(start, end))
        right.set(mix.right.subarray(start, end))
        const reply = await ask({ type: 'chunk', index: i, left, right }, [left.buffer, right.buffer])
        if (reply.type !== 'result') throw new Error('Unexpected reply from the separation worker')

        // Add this chunk's stems, faded at the overlaps, into the full-length tracks.
        const w = chunkWindow(i, count)
        const length = end - start
        for (let s = 0; s < STEM_ORDER.length; s++) {
          for (let c = 0; c < 2; c++) {
            const src = reply.stems.subarray((s * 2 + c) * SEGMENT, (s * 2 + c) * SEGMENT + length)
            const dst = out[s][c]
            for (let k = 0; k < length; k++) dst[start + k] += src[k] * w[k]
          }
        }

        done[i] = true
        remaining.delete(i)
        for (const range of newlyReady(i, done, total)) this.ready = addRange(this.ready, range)
        onProgress?.({ phase: 'separate', fraction: (count - remaining.size) / count })
        this.check()
      }
      return this.stems
    } finally {
      worker.terminate() // also frees the worker's memory
      this.check = () => {}
    }
  }
}

/**
 * The model needs 44.1 kHz. Resampling happens here because OfflineAudioContext
 * doesn't exist inside workers. Audio that's already 44.1 kHz is used as is (read only).
 */
async function to44k(audio: StereoAudio): Promise<{ left: Float32Array; right: Float32Array }> {
  const { left, right, sampleRate } = audio
  if (sampleRate === SAMPLE_RATE) return { left, right }
  const ctx = new OfflineAudioContext(2, Math.ceil((left.length * SAMPLE_RATE) / sampleRate), SAMPLE_RATE)
  const buffer = ctx.createBuffer(2, left.length, sampleRate)
  buffer.copyToChannel(new Float32Array(left), 0)
  buffer.copyToChannel(new Float32Array(right), 1)
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.connect(ctx.destination)
  source.start()
  const rendered = await ctx.startRendering()
  return { left: rendered.getChannelData(0), right: rendered.getChannelData(1) }
}
