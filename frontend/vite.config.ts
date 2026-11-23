import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Connect, type Plugin } from 'vite'

// Served from https://yanu-ai.github.io/musict/ on GitHub Pages.
const base = '/musict/'

/**
 * Cross-origin isolation (COOP + COEP) lets stem separation use several CPU
 * threads, but it blocks the YouTube player. So every page gets the headers
 * except YouTube mode, under /youtube/.
 */
function crossOriginIsolation(): Plugin {
  const addHeaders: Connect.NextHandleFunction = (req, res, next) => {
    if (!req.url?.startsWith(`${base}youtube`)) {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
    }
    next()
  }
  return {
    name: 'cross-origin-isolation',
    configureServer: (server) => void server.middlewares.use(addHeaders), // npm run dev
    configurePreviewServer: (server) => void server.middlewares.use(addHeaders), // npm run preview
  }
}

export default defineConfig({
  base,
  plugins: [react(), tailwindcss(), crossOriginIsolation()],
})
