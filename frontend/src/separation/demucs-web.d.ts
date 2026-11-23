// demucs-web ships plain JavaScript without types; this describes the parts we use.
declare module 'demucs-web' {
  import type * as Ort from 'onnxruntime-web'

  export type StereoTrack = { left: Float32Array; right: Float32Array }
  export type Stems = { drums: StereoTrack; bass: StereoTrack; other: StereoTrack; vocals: StereoTrack }

  export const CONSTANTS: {
    SAMPLE_RATE: number
    TRACKS: (keyof Stems)[]
    DEFAULT_MODEL_URL: string
  }

  export class DemucsProcessor {
    constructor(options: {
      ort: typeof Ort
      sessionOptions?: Ort.InferenceSession.SessionOptions
      onProgress?: (p: { progress: number; currentSegment: number; totalSegments: number }) => void
      onLog?: (phase: string, message: string) => void
      onDownloadProgress?: (loaded: number, total: number) => void
    })
    /** A URL to fetch, or the model's bytes. */
    loadModel(model: string | ArrayBuffer): Promise<unknown>
    /** 44.1 kHz stereo in, four stems out. */
    separate(left: Float32Array, right: Float32Array): Promise<Stems>
  }
}
