import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5740,
    strictPort: true,
    proxy: { '/api': 'http://localhost:8740' },
  },
  preview: { port: 5740, strictPort: true },
});
