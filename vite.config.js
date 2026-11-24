import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',
  // versão do app (data e hora do build), mostrada na tela de lançamentos
  define: { __VERSAO__: JSON.stringify(new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,   // o registro é feito em main.jsx (recarrega sozinho quando há versão nova)
      manifest: {
        name: 'Camarão — Coleta de Campo',
        short_name: 'Campo',
        lang: 'pt-BR',
        theme_color: '#0f4c5c',
        background_color: '#f4f1ea',
        display: 'standalone',
        start_url: './',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg}'], cleanupOutdatedCaches: true, clientsClaim: true, skipWaiting: true },
    }),
  ],
})
