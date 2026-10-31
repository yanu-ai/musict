import { useEffect, useRef, useState } from 'react'
import { UserError, type Range, type Track } from '../lib/types'
import { AudioEngine } from './engine'
import { PEAKS_PER_SECOND } from './peaks'
import type { Capabilities, Player } from './player'
import { parseYouTubeId, YouTubePlayer } from './youtube'

type Settings = { speed: number; semitones: number; preservePitch: boolean; loop: Range | null }

const message = (e: unknown, fallback: string) => (e instanceof UserError ? e.message : fallback)

/**
 * Owns whichever Player is active (uploaded file or YouTube) and mirrors its
 * clock into React state.
 */
export function usePlayer({ speed, semitones, preservePitch, loop }: Settings) {
  const [engine] = useState(() => new AudioEngine())
  const [player, setPlayer] = useState<Player | null>(null)
  const [track, setTrack] = useState<Track | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const objectUrl = useRef<string | null>(null)
  const youtube = useRef<YouTubePlayer | null>(null)

  useEffect(() => player?.setRate(speed), [player, speed])
  useEffect(() => player?.setPitch(semitones), [player, semitones])
  useEffect(() => player?.setPreservePitch(preservePitch), [player, preservePitch])
  const loopStart = loop?.start
  const loopEnd = loop?.end
  useEffect(() => {
    player?.setLoop(loopStart !== undefined && loopEnd !== undefined ? { start: loopStart, end: loopEnd } : null)
  }, [player, loopStart, loopEnd])

  // Follow the player's clock while playing.
  useEffect(() => {
    if (!playing || !player) return
    let raf = 0
    const tick = () => {
      const t = player.currentTime
      if (!player.looping && t >= player.duration - 0.05) {
        player.pause()
        setPlaying(false)
        setTime(player.duration)
        return
      }
      setTime(t)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [player, playing])

  /** Stop and forget whatever is loaded. */
  const close = () => {
    engine.unload()
    youtube.current?.dispose()
    youtube.current = null
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
    objectUrl.current = null
    setPlayer(null)
    setTrack(null)
    setPlaying(false)
    setTime(0)
  }

  const loadFile = async (file: File): Promise<Track | null> => {
    close()
    setLoading(true)
    setError(null)
    try {
      const audio = await engine.load(file)
      if (!audio) return null
      const kind = file.type.startsWith('video/') ? 'video' : 'audio'
      objectUrl.current = kind === 'video' ? URL.createObjectURL(file) : null
      const loaded: Track = {
        id: `file:${file.name}:${file.size}`,
        name: file.name.replace(/\.[^.]+$/, ''),
        source: 'file',
        kind,
        url: objectUrl.current,
        youtube: null,
        duration: audio.duration,
        peaks: audio.peaks,
        peaksPerSecond: PEAKS_PER_SECOND,
        details: [`${(audio.sampleRate / 1000).toFixed(1)} kHz`, audio.channels === 1 ? 'Mono' : 'Stereo'],
      }
      setTrack(loaded)
      setPlayer(engine)
      return loaded
    } catch (e) {
      setError(message(e, `Couldn’t open “${file.name}”.`))
      return null
    } finally {
      setLoading(false)
    }
  }

  const loadYouTube = async (link: string): Promise<Track | null> => {
    const videoId = parseYouTubeId(link)
    if (!videoId) {
      setError('That doesn’t look like a YouTube link.')
      return null
    }
    close()
    setError(null)
    setLoading(true)
    const yt = new YouTubePlayer()
    youtube.current = yt
    // Show the video panel straight away so the iframe has somewhere to load.
    const pending: Track = {
      id: `yt:${videoId}`,
      name: 'YouTube video',
      source: 'youtube',
      kind: 'video',
      url: null,
      youtube: yt.element,
      duration: 0,
      peaks: null,
      peaksPerSecond: 0,
      details: ['YouTube'],
    }
    setTrack(pending)
    try {
      await yt.load(videoId)
      if (youtube.current !== yt) return null
      const loaded = { ...pending, name: yt.title, duration: yt.duration }
      setTrack(loaded)
      setPlayer(yt)
      return loaded
    } catch (e) {
      if (youtube.current === yt) {
        close()
        setError(message(e, 'Couldn’t load that YouTube video.'))
      }
      return null
    } finally {
      setLoading(false)
    }
  }

  const seek = (t: number) => {
    if (!player) return
    const clamped = Math.min(player.duration, Math.max(0, t))
    player.seek(clamped)
    setTime(clamped)
  }

  const play = async () => {
    if (!player) return
    if (time >= player.duration - 0.05) seek(loop?.start ?? 0)
    await player.play()
    setPlaying(true)
  }

  const pause = () => {
    player?.pause()
    setPlaying(false)
  }

  const capabilities: Capabilities = player?.capabilities ?? engine.capabilities

  return {
    track,
    ready: !!player,
    capabilities,
    loading,
    error,
    playing,
    time,
    loadFile,
    loadYouTube,
    close,
    seek,
    play,
    pause,
    togglePlay: () => (playing ? pause() : play()),
  }
}
