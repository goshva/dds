import { defineConfig } from "vite";

/** UI-2: Vite обслуживает frontend и проксирует /api на локальный Hono (127.0.0.1). */
export default defineConfig({
  root: "src/web",
  publicDir: false,
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: "http://127.0.0.1:8787", changeOrigin: false },
    },
  },
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
    sourcemap: false,
  },
});