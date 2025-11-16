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
    port: 5174,
    strictPort: true,
    hmr: false, // Disable HMR to prevent reload issues
  },
  build: {
    outDir: 'dist',
    // Ensure public files are copied
    copyPublicDir: true,
    // Rollup options to ensure all files are included
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
      },
    },
  },
  // Public directory configuration
  publicDir: 'public',
  // Use relative paths for Electron file:// protocol
  base: './',
});

