import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1500 },
  server: {
    // the API lives on :8787 (npm run dev:all starts both)
    proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: false } },
  },
})
