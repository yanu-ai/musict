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

/**
 * Files are stored as raw bytes: Safari rejects Blob/File values in IndexedDB
 * in some contexts (private windows, automation) with "BlobURLs are not yet supported".
 */
type StoredFile = { name: string; type: string; lastModified: number; data: ArrayBuffer }

export async function addRecent(recent: Recent, file?: File) {
  const previous = await listRecents()
  const rest = previous.filter((r) => r.id !== recent.id)
  await safe(() => set('recents', [recent, ...rest].slice(0, MAX_RECENTS), meta), undefined)
  for (const dropped of rest.slice(MAX_RECENTS - 1)) await safe(() => del(dropped.id, files), undefined)
  // Separate from the list above so a failed (e.g. over-quota) file save never loses the list.
  if (file && file.size <= MAX_STORED_FILE) {
    await safe(async () => {
      const stored: StoredFile = { name: file.name, type: file.type, lastModified: file.lastModified, data: await file.arrayBuffer() }
      await set(recent.id, stored, files)
    }, undefined)
  }
}

export const loadRecentFile = (id: string) =>
  safe(async () => {
    const stored = await get<StoredFile | File>(id, files)
    // Entries saved before the raw-bytes format are File objects already.
    if (!stored || stored instanceof File) return stored
    return new File([stored.data], stored.name, { type: stored.type, lastModified: stored.lastModified })
  }, undefined)

/**
 * Asks the browser not to evict our storage. Without this, Safari may clear a
 * site's data after 7 days without a visit, taking saved sections with it.
 */
export const requestPersistentStorage = () => safe(async () => (await navigator.storage?.persist?.()) ?? false, false)

export async function removeRecent(id: string) {
  await safe(async () => {
    const previous = (await get<Recent[]>('recents', meta)) ?? []
    await set('recents', previous.filter((r) => r.id !== id), meta)
    await del(id, files)
  }, undefined)
}
