import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env': JSON.stringify({ NODE_ENV: 'production' }),
  },
  build: {
    outDir: path.resolve(__dirname, '../assets'),
    emptyOutDir: false,
    lib: {
      entry: path.resolve(__dirname, 'src/main.tsx'),
      name: 'RedmineKanban',
      formats: ['umd'],
      fileName: () => 'javascripts/redmine_kanban_spa.js',
    },
    rollupOptions: {
      output: {
        // Enforce IIFE wrapping to prevent scoped variables from leaking (e.g. minified '$')
        assetFileNames: (assetInfo) => {
          const name = assetInfo.name || '';
          if (name.endsWith('.css')) return 'stylesheets/redmine_kanban_spa.css';
          return 'assets/[name][extname]';
        },
      },
    },
  },
});
