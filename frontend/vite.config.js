import process from 'node:process'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react()],
    server: {
      // `npm run dev`: teruskan /api ke API gateway agar cookie tetap satu origin.
      proxy: {
        '/api': {
          target: env.VITE_API_PROXY || 'http://localhost:8080',
          changeOrigin: false,
        },
      },
    },
  }
})
