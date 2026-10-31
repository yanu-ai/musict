import type { Range } from '../lib/types'

export type Capabilities = {
  /** Pitch shift and the preserve-pitch toggle. */
  pitch: boolean
  /** Stem separation needs the raw audio. */
  stems: boolean
  /** Mirror/zoom on the picture. */
  videoTransform: boolean
  /** Smallest speed change the player can honor. */
  speedStep: number
}

/**
 * What the UI needs from anything that plays media. AudioEngine (uploaded
 * files) and YouTubePlayer both implement it, so the rest of the app doesn't
 * care which one is active.
 */
export interface Player {
  readonly capabilities: Capabilities
  readonly duration: number
  readonly currentTime: number
  readonly looping: boolean
  play(): Promise<void>
  pause(): void
  seek(t: number): void
  setRate(rate: number): void
  setPitch(semitones: number): void
  setPreservePitch(on: boolean): void
  setLoop(loop: Range | null): void
}
