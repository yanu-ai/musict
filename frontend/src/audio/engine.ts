import SignalsmithStretch, { type SignalsmithStretchNode } from 'signalsmith-stretch'
import { UserError, type Range } from '../lib/types'
import { computePeaks } from './peaks'
import type { Capabilities, Player } from './player'

export type LoadedAudio = {
  duration: number
  peaks: Float32Array
  sampleRate: number
  channels: number
}

/** Decoded audio is held in memory several times over; past this, browsers struggle. */
const MAX_MINUTES = 20

/**
 * Plays one decoded file through Signalsmith Stretch, which does the
 * time-stretching, pitch-shifting and gapless looping on the audio thread.
 */
export class AudioEngine implements Player {
  readonly capabilities: Capabilities = { pitch: true, stems: true, videoTransform: true, speedStep: 0.01 }

  private ctx: AudioContext | null = null
  private node: SignalsmithStretchNode | null = null
  private ready: Promise<SignalsmithStretchNode> | null = null
  private loadId = 0

  duration = 0
  private rate = 1
  private semitones = 0
  private preservePitch = true
  private loop: Range | null = null
  /** Position set by the last seek, shown until the worklet reports back. */
  private pendingSeek: number | null = null

  get currentTime(): number {
    return this.pendingSeek ?? this.node?.inputTime ?? 0
  }

  get looping(): boolean {
    return this.loop !== null
  }

  // Created lazily so the AudioContext starts from a user gesture (file pick or drop).
  private init(): Promise<SignalsmithStretchNode> {
    if (!this.ready) {
      const ctx = new AudioContext()
      this.ctx = ctx
      this.ready = SignalsmithStretch(ctx).then((node) => {
        node.connect(ctx.destination)
        node.setUpdateInterval(1 / 60, () => (this.pendingSeek = null))
        this.node = node
        return node
      })
    }
    return this.ready
  }

  /** Decodes and loads a file. Resolves to null if a newer load replaced it. */
  async load(file: File): Promise<LoadedAudio | null> {
    const id = ++this.loadId
    const probed = await probeDuration(file)
    if (probed > MAX_MINUTES * 60) {
      throw new UserError(`That file is ${Math.round(probed / 60)} minutes long. musict handles up to ${MAX_MINUTES} minutes for now.`)
    }

    let node: SignalsmithStretchNode
    try {
      node = await this.init()
    } catch {
      throw new UserError('This browser can’t run the audio engine. Try a recent Chrome, Edge, Firefox or Safari.')
    }
    this.pause()

    let audio: AudioBuffer
    try {
      audio = await this.ctx!.decodeAudioData(await file.arrayBuffer())
    } catch {
      throw new UserError(`This browser can’t decode “${file.name}”. Try MP3, WAV, M4A, FLAC or MP4.`)
    }
    if (id !== this.loadId) return null

    const channels = Array.from({ length: Math.min(2, audio.numberOfChannels) }, (_, c) => audio.getChannelData(c))
    const peaks = await computePeaks(channels, audio.sampleRate)
    if (id !== this.loadId) return null

    await node.dropBuffers()
    // Copies, because the node transfers (and so detaches) what it's given.
    await node.addBuffers(channels.length === 1 ? [channels[0].slice(), channels[0].slice()] : channels.map((c) => c.slice()))
    if (id !== this.loadId) return null

    this.duration = audio.duration
    this.loop = null
    this.seek(0)
    return { duration: audio.duration, peaks, sampleRate: audio.sampleRate, channels: audio.numberOfChannels }
  }

  /** Stops playback and forgets the current file. */
  unload() {
    this.loadId++
    this.pause()
    this.duration = 0
    void this.node?.dropBuffers()
  }

  async play() {
    if (!this.node || !this.ctx) return
    await this.ctx.resume()
    this.node.schedule({ active: true, ...this.params() })
  }

  pause() {
    this.node?.schedule({ active: false })
  }

  seek(t: number) {
    const input = Math.min(this.duration, Math.max(0, t))
    this.pendingSeek = input
    this.node?.schedule({ input })
  }

  setRate(rate: number) {
    this.rate = rate
    this.apply()
  }

  setPitch(semitones: number) {
    this.semitones = semitones
    this.apply()
  }

  /** When off, slowing down also lowers the pitch, like a tape machine. */
  setPreservePitch(on: boolean) {
    this.preservePitch = on
    this.apply()
  }

  setLoop(loop: Range | null) {
    this.loop = loop
    this.apply()
  }

  private params() {
    const tape = this.preservePitch ? 0 : 12 * Math.log2(this.rate)
    return {
      rate: this.rate,
      semitones: this.semitones + tape,
      loopStart: this.loop?.start ?? 0,
      loopEnd: this.loop?.end ?? 0,
    }
  }

  private apply() {
    this.node?.schedule(this.params())
  }
}

/** Reads the duration from metadata without decoding. 0 if the browser can't tell. */
function probeDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const el = document.createElement(file.type.startsWith('video/') ? 'video' : 'audio')
    const done = (d: number) => {
      URL.revokeObjectURL(url)
      clearTimeout(timer)
      resolve(Number.isFinite(d) ? d : 0)
    }
    const timer = setTimeout(() => done(0), 4000)
    el.preload = 'metadata'
    el.onloadedmetadata = () => done(el.duration)
    el.onerror = () => done(0)
    el.src = url
  })
}
