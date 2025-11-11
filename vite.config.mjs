import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: false, // Disable HMR to prevent reload issues
  },
  build: {
    outDir: 'dist',
  },
  // Use relative paths for Electron file:// protocol
  base: './',
});

