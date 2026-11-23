import SignalsmithStretch, { type SignalsmithStretchNode } from 'signalsmith-stretch'
import { UserError, type Range } from '../lib/types'
import type { StemName, Stems, StereoAudio } from '../separation/separator'
import { computePeaks } from './peaks'
import type { Capabilities, Player } from './player'
import { buildStemChannels, PLAYBACK_STEMS } from './stems'

export type LoadedAudio = {
  duration: number
  peaks: Float32Array
  sampleRate: number
  channels: number
}

/** Decoded audio is held in memory several times over; past this, browsers struggle. */
const MAX_MINUTES = 20
/**
 * The stem model's rate. Running the engine at it means stems need no resampling,
 * and buffers are ~9% smaller than at 48 kHz. The browser converts to the speakers' rate.
 */
const ENGINE_SAMPLE_RATE = 44_100

/**
 * Plays one decoded file through Signalsmith Stretch, which does the
 * time-stretching, pitch-shifting and gapless looping on the audio thread.
 *
 * Two stretch nodes: a stereo one for the plain file, and a 12-channel one (6 stems
 * × L/R) once stems exist. Stem volumes are applied after stretching, so faders,
 * mute and solo act instantly, and the stems can't drift apart: they're one node.
 */
export class AudioEngine implements Player {
  readonly capabilities: Capabilities = { pitch: true, stems: true, videoTransform: true, speedStep: 0.01 }

  private ctx: AudioContext | null = null
  /** Whichever node is playing: the stereo one or the stems one. */
  private node: SignalsmithStretchNode | null = null
  private mixNode: SignalsmithStretchNode | null = null
  private stemNode: Promise<SignalsmithStretchNode> | null = null
  private stemGains = new Map<StemName, GainNode>()
  /** Last volumes asked for, so they apply even if the stems node is created later. */
  private gainValues: Partial<Record<StemName, number>> = {}
  private ready: Promise<SignalsmithStretchNode> | null = null
  private loadId = 0
  /** The decoded file, kept for building stems and for separation. */
  private mix: { left: Float32Array; right: Float32Array } | null = null
  private active = false

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

  /** The loaded file's audio (read only), e.g. to separate it. */
  get audio(): StereoAudio | null {
    return this.mix && this.ctx ? { ...this.mix, sampleRate: this.ctx.sampleRate } : null
  }

  /** True once stems are playing (even partially). */
  get hasStems(): boolean {
    return this.node !== null && this.node !== this.mixNode
  }

  // Created lazily so the AudioContext starts from a user gesture (file pick or drop).
  private init(): Promise<SignalsmithStretchNode> {
    if (!this.ready) {
      const ctx = new AudioContext({ sampleRate: ENGINE_SAMPLE_RATE })
      this.ctx = ctx
      this.ready = SignalsmithStretch(ctx).then((node) => {
        node.connect(ctx.destination)
        node.setUpdateInterval(1 / 60, () => (this.pendingSeek = null))
        this.mixNode = node
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
    await this.dropStems()

    const channels = Array.from({ length: Math.min(2, audio.numberOfChannels) }, (_, c) => audio.getChannelData(c))
    const peaks = await computePeaks(channels, audio.sampleRate)
    if (id !== this.loadId) return null

    this.mix = { left: channels[0], right: channels[1] ?? channels[0] }
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
    this.mix = null
    void this.dropStems()
    void this.mixNode?.dropBuffers()
  }

  /**
   * Plays the stems (switching from the plain file the first time). Call again as more
   * of the song is separated; parts outside `ready` play the original mix.
   */
  async setStems(stems: Stems, ready: Range[]) {
    const id = this.loadId
    if (!this.mix || !this.ctx) return
    const channels = buildStemChannels(this.mix, stems, ready, this.ctx.sampleRate)
    const node = await this.ensureStemNode()
    if (id !== this.loadId) return
    await node.dropBuffers()
    await node.addBuffers(channels) // transferred to the audio thread, not copied
    if (id !== this.loadId) return
    // Take over from the node that was playing, at its current position.
    const input = this.currentTime
    if (this.node !== node) this.node?.schedule({ active: false })
    this.node = node
    this.pendingSeek = input
    node.schedule({ input, active: this.active, ...this.params() })
  }

  /** Volume per stem (1 = as separated). Smoothed over ~15 ms so changes don't click. */
  setStemGains(gains: Partial<Record<StemName, number>>) {
    this.gainValues = { ...this.gainValues, ...gains }
    if (!this.ctx) return
    for (const [name, value] of Object.entries(gains)) {
      this.stemGains.get(name as StemName)?.gain.setTargetAtTime(value, this.ctx.currentTime, 0.015)
    }
  }

  /** Back to the plain file. */
  private async dropStems() {
    if (!this.stemNode || !this.mixNode) return
    const stemNode = await this.stemNode
    if (this.node === stemNode) {
      stemNode.schedule({ active: false })
      this.node = this.mixNode
    }
    await stemNode.dropBuffers()
  }

  /** The 12-channel node and its per-stem volume controls, created on first use. */
  private ensureStemNode(): Promise<SignalsmithStretchNode> {
    const ctx = this.ctx!
    this.stemNode ??= SignalsmithStretch(ctx, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [PLAYBACK_STEMS.length * 2],
    }).then((node) => {
      node.setUpdateInterval(1 / 60, () => (this.pendingSeek = null))
      // Split the 12 channels into one stereo pair per stem, each with its own volume.
      const split = ctx.createChannelSplitter(PLAYBACK_STEMS.length * 2)
      node.connect(split)
      PLAYBACK_STEMS.forEach((name, i) => {
        const pair = ctx.createChannelMerger(2)
        split.connect(pair, i * 2, 0)
        split.connect(pair, i * 2 + 1, 1)
        const gain = ctx.createGain()
        gain.gain.value = this.gainValues[name] ?? 1
        pair.connect(gain).connect(ctx.destination)
        this.stemGains.set(name, gain)
      })
      return node
    })
    return this.stemNode
  }

  async play() {
    if (!this.node || !this.ctx) return
    await this.ctx.resume()
    this.active = true
    this.node.schedule({ active: true, ...this.params() })
  }

  pause() {
    this.active = false
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
