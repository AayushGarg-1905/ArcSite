import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons.svg'],
      manifest: {
        name: 'ArcSite Clone — 2D Home Designer',
        short_name: 'ArcSite',
        description: 'Draw house floor plans and front elevations on canvas. DXF import/export, works offline.',
        theme_color: '#0f172a',
        background_color: '#f8fafc',
        display: 'standalone',
        orientation: 'any',
        start_url: '.',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // app shell + drawings assets available offline
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
      },
    }),
  ],
  server: {
    // Allow access via ngrok tunnels (host changes every `ngrok http` restart,
    // so whitelist the whole ngrok domain instead of one URL).
    allowedHosts: ['.ngrok-free.app', '.ngrok.io', '.ngrok.app','clemencia-virtuosic-brazenly.ngrok-free.dev'],
  },
})
