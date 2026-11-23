// How a song is cut into the model's fixed-size chunks and stitched back together.
// Shared by the page and the worker, and free of heavy imports on purpose.
//
// Chunks are SEGMENT samples long and overlap their neighbours by a quarter. Where two
// chunks overlap, one fades out while the other fades in, and the two fades add up to
// exactly 1, so a sample's value is final as soon as every chunk covering it is done.

export const SAMPLE_RATE = 44_100 // the model's sample rate
export const SEGMENT = 343_980 // 7.8 s: the model's fixed input length
export const OVERLAP = Math.floor(SEGMENT / 4)
export const STRIDE = SEGMENT - OVERLAP
/** The order of the model's six outputs. */
export const STEM_ORDER = ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano'] as const

/** A range of samples, end exclusive. */
export type SampleRange = [start: number, end: number]

export const chunkCount = (total: number) => Math.max(1, Math.ceil(total / STRIDE))
export const chunkStart = (index: number) => index * STRIDE

const windows = new Map<string, Float32Array>()
/** Per-sample weights for a chunk: fades where it overlaps a neighbour, 1 elsewhere (including the song's edges). */
export function chunkWindow(index: number, count: number): Float32Array {
  const fadeIn = index > 0
  const fadeOut = index < count - 1
  const key = `${fadeIn}${fadeOut}`
  let w = windows.get(key)
  if (!w) {
    w = new Float32Array(SEGMENT).fill(1)
    for (let k = 0; k < OVERLAP; k++) {
      const fade = k / (OVERLAP - 1)
      if (fadeIn) w[k] = fade
      if (fadeOut) w[SEGMENT - 1 - k] = fade
    }
    windows.set(key, w)
  }
  return w
}

/**
 * Which chunk to do next: chunks touching `priority` first (in time order), then the
 * rest, nearest to the priority range first.
 */
export function nextChunk(remaining: Set<number>, total: number, priority: SampleRange | null): number | undefined {
  let best: number | undefined
  let bestScore = Infinity
  for (const i of remaining) {
    const start = chunkStart(i)
    const end = Math.min(start + SEGMENT, total)
    let score = start // no priority: plain time order
    if (priority) {
      const distance = Math.max(0, priority[0] - end, start - priority[1])
      score = distance === 0 ? start - total : distance * 2 + start / total // touching chunks always first
    }
    if (score < bestScore) {
      bestScore = score
      best = i
    }
  }
  return best
}

/** The sample ranges that become final when chunk `index` finishes, given which chunks are done. */
export function newlyReady(index: number, done: boolean[], total: number): SampleRange[] {
  const count = done.length
  const start = chunkStart(index)
  const end = Math.min(start + SEGMENT, total)
  const nextStart = index < count - 1 ? chunkStart(index + 1) : end
  const ranges: SampleRange[] = []
  // The middle is covered by this chunk alone.
  ranges.push([index > 0 ? start + OVERLAP : start, nextStart])
  // The overlaps need the neighbour too.
  if (index > 0 && done[index - 1]) ranges.push([start, start + OVERLAP])
  if (index < count - 1 && done[index + 1]) ranges.push([nextStart, end])
  return ranges.map(([a, b]): SampleRange => [Math.max(0, a), Math.min(total, b)]).filter(([a, b]) => b > a)
}

/** Adds a range to a sorted list of non-overlapping ranges, merging where they touch. */
export function addRange(list: SampleRange[], [start, end]: SampleRange): SampleRange[] {
  const merged: SampleRange[] = []
  let current: SampleRange = [start, end]
  for (const r of list) {
    if (r[1] < current[0]) merged.push(r)
    else if (r[0] > current[1]) {
      merged.push(current)
      current = r
    } else current = [Math.min(r[0], current[0]), Math.max(r[1], current[1])]
  }
  merged.push(current)
  return merged.sort((a, b) => a[0] - b[0])
}

export const contains = (list: SampleRange[], [start, end]: SampleRange) => list.some((r) => r[0] <= start && r[1] >= end)
