import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Clean-room clone of Manex (AI audio one-click mastering).
// All audio processing runs in the browser via the Web Audio API.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    open: false,
  },
})
