import { defineConfig } from "vite";

/**
 * UI-2: Vite обслуживает frontend и проксирует API на локальный Hono (127.0.0.1).
 *
 * UI-7.0.1 (D-002): прокси настраивается точечно по реально используемым маршрутам Hono
 * (/api/health, /api/v1/*), а не префиксом "/api". Иначе запрос Vite-модуля
 * /api/client.ts (src/web/api/client.ts) перехватывался прокси и возвращал 404 от Hono.
 */
export default defineConfig({
  root: "src/web",
  publicDir: false,
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api/health": { target: "http://127.0.0.1:8787", changeOrigin: false },
      "/api/v1": { target: "http://127.0.0.1:8787", changeOrigin: false },
    },
  },
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
    sourcemap: false,
  },
});