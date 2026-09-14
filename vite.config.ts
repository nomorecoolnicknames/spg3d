import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

const buildId = (() => {
  try {
    return `${execSync('git rev-parse --short HEAD').toString().trim()}-${new Date().toISOString().slice(0, 16)}`;
  } catch {
    return new Date().toISOString().slice(0, 16);
  }
})();

export default defineConfig({
  assetsInclude: ['**/*.glb'],
  base: './',
  define: { __BUILD_ID__: JSON.stringify(buildId) },
  plugins: [react()],
  server: { port: 3100, host: true },
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 4000,
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        manualChunks: { three: ['three'], react: ['react', 'react-dom'] },
      },
    },
  },
});
