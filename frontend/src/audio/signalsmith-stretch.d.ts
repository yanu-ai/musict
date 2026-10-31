// Types for the parts of signalsmith-stretch we use (the package ships none).
declare module 'signalsmith-stretch' {
  export type StretchSchedule = {
    /** AudioContext time the change applies at; defaults to now. */
    output?: number
    active?: boolean
    /** Position in the input buffer, seconds. */
    input?: number
    rate?: number
    semitones?: number
    tonalityHz?: number
    formantSemitones?: number
    formantCompensation?: boolean
    formantBaseHz?: number
    /** Looping is disabled when loopStart === loopEnd. */
    loopStart?: number
    loopEnd?: number
  }

  export interface SignalsmithStretchNode extends AudioWorkletNode {
    /** Current position in the input buffer, seconds (latency-compensated). */
    inputTime: number
    schedule(change: StretchSchedule): Promise<StretchSchedule>
    start(when?: number | StretchSchedule): Promise<StretchSchedule>
    stop(when?: number): Promise<StretchSchedule>
    addBuffers(channels: Float32Array[]): Promise<number>
    dropBuffers(toSeconds?: number): Promise<{ start: number; end: number }>
    setUpdateInterval(seconds: number, callback?: (inputTime: number) => void): Promise<void>
    latency(): Promise<number>
  }

  export default function SignalsmithStretch(
    context: BaseAudioContext,
    options?: AudioWorkletNodeOptions,
  ): Promise<SignalsmithStretchNode>
}
