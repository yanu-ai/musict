// One contract for every way of splitting a song into stems. The app only talks to
// a Separator, so the browser, a self-hosted server or ZeroGPU can be swapped in
// without the rest of the app caring which one ran (see CLAUDE.md).

import type { Range } from '../lib/types'

export type StemName = 'vocals' | 'drums' | 'bass' | 'guitar' | 'piano' | 'other'

export type StereoAudio = { left: Float32Array; right: Float32Array; sampleRate: number }

/** Partial because models differ: 4-stem models have no guitar or piano. */
export type Stems = Partial<Record<StemName, StereoAudio>>

export type Progress = {
  /** download: fetching the model; prepare: loading it; separate: the actual work. */
  phase: 'download' | 'prepare' | 'separate'
  /** 0 to 1 within the phase. */
  fraction: number
}

/** Stems so far: full-length arrays, valid only inside the `ready` time ranges. */
export type PartialStems = { stems: Stems; ready: Range[] }

export type SeparateOptions = {
  onProgress?: (progress: Progress) => void
  /** Work on this part of the song first (e.g. the current loop), in seconds. */
  priority?: Range | null
  /** Called each time the priority range becomes fully separated. */
  onPartial?: (partial: PartialStems) => void
  /** Use fewer resources (e.g. fewer threads) because the user didn't ask for this run. */
  background?: boolean
  /** Abort to cancel; the job's result then rejects with the signal's reason. */
  signal?: AbortSignal
}

export type SeparationJob = {
  /** Resolves with all stems, full length. */
  result: Promise<Stems>
  /** Move a new part of the song to the front of the queue (e.g. the loop changed). */
  prioritize(range: Range | null): void
}

export interface Separator {
  /** Shown in the UI, e.g. "This browser · CPU, multi-threaded". */
  readonly label: string
  /** The stems this separator produces. */
  readonly stems: StemName[]
  /** Longest song it accepts, in seconds. */
  readonly maxDuration: number
  /** Bytes still to download before the first run (0 if ready), so the UI can ask first. */
  downloadSize(): Promise<number>
  /** Audio in, stems out. Never modifies or takes ownership of the input. */
  separate(audio: StereoAudio, options?: SeparateOptions): SeparationJob
}
