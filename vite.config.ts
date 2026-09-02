/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/*.png'],
      manifest: {
        name: 'Paguei',
        short_name: 'Paguei',
        description: 'Controle suas contas de forma simples e eficiente',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        // O bundle do Firebase sozinho passa de 400 kB e estourava o limite
        // padrão de 2 MB por arquivo do precache.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024
      }
    })
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
    alias: {
      'firebase/app': '/src/test/firebase-stub.ts',
      'firebase/auth': '/src/test/firebase-stub.ts',
      'firebase/firestore': '/src/test/firebase-stub.ts',
      'firebase/storage': '/src/test/firebase-stub.ts'
    }
  },
  build: {
    rollupOptions: {
      output: {
        // Separa as dependências que quase nunca mudam das que mudam a cada
        // deploy: assim uma correção no app não invalida o cache do Firebase
        // nem do React no navegador de quem já tem o PWA instalado.
        manualChunks: {
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/storage'],
          react: ['react', 'react-dom', 'react-router-dom'],
          db: ['dexie', 'dexie-react-hooks']
        }
      }
    }
  }
})
