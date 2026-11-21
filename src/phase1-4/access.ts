/**
 * Этап 1.4, фаза 1.4.1 — проверка доступа к Superset (read-only).
 *
 * Последовательно проверяет DNS → TCP → TLS → HTTP → auth → read-only spot checks.
 * Секреты не выводятся и не сохраняются. Отчёты пишутся только в reports/phase-01-4/.
 */
import { promises as dns } from "node:dns";
import * as net from "node:net";
import * as tls from "node:tls";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, type Config } from "../config";
import { SupersetClient } from "../superset";

const OUT_DIR = "reports/phase-01-4";
const OUT_MD = join(OUT_DIR, "01_superset_access_report.md");
const OUT_JSON = join(OUT_DIR, "01_superset_access_report.json");

type AccessStatus =
  | "NETWORK_UNREACHABLE"
  | "DNS_ERROR"
  | "TLS_ERROR"
  | "HTTP_ERROR"
  | "AUTH_REQUIRED"
  | "AUTH_FAILED"
  | "API_UNAVAILABLE"
  | "ACCESS_OK";

type Layer = {
  layer: string;
  ok: boolean;
  duration_ms: number;
  status?: number | null;
  error_code?: string | null;
  error_message?: string | null;
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
  try {
    return { r: await fn(), ms: Date.now() - t0 };
  } catch (e: any) {
    return { e, ms: Date.now() - t0 };
  }
}

