import { createStore, del, get, set } from 'idb-keyval'
import type { Range, Section, Source, Stem } from './types'

// Everything lives in the browser's IndexedDB; nothing leaves the machine.
const projects = createStore('musict-projects', 'projects')
const files = createStore('musict-files', 'files')
const meta = createStore('musict-meta', 'meta')

/** Per-song work, keyed by Track.id. */
export type Project = {
  sections: Section[]
  markers: number[]
  loop: Range | null
  loopOn: boolean
  speed: number
  pitch: number
  cents: number
  preservePitch: boolean
  stems: Stem[]
  mirrored: boolean
  zoom: number
}

export type Recent = {
  id: string
  name: string
  source: Source
  /** YouTube video id, for source === 'youtube'. */
  videoId?: string
  openedAt: number
}

const MAX_RECENTS = 8
/** Bigger files are still saved as projects, just not kept for one-click reopening. */
const MAX_STORED_FILE = 300 * 1024 * 1024

// Storage can fail (private windows, quota); the app must keep working without it.
async function safe<T>(op: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await op()
  } catch {
    return fallback
  }
}

export const loadProject = (id: string) => safe(() => get<Project>(id, projects), undefined)
export const saveProject = (id: string, project: Project) => safe(() => set(id, project, projects), undefined)

export const listRecents = () => safe(async () => (await get<Recent[]>('recents', meta)) ?? [], [] as Recent[])

export async function addRecent(recent: Recent, file?: File) {
  await safe(async () => {
    const previous = (await get<Recent[]>('recents', meta)) ?? []
    const rest = previous.filter((r) => r.id !== recent.id)
    const next = [recent, ...rest].slice(0, MAX_RECENTS)
    if (file && file.size <= MAX_STORED_FILE) await set(recent.id, file, files)
    for (const dropped of rest.slice(MAX_RECENTS - 1)) await del(dropped.id, files)
    await set('recents', next, meta)
  }, undefined)
}

export const loadRecentFile = (id: string) => safe(() => get<File>(id, files), undefined)

export async function removeRecent(id: string) {
  await safe(async () => {
    const previous = (await get<Recent[]>('recents', meta)) ?? []
    await set('recents', previous.filter((r) => r.id !== id), meta)
    await del(id, files)
  }, undefined)
}
