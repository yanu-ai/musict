// Runs Demucs on a background thread so the page stays responsive while it works.
// Started and stopped by BrowserSeparator; one worker per separation, so its
// memory (1–2 GB) is released as soon as the job ends.

import { DemucsProcessor } from 'demucs-web'
import * as ort from 'onnxruntime-web'
// Vite serves the engine's files and gives us their URLs, so ONNX Runtime can find them.
// The .mjs matters inside a worker: ONNX Runtime starts its helper threads from that script,
// and without an explicit URL it would start them from this (bundled) worker file instead.
import mjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs?url'
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url'

ort.env.wasm.wasmPaths = { mjs: mjsUrl, wasm: wasmUrl }

/** Page → worker. Audio must already be 44.1 kHz, which Demucs expects. */
export type WorkerRequest = {
  left: Float32Array<ArrayBuffer>
  right: Float32Array<ArrayBuffer>
  modelUrl: string
  modelCache: string
  backend: 'wasm' | 'webgpu'
}

/** Worker → page. */
export type WorkerMessage =
  | { type: 'progress'; phase: 'download' | 'prepare' | 'separate'; fraction: number }
  | { type: 'done'; stems: Record<string, { left: Float32Array<ArrayBuffer>; right: Float32Array<ArrayBuffer> }>; threads: number }
  | { type: 'error'; message: string }

// The project's TypeScript setup describes the page, not workers, so type `self` as a Worker.
const scope = self as unknown as Worker
const post = (message: WorkerMessage, transfer: Transferable[] = []) => scope.postMessage(message, transfer)

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
    if (total) post({ type: 'progress', phase: 'download', fraction: received / total })
  }
  const blob = new Blob(chunks)
  await cache.put(url, new Response(blob))
  return blob.arrayBuffer()
}

scope.onmessage = async ({ data }: MessageEvent<WorkerRequest>) => {
  try {
    const model = await loadModelBytes(data.modelUrl, data.modelCache)
    post({ type: 'progress', phase: 'prepare', fraction: 0 })
    const processor = new DemucsProcessor({
      ort,
      sessionOptions: { executionProviders: [data.backend] },
      // demucs-web counts one segment too many, so cap at 1.
      onProgress: ({ progress }) => post({ type: 'progress', phase: 'separate', fraction: Math.min(1, progress) }),
    })
    await processor.loadModel(model)
    post({ type: 'progress', phase: 'separate', fraction: 0 })

    const result = await processor.separate(data.left, data.right)
    const stems: Extract<WorkerMessage, { type: 'done' }>['stems'] = {}
    const transfer: Transferable[] = []
    for (const [name, track] of Object.entries(result)) {
      const left = track.left as Float32Array<ArrayBuffer>
      const right = track.right as Float32Array<ArrayBuffer>
      stems[name] = { left, right }
      transfer.push(left.buffer, right.buffer) // moved to the page, not copied
    }
    post({ type: 'done', stems, threads: ort.env.wasm.numThreads ?? 1 }, transfer)
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}