function readJson(path: string): any | null {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
  } catch {
    return null;
  }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const cfg = loadConfig();
  const url = new URL(cfg.baseUrl);
  const host = url.hostname;
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  const isHttps = url.protocol === "https:";

  const layers: Layer[] = [];
  const started = Date.now();

  // Layer 1: DNS
  let dnsOk = false;
  let addresses: string[] = [];
  {
    const { r, e, ms } = await timed(() => dns.resolve4(host));
    if (r && r.length) {
      dnsOk = true;
      addresses = r;
      layers.push({ layer: "dns.A", ok: true, duration_ms: ms, details: { addresses: r } });
    } else {
      layers.push({ layer: "dns.A", ok: false, duration_ms: ms, error_code: classifyNodeError(e), error_message: String(e?.message ?? e) });
    }
    const { r: r6, e: e6, ms: ms6 } = await timed(() => dns.resolve6(host));
    layers.push(
      r6 && r6.length
        ? { layer: "dns.AAAA", ok: true, duration_ms: ms6, details: { addresses: r6 } }
        : { layer: "dns.AAAA", ok: false, duration_ms: ms6, error_code: classifyNodeError(e6), error_message: String(e6?.message ?? e6) },
    );
  }

  // Layer 2: TCP
  let tcpOk = false;
  if (dnsOk) {
    const { e, ms } = await timed(
      () =>
        new Promise<void>((resolve, reject) => {
          const sock = net.connect({ host, port, timeout: 8000 }, () => {
            sock.destroy();
            resolve();
          });
          sock.on("error", (err) => {
            sock.destroy();
            reject(err);
          });
          sock.on("timeout", () => {
            sock.destroy();
            reject(new Error("socket timeout"));
          });
        }),
    );
    tcpOk = !e;
    layers.push(
      e
        ? { layer: "tcp", ok: false, duration_ms: ms, error_code: classifyNodeError(e), error_message: String(e.message ?? e) }
        : { layer: "tcp", ok: true, duration_ms: ms, details: { host, port } },
    );
  } else {
    layers.push({ layer: "tcp", ok: false, duration_ms: 0, error_code: "SKIPPED_DNS_FAILED", error_message: "DNS не разрешил имя" });
  }

  // Layer 3: TLS
  let tlsOk = false;
  if (tcpOk && isHttps) {
    const { r, e, ms } = await timed(
      () =>
        new Promise<any>((resolve, reject) => {
          const sock = tls.connect({ host, port, servername: host, timeout: 10000 }, () => {
            const cert = sock.getPeerCertificate();
            sock.destroy();
            resolve({ valid_to: cert?.valid_to ?? null, issuer: cert?.issuer?.CN ?? null, subject: cert?.subject?.CN ?? null });
          });
          sock.on("error", (err) => {
            sock.destroy();
            reject(err);
          });
          sock.on("timeout", () => {
            sock.destroy();
            reject(new Error("tls timeout"));
          });
        }),
    );
    tlsOk = !e;
    layers.push(
      e
        ? { layer: "tls", ok: false, duration_ms: ms, error_code: classifyNodeError(e), error_message: String(e.message ?? e) }
        : { layer: "tls", ok: true, duration_ms: ms, details: r },
    );
  } else if (!isHttps) {
    tlsOk = true;
    layers.push({ layer: "tls", ok: true, duration_ms: 0, details: { note: "http, TLS не применяется" } });
  } else {
    layers.push({ layer: "tls", ok: false, duration_ms: 0, error_code: "SKIPPED_TCP_FAILED", error_message: "TCP недоступен" });
  }

  // Layer 4: HTTP base/health
  let httpOk = false;
  let httpStatus: number | null = null;
  if (tlsOk) {
    for (const path of ["/health", "/"]) {
      const { r, e, ms } = await timed(async () => {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 10000);
        try {
          const resp = await fetch(new URL(path, cfg.baseUrl), { signal: ctrl.signal, redirect: "manual" });
          const text = await resp.text();
          return { status: resp.status, preview: text.slice(0, 120) };
        } finally {
          clearTimeout(t);
        }
      });
      if (r) {
        httpStatus = r.status;
        const ok = r.status < 500;
        layers.push({ layer: `http.GET_${path}`, ok, duration_ms: ms, status: r.status, details: { preview_len: r.preview.length } });
        if (ok) {
          httpOk = true;
          break;
        }
      } else {
        layers.push({ layer: `http.GET_${path}`, ok: false, duration_ms: ms, error_code: classifyNodeError(e), error_message: String(e?.message ?? e) });
      }
    }
  } else {
    layers.push({ layer: "http", ok: false, duration_ms: 0, error_code: "SKIPPED_TLS_FAILED", error_message: "TLS недоступен" });
  }

  // Layer 5: auth + spot checks
  const auth: any = { attempted: false, login: null, error_status: null, error_class: null, spot_checks: {} };
  let spotOk = false;
  if (httpOk) {
    auth.attempted = true;
    const reduced: Config = { ...cfg, maxRetries: 1, retryBaseDelayMs: 500, timeoutMs: 8000, rateLimitMs: 0 };
    const client = new SupersetClient(reduced);
    try {
      await client.login();
      auth.login = "success";

      const dashboards = readJson("output/dashboards.json");
      const dashboardId = dashboards?.result?.[0]?.id ?? null;
      const spot = readJson("reports/phase-01-1/api_spot_checks.json");
      const chartId = spot?.chart_list_order_probe?.first_two_ids?.[0] ?? null;
      const datasetId = 4732;

      const checks: Array<{ type: string; id: number }> = [
        { type: "dataset", id: datasetId },
        ...(chartId ? [{ type: "chart", id: Number(chartId) }] : []),
        ...(dashboardId ? [{ type: "dashboard", id: Number(dashboardId) }] : []),
      ];
      let okCount = 0;
      for (const c of checks) {
        try {
          const data = await client.detail(c.type as any, c.id);
          const hasResult = Boolean(data?.result);
          auth.spot_checks[`${c.type}/${c.id}`] = { ok: hasResult, result_keys: hasResult ? Object.keys(data.result).length : 0 };
          if (hasResult) okCount++;
        } catch (e: any) {
          auth.spot_checks[`${c.type}/${c.id}`] = { ok: false, status: e?.status ?? null, error_class: e?.status ? `HTTP_${e.status}` : (e?.error_type ?? classifyNodeError(e)) };
        }
      }
      spotOk = okCount === checks.length && checks.length >= 3;
    } catch (e: any) {
      const status = e?.status ?? null;
      auth.login = status === 401 ? "failed" : "error";
      auth.error_status = status;
      auth.error_class = status ? `HTTP_${status}` : (e?.error_type ?? classifyNodeError(e));
    }
  } else {
    auth.skipped_reason = "HTTP transport unavailable";
  }

  const hasCredentials = Boolean((cfg.username && cfg.password) || cfg.accessToken);
  let status: AccessStatus;
  if (!dnsOk) status = "DNS_ERROR";
  else if (!tcpOk) status = "NETWORK_UNREACHABLE";
  else if (!tlsOk) status = "TLS_ERROR";
  else if (!httpOk) status = "HTTP_ERROR";
  else if (!hasCredentials) status = "AUTH_REQUIRED";
  else if (auth.login === "success" && spotOk) status = "ACCESS_OK";
  else if (auth.login === "success" && !spotOk) status = "API_UNAVAILABLE";
  else if (auth.error_status === 401) status = "AUTH_FAILED";
  else status = "API_UNAVAILABLE";

  const out = {
    generated_at: new Date().toISOString(),
    phase: "1.4.1",
    target: { host, port, protocol: url.protocol, base_url_configured: true },
    credentials_present: hasCredentials,
    status,
    duration_ms: Date.now() - started,
    layers,
    auth,
    spot_checks_ok: spotOk,
    interpretation: {
      note: "Секреты не выводятся. Исторический успешный вход не подтверждает текущую доступность.",
      read_only: true,
    },
  };
  writeFileSync(OUT_JSON, JSON.stringify(out, null, 2), { mode: 0o600 });

  const md: string[] = [];
  md.push("# Фаза 1.4.1 — Доступ к Superset (read-only)");
  md.push("");
  md.push(`Сгенерировано: ${out.generated_at}`);
  md.push(`Цель: \`${url.protocol}//${host}:${port}\``);
  md.push(`Credentials присутствуют: ${hasCredentials ? "да" : "нет"} (значения не выводятся).`);
  md.push("");
  md.push(`## Итоговый статус: **${status}**`);
  md.push("");
  md.push("## Слои");
  md.push("");
  md.push("| Слой | OK | мс | Статус/код | Детали |");
  md.push("|---|---:|---:|---|---|");
  for (const l of layers) {
    md.push(`| ${l.layer} | ${l.ok} | ${l.duration_ms} | ${l.status ?? l.error_code ?? "—"} | ${l.details ? JSON.stringify(l.details) : (l.error_message ?? "—")} |`);
  }
  md.push("");
  md.push("## Авторизация и spot checks");
  md.push("");
  md.push(`- auth attempted: ${auth.attempted}`);
  md.push(`- login: ${auth.login ?? "—"}`);
  md.push(`- error: ${auth.error_class ?? "—"}${auth.error_status ? ` (HTTP ${auth.error_status})` : ""}`);
  md.push(`- spot checks ok: ${spotOk}`);
  for (const [k, v] of Object.entries(auth.spot_checks ?? {})) md.push(`  - ${k}: ${JSON.stringify(v)}`);
  md.push("");
  md.push("## Gate G1");
  md.push("");
  md.push(status === "ACCESS_OK" ? "G1 = PASS: массовый read-only сбор разрешён." : `G1 = BLOCKED: массовый сбор не выполняется. Только локальная работа.`);
  md.push("");
  writeFileSync(OUT_MD, md.join("\n"), { mode: 0o600 });

  console.log(JSON.stringify({ status, layers: layers.map((l) => ({ layer: l.layer, ok: l.ok, code: l.error_code ?? l.status ?? null })), auth: { attempted: auth.attempted, login: auth.login, error_class: auth.error_class }, spot_checks_ok: spotOk, reports: [OUT_JSON, OUT_MD] }, null, 2));
}

main().catch((e) => {
  console.error("[FATAL]", e);
  process.exit(1);
});
