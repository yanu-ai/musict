// One contract for every way of splitting a song into stems. The app only talks to
// a Separator, so the browser, a self-hosted server or ZeroGPU can be swapped in
// without the rest of the app caring which one ran (see CLAUDE.md).

export type StemName = 'vocals' | 'drums' | 'bass' | 'other' | 'guitar' | 'piano'

export type StereoAudio = { left: Float32Array; right: Float32Array; sampleRate: number }

/** Partial because models differ: 4-stem Demucs has no guitar or piano. */
export type Stems = Partial<Record<StemName, StereoAudio>>

export type Progress = {
  /** download: fetching the model; prepare: loading it; separate: the actual work. */
  phase: 'download' | 'prepare' | 'separate'
  /** 0 to 1 within the phase. */
  fraction: number
}

export type SeparateOptions = {
  onProgress?: (progress: Progress) => void
  /** Abort to cancel; separate() then rejects with the signal's reason. */
  signal?: AbortSignal
}

export interface Separator {
  /** Shown in the UI, e.g. "This browser · CPU, multi-threaded". */
  readonly label: string
  /** The stems this separator produces. */
  readonly stems: StemName[]
  /** Bytes still to download before the first run (0 if ready), so the UI can ask first. */
  downloadSize(): Promise<number>
  /** Audio in, stems out. Never modifies or takes ownership of the input. */
  separate(audio: StereoAudio, options?: SeparateOptions): Promise<Stems>
}
