import { fileURLToPath } from 'node:url';
import { devias } from '@devias/studio/vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import deviasConfig from '../../devias.config';

const apiUrl = process.env.VITE_API_URL ?? 'http://localhost:3000';

export default defineConfig({
  // `devias()` turns the modules in devias.config.ts into `virtual:devias/modules`.
  plugins: [react(), tailwindcss(), devias(deviasConfig)],
  resolve: {
    // Workspace packages are consumed as source; make sure they share one React.
    dedupe: ['react', 'react-dom', 'react/jsx-runtime', '@tanstack/react-query', '@tanstack/react-router'],
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': {
        target: apiUrl,
        changeOrigin: false,
        // Server-sent events must not be buffered.
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
              proxyRes.headers['cache-control'] = 'no-cache';
              proxyRes.headers['x-accel-buffering'] = 'no';
            }
          });
        },
      },
    },
  },
});
