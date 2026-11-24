/** UI-2/2.2: Hono-приложение DSS (read-only API, локальный bind). */
import { Hono } from "hono";

import { toErrorResponse } from "./api";
import { apiRoutes } from "./routes";

const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
/** R2: точный allowlist origin — схема, хост и порт сверяются целиком. */
const ALLOWED_ORIGINS = new Set(["http://127.0.0.1:5173", "http://localhost:5173"]);

function hostName(rawHost: string | undefined): string | null {
  if (!rawHost) return null;
  const host = rawHost.trim().toLowerCase();
  return host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0]!;
}

function hostAllowed(rawHost: string | undefined): boolean {
  // Реальный HTTP/1.1 всегда передаёт Host; отсутствие возможно только во внутренних вызовах.
  if (!rawHost) return true;
  const name = hostName(rawHost);
  return name !== null && ALLOWED_HOSTS.has(name);
}

/** R2: разбор через URL, полное сравнение origin; "null" и мусор отклоняются. */
function originAllowed(rawOrigin: string | undefined, rawHost: string | undefined): boolean {
  if (!rawOrigin) return true;
  const value = rawOrigin.trim();
  if (value === "" || value.toLowerCase() === "null") return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.origin === "null") return false;
  const normalized = parsed.origin.toLowerCase();
  if (ALLOWED_ORIGINS.has(normalized)) return true;
  // same-origin допускается только при точном совпадении с Host запроса (loopback)
  const host = rawHost?.trim().toLowerCase();
  if (host && parsed.protocol === "http:" && ALLOWED_HOSTS.has(parsed.hostname.toLowerCase()) && normalized === `http://${host}`) return true;
  return false;
}

export function createApp() {
  const app = new Hono();
  app.use("*", async (context, next) => {
    await next();
    context.header("Cache-Control", "no-store");
    context.header("X-Content-Type-Options", "nosniff");
    context.header("Referrer-Policy", "no-referrer");
  });
  app.use("/api/*", async (context, next) => {
    if (!hostAllowed(context.req.header("host"))) {
      const eventId = crypto.randomUUID();
      console.error(`[dss-api] code=HOST_NOT_ALLOWED event=${eventId}`);
      return context.json({ status: "error", error: { code: "HOST_NOT_ALLOWED", message: "Host is not allowed", eventId } }, 403);
    }
    if (!originAllowed(context.req.header("origin"), context.req.header("host"))) {
      const eventId = crypto.randomUUID();
      console.error(`[dss-api] code=ORIGIN_NOT_ALLOWED event=${eventId}`);
      return context.json({ status: "error", error: { code: "ORIGIN_NOT_ALLOWED", message: "Origin is not allowed", eventId } }, 403);
    }
    await next();
  });
  app.route("/", apiRoutes);
  app.notFound((context) => {
    const eventId = crypto.randomUUID();
    console.error(`[dss-api] code=NOT_FOUND event=${eventId}`);
    return context.json({ status: "error", error: { code: "NOT_FOUND", message: "Endpoint not found", eventId } }, 404);
  });
  app.onError((error, context) => {
    const response = toErrorResponse(error);
    // R6: в лог — только код и идентификатор события, без сырых сообщений, путей и SQL.
    const eventId = crypto.randomUUID();
    console.error(`[dss-api] code=${response.body.error.code} event=${eventId}`);
    return context.json({ status: "error", error: { code: response.body.error.code, message: response.body.error.message, eventId } }, response.status as 500);
  });
  return app;
}

export const app = createApp();