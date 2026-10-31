import { useState } from 'react'
import type { Range, Section } from '../lib/types'

const round1 = (t: number) => Math.round(t * 10) / 10
const MIN_LOOP = 0.5

export type SectionsState = {
  sections: Section[]
  markers: number[]
  loop: Range | null
  loopOn: boolean
}

/**
 * Sections, markers and the current loop. Pure state: anything that also
 * moves the playhead returns the time to seek to, and the caller seeks.
 */
export function useSections() {
  const [sections, setSections] = useState<Section[]>([])
  const [markers, setMarkers] = useState<number[]>([])
  const [loop, setLoop] = useState<Range | null>(null)
  const [loopOn, setLoopOn] = useState(true)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  const active = sections.find((s) => s.id === activeId) ?? null

  const restore = (saved: SectionsState | null) => {
    setSections(saved?.sections ?? [])
    setMarkers(saved?.markers ?? [])
    setLoop(saved?.loop ?? null)
    setLoopOn(saved?.loopOn ?? true)
    // Re-select the section the saved loop belongs to, if any.
    const match = saved?.loop && saved.sections.find((s) => s.start === saved.loop!.start && s.end === saved.loop!.end)
    setActiveId(match ? match.id : null)
    setEditingId(null)
  }

  /** `new` draws a fresh loop; `edit` moves the current one (and its section). */
  const changeLoop = (range: Range, kind: 'new' | 'edit') => {
    const r = { start: round1(range.start), end: round1(range.end) }
    setLoop(r)
    setLoopOn(true)
    if (kind === 'new') setActiveId(null)
    else if (activeId) setSections((all) => all.map((s) => (s.id === activeId ? { ...s, ...r } : s)))
  }

  const nudge = (edge: 'start' | 'end', delta: number, duration: number) => {
    if (!loop) return
    const v = loop[edge] + delta
    changeLoop(
      edge === 'start'
        ? { start: Math.max(0, Math.min(v, loop.end - MIN_LOOP)), end: loop.end }
        : { start: loop.start, end: Math.min(duration, Math.max(v, loop.start + MIN_LOOP)) },
      'edit',
    )
  }

  const clearLoop = () => {
    setLoop(null)
    setActiveId(null)
  }

  /** Returns where to seek. */
  const select = (id: string): number | null => {
    const s = sections.find((x) => x.id === id)
    if (!s) return null
    setActiveId(id)
    setLoop({ start: s.start, end: s.end })
    setLoopOn(true)
    return s.start
  }

  const saveLoop = () => {
    if (!loop || active) return
    const id = crypto.randomUUID()
    setSections((all) => [...all, { id, name: `Section ${all.length + 1}`, ...loop }].sort((a, b) => a.start - b.start))
    setActiveId(id)
    setEditingId(id)
  }

  const rename = (id: string, name: string) => {
    setSections((all) => all.map((s) => (s.id === id && name.trim() ? { ...s, name: name.trim() } : s)))
    setEditingId(null)
  }

  const remove = (id: string) => {
    setSections((all) => all.filter((s) => s.id !== id))
    if (activeId === id) setActiveId(null)
  }

  const addMarker = (time: number) => {
    const t = round1(time)
    setMarkers((all) => (all.some((m) => Math.abs(m - t) < 0.3) ? all : [...all, t].sort((a, b) => a - b)))
  }

  const clearMarkers = () => setMarkers([])

  /** Loops the gap between the markers around `t`. Returns where to seek. */
  const loopBetweenMarkers = (t: number, duration: number): number => {
    const bounds = [0, ...markers, duration]
    const start = Math.max(...bounds.filter((b) => b <= t))
    const end = Math.min(...bounds.filter((b) => b > t))
    changeLoop({ start, end }, 'new')
    return start
  }

  /** Previous/next marker or section start relative to `time`. */
  const jumpTarget = (time: number, dir: 1 | -1): number | undefined => {
    const points = [...new Set([0, ...markers, ...sections.map((s) => s.start)])].sort((a, b) => a - b)
    return dir === -1 ? (points.filter((p) => p < time - 0.5).pop() ?? 0) : points.find((p) => p > time + 0.05)
  }

  return {
    sections,
    markers,
    loop,
    loopOn,
    setLoopOn,
    activeLoop: loopOn ? loop : null,
    active,
    activeId,
    editingId,
    setEditingId,
    restore,
    changeLoop,
    nudge,
    clearLoop,
    select,
    saveLoop,
    rename,
    remove,
    addMarker,
    clearMarkers,
    loopBetweenMarkers,
    jumpTarget,
  }
}
