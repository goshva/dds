/** UI-2: локальный HTTP-сервер DSS. Слушает только 127.0.0.1. */
import { app } from "./app";

const HOST = "127.0.0.1";
const PORT = Number(process.env.DSS_API_PORT ?? 8787);

const server = Bun.serve({ hostname: HOST, port: PORT, fetch: app.fetch });

console.log(`[dss-api] read-only API on http://${server.hostname}:${server.port}`);
if (server.hostname !== HOST) {
  console.error(`[dss-api] ОСТАНОВКА: неожиданный bind ${server.hostname}`);
  server.stop(true);
  process.exit(1);
}