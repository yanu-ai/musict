// Runs the Demucs model on a background thread so the page stays responsive.
// Deliberately simple: the page decides which 7.8 s chunk to separate next and
// sends it; this worker runs the model on it and sends the six stems back.
// One worker per separation job, so its memory is released when the job ends.

import * as ort from 'onnxruntime-web'
// The engine's small loader script must come from our own site: ONNX Runtime starts its
// helper threads from it, and inside a bundled worker it would otherwise pick the wrong file.
import mjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs?url'
import { SEGMENT } from './chunks'

// The engine binary (29.5 MB) is over Cloudflare's 25 MiB file limit, so it comes from
// jsDelivr's copy of the same npm package version.
ort.env.wasm.wasmPaths = {
  mjs: mjsUrl,
  wasm: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ort.env.versions.web}/dist/ort-wasm-simd-threaded.jsep.wasm`,
}

/** Page → worker. */
export type WorkerRequest =
  | { type: 'init'; modelUrl: string; modelCache: string; threads: number }
  /** One chunk, exactly SEGMENT samples per channel (zero-padded at the end of the song). */
  | { type: 'chunk'; index: number; left: Float32Array<ArrayBuffer>; right: Float32Array<ArrayBuffer> }

/** Worker → page. */
export type WorkerMessage =
  | { type: 'download'; fraction: number }
  | { type: 'ready'; threads: number }
  /** Stems for one chunk, laid out [stem][channel][sample] in STEM_ORDER, SEGMENT samples each. */
  | { type: 'result'; index: number; stems: Float32Array<ArrayBuffer> }
  | { type: 'error'; message: string }

// The project's TypeScript setup describes the page, not workers, so type `self` as a Worker.
const scope = self as unknown as Worker
const post = (message: WorkerMessage, transfer: Transferable[] = []) => scope.postMessage(message, transfer)

let session: ort.InferenceSession | null = null

/** The model from Cache Storage, or downloaded (with progress) and cached for next time. */
async function loadModelBytes(url: string, cacheName: string): Promise<ArrayBuffer> {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(url)
  if (cached) return cached.arrayBuffer()

  const response = await fetch(url)
  if (!response.ok || !response.body) throw new Error(`Model download failed (HTTP ${response.status})`)
  const total = Number(response.headers.get('Content-Length')) || 0
  const reader = response.body.getReader()
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    if (total) post({ type: 'download', fraction: received / total })
  }
  const blob = new Blob(chunks)
  await cache.put(url, new Response(blob))
  // Drop older models (e.g. a previous version) so they don't keep using disk space.
  for (const request of await cache.keys()) if (request.url !== url) await cache.delete(request)
  return blob.arrayBuffer()
}

async function init(modelUrl: string, modelCache: string, threads: number) {
  ort.env.wasm.numThreads = threads // ONNX Runtime falls back to 1 if the page isn't cross-origin isolated
  const model = await loadModelBytes(modelUrl, modelCache)
  session = await ort.InferenceSession.create(model, {
    executionProviders: ['wasm'],
    // ONNX Runtime's graph optimizer runs out of memory on this model (std::bad_alloc);
    // unoptimized it loads in ~10 s and runs a 7.8 s chunk in ~4.4 s on 4 threads.
    graphOptimizationLevel: 'disabled',
    enableCpuMemArena: false, // give memory back between chunks instead of keeping a pool
  })
  post({ type: 'ready', threads: ort.env.wasm.numThreads ?? 1 })
}

async function separateChunk(index: number, left: Float32Array<ArrayBuffer>, right: Float32Array<ArrayBuffer>) {
  if (!session) throw new Error('Model not loaded')
  const mix = new Float32Array(2 * SEGMENT)
  mix.set(left, 0)
  mix.set(right, SEGMENT)
  const output = await session.run({ mix: new ort.Tensor('float32', mix, [1, 2, SEGMENT]) })
  const stems = output.stems.data as Float32Array<ArrayBuffer> // [1, 6, 2, SEGMENT]
  post({ type: 'result', index, stems }, [stems.buffer]) // moved to the page, not copied
}

scope.onmessage = async ({ data }: MessageEvent<WorkerRequest>) => {
  try {
    if (data.type === 'init') await init(data.modelUrl, data.modelCache, data.threads)
    else await separateChunk(data.index, data.left, data.right)
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}
