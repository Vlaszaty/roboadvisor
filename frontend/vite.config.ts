import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    port: mode === 'cafe' ? 5741 : 5740,
    strictPort: true,
    proxy: { '/api': mode === 'cafe' ? 'http://localhost:8741' : 'http://localhost:8740' },
  },
  preview: {
    port: 5740,
    strictPort: true,
    proxy: { '/api': 'http://localhost:8740' },
  },
}));
