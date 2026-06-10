import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // Unique per build — used to cache-bust the runtime-fetched locale JSON files
    __BUILD_ID__: JSON.stringify(Date.now().toString()),
  },
})
