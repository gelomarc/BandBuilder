import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// The build target is one self-contained HTML file: no server, no network, double-click to run.
export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: 'dist',
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 8000,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
})
