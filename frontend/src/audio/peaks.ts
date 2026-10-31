export const PEAKS_PER_SECOND = 100

const CHUNK = 2_000_000
const nextTask = () => new Promise((r) => setTimeout(r, 0))

/**
 * Peak heights (0–1) at PEAKS_PER_SECOND, detailed enough for the waveform to
 * zoom in to a couple of seconds. Works through the samples in chunks and
 * yields between them, so long files don't freeze the page.
 */
export async function computePeaks(channels: Float32Array[], sampleRate: number): Promise<Float32Array> {
  const length = channels[0].length
  const size = sampleRate / PEAKS_PER_SECOND
  const peaks = new Float32Array(Math.ceil(length / size))

  for (let from = 0; from < length; from += CHUNK) {
    const to = Math.min(length, from + CHUNK)
    for (const data of channels) {
      for (let j = from; j < to; j++) {
        const v = Math.abs(data[j])
        const i = Math.floor(j / size)
        if (v > peaks[i]) peaks[i] = v
      }
    }
    await nextTask()
  }

  let loudest = 0
  for (const p of peaks) if (p > loudest) loudest = p
  if (loudest > 0) for (let i = 0; i < peaks.length; i++) peaks[i] /= loudest
  return peaks
}

/** Max peak per bar for `bars` bars spanning [start, end) seconds. */
export function resamplePeaks(peaks: Float32Array, perSecond: number, start: number, end: number, bars: number): number[] {
  const out = new Array<number>(bars)
  const span = (end - start) / bars
  for (let b = 0; b < bars; b++) {
    const from = Math.floor((start + b * span) * perSecond)
    const to = Math.max(from + 1, Math.floor((start + (b + 1) * span) * perSecond))
    let max = 0
    for (let i = from; i < to && i < peaks.length; i++) if (peaks[i] > max) max = peaks[i]
    out[b] = Math.max(0.03, max)
  }
  return out
}
