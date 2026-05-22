import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({mode}) => {
    return {
          plugins: [react(), tailwindcss()],
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
