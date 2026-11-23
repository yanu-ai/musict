import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defaultClientConditions, defineConfig, type Connect, type Plugin } from 'vite'

// Served from the root of its own domain on Cloudflare.
const base = '/'

/**
 * Cross-origin isolation (COOP + COEP) lets stem separation use several CPU
 * threads, but it blocks the YouTube player. So every page gets the headers
 * except YouTube mode, under /youtube/. Cloudflare does the same with public/_headers.
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
  resolve: {
    // Use ONNX Runtime's build that loads its 29.5 MB engine binary from a URL we give it
    // (jsDelivr), instead of bundling it: Cloudflare rejects files over 25 MiB.
    conditions: ['onnxruntime-web-use-extern-wasm', ...defaultClientConditions],
  },
})
