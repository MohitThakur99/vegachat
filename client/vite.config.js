import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API_TARGET = process.env.VITE_DEV_API_TARGET ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Constants, the socket contract and permission rules shared with the server.
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    fs: { allow: ['..'] },
    // The browser talks to one origin in development too, so the refresh
    // cookie is first-party and no CORS is involved.
    proxy: {
      '/api': API_TARGET,
      '/socket.io': { target: API_TARGET, ws: true },
    },
  },
});
