import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({mode}) => {
    return {
          plugins: [
          react(),
          tailwindcss(),
          VitePWA({
            registerType: 'autoUpdate',
            includeAssets: ['favicon.ico', 'icons/*.png'],
            manifest: {
              name: 'PRAC Staff Dashboard',
              short_name: 'PRAC Staff',
              description: 'Pattaya Rent A Car Staff Management Dashboard',
              theme_color: '#FF6321',
              background_color: '#F5F5F0',
              display: 'standalone',
              start_url: '/',
              scope: '/',
              icons: [
                { src: 'icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
                { src: 'icons/icon-512x512.png', sizes: '512x512', type: 'image/png' },
                { src: 'icons/icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
              ],
            },
            workbox: {
              globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
              navigateFallback: '/index.html',
            },
          }),
        ],
          define: {
                  'process.env.NODE_ENV': JSON.stringify(mode),
          },
          resolve: {
                  alias: {
                            '@': path.resolve(__dirname, './src'),
                  },
          },
          build: {
                  outDir: 'dist',
                  assetsDir: 'assets',
                  emptyOutDir: true
          },
          server: {
                  port: 3000,
                  host: '0.0.0.0',
                  hmr: process.env.DISABLE_HMR !== 'true',
          },
    };
});
