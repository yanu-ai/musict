import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Served from https://yanu-ai.github.io/musict/ on GitHub Pages.
  base: '/musict/',
  plugins: [react(), tailwindcss()],
})
