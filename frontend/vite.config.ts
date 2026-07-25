import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const fontsourceAssets = {
  name: 'redmine-kanban-fontsource-assets',
  enforce: 'pre' as const,
  transform(code: string, id: string) {
    if (!id.includes('/node_modules/@fontsource') || !id.endsWith('.css')) return;

    return code.replace(/url\((['"]?)([^'"()]+)\1\)/g, (_match, quote: string, url: string) => {
      const separator = url.includes('?') ? '&' : '?';
      return `url(${quote}${url}${separator}no-inline${quote})`;
    });
  },
};

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [fontsourceAssets, react()],
  define: mode === 'test'
    ? undefined
    : {
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
        assetFileNames: (assetInfo) => {
          const name = assetInfo.name || '';
          if (name.endsWith('.css')) return 'stylesheets/redmine_kanban_spa.css';
          if (name.match(/\.(woff2?|eot|ttf|otf)$/)) return 'fonts/[name][extname]';
          return 'assets/[name][extname]';
        },
      },
    },
    assetsInlineLimit: 0,
  },
}));
