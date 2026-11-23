// Turning separated stems into what the audio engine plays, and mixer settings into volumes.

import type { Range, Stem } from '../lib/types'
import type { StemName, Stems } from '../separation/separator'

/** The engine's stem channels, in this order (two channels each). */
export const PLAYBACK_STEMS: StemName[] = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other']

/** A fader at this position plays a stem at its natural volume (the faders start here). */
const UNITY_LEVEL = 0.8

type Mix = { left: Float32Array; right: Float32Array }

/**
 * The 12 channels (L/R per stem, in PLAYBACK_STEMS order) for the engine, built from
 * the original mix and the separated stems.
 *
 * "Other" is recomputed as the mix minus every other stem. That makes the six stems
 * add up exactly to the original, so "stems off" (every stem at full volume) sounds
 * identical to the file, and whatever the model missed still plays somewhere.
 * Outside the `ready` ranges the other stems are silent, so Other carries the mix there.
 */
export function buildStemChannels(mix: Mix, stems: Stems, ready: Range[], sampleRate: number): Float32Array[] {
  const length = mix.left.length
  const otherL = new Float32Array(mix.left)
  const otherR = new Float32Array(mix.right)
  const ranges = ready.map(({ start, end }) => [Math.max(0, Math.floor(start * sampleRate)), Math.min(length, Math.ceil(end * sampleRate))])

  const channels: Float32Array[] = []
  for (const name of PLAYBACK_STEMS) {
    if (name === 'other') continue
    const left = new Float32Array(length)
    const right = new Float32Array(length)
    const stem = stems[name]
    if (stem) {
      const srcL = matchRate(stem.left, stem.sampleRate, sampleRate, length)
      const srcR = matchRate(stem.right, stem.sampleRate, sampleRate, length)
      for (const [a, b] of ranges) {
        left.set(srcL.subarray(a, b), a)
        right.set(srcR.subarray(a, b), a)
        for (let i = a; i < b; i++) {
          otherL[i] -= srcL[i]
          otherR[i] -= srcR[i]
        }
      }
    }
    channels.push(left, right)
  }
  channels.push(otherL, otherR)
  return channels
}

/** Stems come at the model's rate; the engine normally runs at the same rate, so this rarely does anything. */
function matchRate(samples: Float32Array, from: number, to: number, length: number): Float32Array {
  if (from === to && samples.length >= length) return samples
  const out = new Float32Array(length)
  const ratio = from / to
  for (let i = 0; i < length; i++) {
    const x = i * ratio
    const j = Math.floor(x)
    if (j + 1 >= samples.length) break
    out[i] = samples[j] + (samples[j + 1] - samples[j]) * (x - j) // linear interpolation
  }
  return out
}

/**
 * Volume per stem from the mixer. Off: every stem at 1, which is the original mix.
 * On: picked stems use their own fader; stems that aren't picked follow the Rest fader.
 */
export function stemGains(stems: Stem[], on: boolean): Record<StemName, number> {
  const gains = {} as Record<StemName, number>
  const rest = stems.find((s) => s.id === 'rest')
  const shown = stems.filter((s) => s.shown)
  const anySolo = shown.some((s) => s.solo)
  for (const name of PLAYBACK_STEMS) {
    if (!on) {
      gains[name] = 1
      continue
    }
    const own = stems.find((s) => s.id === name)
    const control = own?.shown ? own : rest
    const audible = control && !control.muted && (!anySolo || control.solo)
    gains[name] = audible ? control.level / UNITY_LEVEL : 0
  }
  return gains
}
