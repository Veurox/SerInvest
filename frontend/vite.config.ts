import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Dev server only — production build (vite build) ignores `server`.
  // Proxy /api → çalışan core-api (8080) so the dev origin stays same-origin
  // and CORS (yalnızca localhost:3000'e izinli) devre dışı kalmaz.
  server: {
    port: 5180,
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
})
