// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: [
      'prettier/parser-babel',
      'prettier/parser-html',
      'prettier/parser-postcss'
    ]
  }
});