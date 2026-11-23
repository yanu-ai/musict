// Two addresses, one app:
//   <base>             home and file mode, cross-origin isolated so stem separation can use several threads
//   <base>youtube/?v=  YouTube mode, not isolated, because isolation blocks the YouTube player
// The server decides isolation per path (vite.config.ts locally, public/_headers when hosted),
// so moving between the two modes is a page load, not just a state change.

const base = import.meta.env.BASE_URL

export const isYouTubePage = () => location.pathname.startsWith(`${base}youtube`)
export const homeUrl = () => base
export const youTubeUrl = (videoId: string) => `${base}youtube/?v=${encodeURIComponent(videoId)}`
/** The video id in the current YouTube-page address, if any. */
export const videoIdInUrl = () => new URLSearchParams(location.search).get('v')
