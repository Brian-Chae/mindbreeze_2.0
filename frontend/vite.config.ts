import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  build: {
    cssCodeSplit: false,
  },
  server: {
    host: true,
    port: 5175,
    proxy: {
      '/api': {
        target: 'https://dev-api.mindbreeze.looxidlabs.com',
        changeOrigin: true,
        secure: false,
      },
      '/socket.io': {
        target: 'https://dev-api.mindbreeze.looxidlabs.com',
        changeOrigin: true,
        ws: true,
      },
    },
    allowedHosts: [
      'brian-macmini.taila00d2a.ts.net',
      '.taila00d2a.ts.net',
      'localhost',
    ],
  },
})
