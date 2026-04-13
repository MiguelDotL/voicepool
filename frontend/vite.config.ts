import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3501,
    proxy: {
      "/api": {
        target: "http://localhost:3500",
        changeOrigin: true,
      },
    },
  },
})
