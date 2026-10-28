import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Builds into extension/ so the unpacked load path, and therefore the extension ID, stays the same.
export default defineConfig({
  base: './',
  publicDir: 'public',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'extension',
    emptyOutDir: true,
    rolldownOptions: {
      input: { dashboard: 'dashboard.html', background: 'src/background/index.ts' },
      output: {
        entryFileNames: chunk => chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js',
      },
    },
  },
});
