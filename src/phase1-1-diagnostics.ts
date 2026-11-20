/**
 * phase1-1-diagnostics.ts — Задача 2: транспортная диагностика Superset API.
 *
 * Слои: DNS → TCP → TLS → HTTP. Авторизация проверяется ТОЛЬКО если TLS/HTTP доступны.
 * Секреты не выводятся и не сохраняются.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { promises as dns } from "node:dns";
import * as net from "node:net";
import * as tls from "node:tls";

const HOST = "superset.svc.vkusvill.ru";
const PORT = 443;
const OUT = "reports/phase-01-1/api_transport_diagnostics.json";

type LayerResult = {
  layer: string;
  ok: boolean;
  duration_ms: number;
  error_code?: string;
  error_message?: string;
  details?: unknown;
};

function classifyNodeError(e: any): string {
  const code = e?.code ?? e?.errno ?? "";
  const msg = String(e?.message ?? e);
  if (code === "ENOTFOUND" || /getaddrinfo ENOTFOUND/i.test(msg)) return "DNS_NOT_FOUND";
  if (code === "EAI_AGAIN") return "DNS_TEMPORARY_FAILURE";
  if (code === "ECONNREFUSED") return "TCP_CONNECTION_REFUSED";
  if (code === "ETIMEDOUT" || /timed? ?out/i.test(msg)) return "TCP_TIMEOUT";
  if (code === "ENETUNREACH") return "IP_NET_UNREACHABLE";
  if (code === "EHOSTUNREACH") return "IP_HOST_UNREACHABLE";
  if (/ECONNRESET/i.test(code + msg)) return "TCP_CONNECTION_RESET";
  if (/certificate|CERT_/i.test(code + msg)) return "TLS_CERTIFICATE_ERROR";
  if (/handshake/i.test(msg)) return "TLS_HANDSHAKE_ERROR";
  return "UNKNOWN";
}

async function timed<T>(fn: () => Promise<T>): Promise<{ r?: T; e?: any; ms: number }> {
  const t0 = Date.now();
  try { return { r: await fn(), ms: Date.now() - t0 }; }
  catch (e: any) { return { e, ms: Date.now() - t0 }; }
}

async function main() {
  const layers: LayerResult[] = [];
  const env = {
    // только булевы признаки — без значений секретов
    SUPERSET_URL_configured: !!Bun.env.SUPERSET_URL,
    SUPERSET_USERNAME_configured: !!Bun.env.SUPERSET_USERNAME,
    SUPERSET_PASSWORD_configured: !!Bun.env.SUPERSET_PASSWORD,
    SUPERSET_ACCESS_TOKEN_configured: !!Bun.env.SUPERSET_ACCESS_TOKEN,
    proxy_env_present: ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"].filter(k => !!Bun.env[k]),
    no_proxy_present: ["NO_PROXY", "no_proxy"].filter(k => !!Bun.env[k]),
  };

  // ---- Layer 1: DNS ----
  let dnsOk = false;
  {
    const { r, e, ms } = await timed(() => dns.resolve4(HOST));
    if (r && r.length) {
      dnsOk = true;
      layers.push({ layer: "dns.A", ok: true, duration_ms: ms, details: { addresses: r } });
    } else {
      layers.push({ layer: "dns.A", ok: false, duration_ms: ms, error_code: classifyNodeError(e), error_message: String(e?.message ?? e) });
    }
    const { r: r6, e: e6, ms: ms6 } = await timed(() => dns.resolve6(HOST));
    layers.push(r6 && r6.length
      ? { layer: "dns.AAAA", ok: true, duration_ms: ms6, details: { addresses: r6 } }
      : { layer: "dns.AAAA", ok: false, duration_ms: ms6, error_code: classifyNodeError(e6), error_message: String(e6?.message ?? e6) });
  }

  // ---- Layer 2: TCP ----
  let tcpOk = false;
  if (dnsOk) {
    const { e, ms } = await timed(() => new Promise<void>((resolve, reject) => {
      const sock = net.connect({ host: HOST, port: PORT, timeout: 10000 }, () => { sock.destroy(); resolve(); });
      sock.on("error", (err) => { sock.destroy(); reject(err); });
      sock.on("timeout", () => { sock.destroy(); reject(new Error("socket timeout")); });
    }));
    tcpOk = !e;
    layers.push(e
      ? { layer: "tcp.443", ok: false, duration_ms: ms, error_code: classifyNodeError(e), error_message: String(e.message ?? e) }
      : { layer: "tcp.443", ok: true, duration_ms: ms });
  } else {
    layers.push({ layer: "tcp.443", ok: false, duration_ms: 0, error_code: "SKIPPED_DNS_FAILED", error_message: "DNS не разрешил имя — TCP не тестировался" });
  }

  // ---- Layer 3: TLS ----
  let tlsOk = false;
  if (tcpOk) {
    const { e, ms } = await timed(() => new Promise<any>((resolve, reject) => {
      const sock = tls.connect({ host: HOST, port: PORT, servername: HOST, timeout: 15000 }, () => {
        const cert = sock.getPeerCertificate();
        sock.destroy();
        resolve({ subject: cert?.subject, valid_to: cert?.valid_to, issuer: cert?.issuer });
      });
      sock.on("error", (err) => { sock.destroy(); reject(err); });
      sock.on("timeout", () => { sock.destroy(); reject(new Error("tls timeout")); });
    }));
    tlsOk = !e;
    layers.push(e
      ? { layer: "tls", ok: false, duration_ms: ms, error_code: classifyNodeError(e), error_message: String(e.message ?? e) }
      : { layer: "tls", ok: true, duration_ms: ms, details: e === undefined ? undefined : undefined });
    // fill details on success
    if (tlsOk) {
      const { r } = await timed(() => new Promise<any>((resolve, reject) => {
        const sock = tls.connect({ host: HOST, port: PORT, servername: HOST, timeout: 15000 }, () => {
          const cert = sock.getPeerCertificate();
          sock.destroy();
          resolve({ valid_to: cert?.valid_to, issuer: cert?.issuer });
        });
        sock.on("error", (err) => { sock.destroy(); reject(err); });
      }));
      layers[layers.length - 1].details = r;
    }
  } else {
    layers.push({ layer: "tls", ok: false, duration_ms: 0, error_code: "SKIPPED_TCP_FAILED", error_message: "TCP недоступен — TLS не тестировался" });
  }

  // ---- Layer 4: HTTP (без авторизации — проверяем, отвечает ли API-транспорт) ----
  let httpOk = false;
  let httpStatus: number | undefined;
  if (tlsOk) {
    const { r, e, ms } = await timed(async () => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15000);
      try {
        // /health и /api/v1/me/ — минимальные GET без тела
        const resp = await fetch(`https://${HOST}/health`, { signal: ctrl.signal });
        return { status: resp.status, body: (await resp.text()).slice(0, 200) };
      } finally { clearTimeout(t); }
    });
    if (r) {
      httpOk = true; httpStatus = r.status;
      layers.push({ layer: "http.GET_/health", ok: true, duration_ms: ms, details: { status: r.status, body_preview: r.body } });
    } else {
      layers.push({ layer: "http.GET_/health", ok: false, duration_ms: ms, error_code: classifyNodeError(e), error_message: String(e?.message ?? e) });
    }
  } else {
    layers.push({ layer: "http.GET_/health", ok: false, duration_ms: 0, error_code: "SKIPPED_TLS_FAILED", error_message: "TLS недоступен — HTTP не тестировался" });
  }

  // ---- Layer 5: Auth — только если транспорт доступен ----
  let authChecked = false;
  let authResult: any = { performed: false, reason: "transport_unavailable" };
  if (httpOk) {
    authChecked = true;
    try {
      const { SupersetClient } = await import("./superset");
      const { loadConfig } = await import("./config");
      const client = new SupersetClient(loadConfig());
      await client.login();
      authResult = { performed: true, login: "success" };
    } catch (e: any) {
      authResult = {
        performed: true,
        login: "failed",
        http_status: e?.status ?? null,
        error_class: e?.status ? `HTTP_${e.status}` : classifyNodeError(e),
        error_message: String(e?.message ?? e).slice(0, 300)
      };
    }
  }

  const verdict = !dnsOk ? "BLOCKED_DNS"
    : !tcpOk ? "BLOCKED_TCP"
    : !tlsOk ? "BLOCKED_TLS"
    : !httpOk ? "BLOCKED_HTTP"
    : !authChecked ? "BLOCKED_UNKNOWN"
    : authResult.login === "success" ? "TRANSPORT_AND_AUTH_OK" : "TRANSPORT_OK_AUTH_FAILED";

  const out = {
    generated_at: new Date().toISOString(),
    target: `https://${HOST}:${PORT}`,
    environment: env,
    layers,
    auth: authResult,
    verdict,
    interpretation: {
      ECONNREFUSED_note: "ECONNREFUSED в bun:fetch на Windows может маскировать отсутствие маршрута/VPN к internal-хосту; точная классификация — по слоям выше.",
      auth_vs_transport: "Ошибки транспорта (DNS/TCP/TLS) НЕ являются ошибками авторизации и не должны записываться как auth_failed."
    }
  };

  mkdirSync("reports/phase-01-1", { recursive: true });
  writeFileSync(OUT, JSON.stringify(out, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ verdict, layers: layers.map(l => ({ layer: l.layer, ok: l.ok, code: l.error_code ?? null })) }, null, 2));
}

main().catch(e => { console.error("[FATAL]", e); process.exit(1); });
