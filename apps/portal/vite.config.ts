// Vite = the development server and production bundler for the portal.
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [react(), tailwindcss(), VitePWA({
    registerType: 'prompt',
    injectRegister: 'script-defer',
    manifest: {
      id: '/', name: 'Muscat Bay Security', short_name: 'MB Security',
      description: 'Guard checkpoint scanning and patrol monitoring',
      start_url: '/guard', scope: '/', display: 'standalone',
      theme_color: '#4E4456', background_color: '#F7F8F9',
      icons: [{ src: '/patrol-icon.png', sizes: '1024x1024', type: 'image/png', purpose: 'any' }],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,png,woff2}'],
      navigateFallback: '/index.html',
      // Cache app files only. Authenticated API responses never enter the service worker cache.
      runtimeCaching: [],
    },
  })],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    sourcemap: true, // lets Sentry show real file/line numbers for errors
    chunkSizeWarningLimit: 1200,
  },
});
