import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import {defineConfig, loadEnv} from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env': {
        GEMINI_API_KEY: JSON.stringify(env.GEMINI_API_KEY),
        NODE_ENV: JSON.stringify(mode),
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      emptyOutDir: true,
      rollupOptions: {
        external: [
          'firebase-admin',
          'firebase-admin/firestore',
          'firebase-admin/storage',
          'google-auth-library',
          'googleapis',
          '@google-cloud/storage'
        ]
      }
    },
    ssr: {
      external: [
        'firebase-admin',
        'firebase-admin/firestore',
        'firebase-admin/storage',
        'google-auth-library',
        'googleapis',
        '@google-cloud/storage'
      ]
    },
    server: {
      port: 3000,
      host: '0.0.0.0',
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
