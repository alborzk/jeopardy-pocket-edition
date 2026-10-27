import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 127.0.0.1 rather than localhost: on Node 17+ localhost can resolve to ::1 while the server
// listens on IPv4 only.
const target = `http://127.0.0.1:${process.env.SERVER_PORT ?? 3001}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Reachable from phones on the same Wi-Fi.
    host: true,
    port: 5173,
    // The server prints the phone URL using this port, so don't silently pick another one.
    strictPort: true,
    // Single origin in development: the client and the socket share one URL.
    proxy: {
      '/socket.io': { target, ws: true, changeOrigin: true },
      '/api': { target, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
  },
});
