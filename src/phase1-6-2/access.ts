/**
 * Этап 1.6.2, Этап A — матрица доступных возможностей Superset.
 * Только штатные GET-интерфейсы и пробные read-only POST (SELECT 1), без обхода RBAC.
 * Результат: reports/phase-01-6-2/superset_access_matrix.json
 */
import { join } from "node:path";
import { loadConfig } from "../config";
import { SqlLabClient } from "../phase1-6/client";
import { REPORTS, SNAP, ensureDir, nowIso, readJson, writeJson } from "./utils";

type Probe = {
  id: string;
  capability: "connectivity" | "auth" | "metadata" | "filters" | "values" | "sql_lab" | "chart_data" | "databases";
  endpoint: string;
  method: "GET" | "POST";
  purpose: string;
  http_status: number | null;
  ok: boolean;
  duration_ms: number;
  error: string | null;
  preview: string | null;
  notes: string | null;
};

const PROBES: Array<Omit<Probe, "http_status" | "ok" | "duration_ms" | "error" | "preview">> = [
  { id: "P01", capability: "connectivity", endpoint: "/health", method: "GET", purpose: "DNS/TCP/TLS и доступность Superset", notes: null },
  { id: "P02", capability: "auth", endpoint: "/api/v1/security/login", method: "POST", purpose: "Аутентификация (без сохранения токена)", notes: "token не сохраняется" },
  { id: "P03", capability: "auth", endpoint: "/api/v1/security/csrf_token/", method: "GET", purpose: "CSRF-токен", notes: null },
  { id: "P04", capability: "metadata", endpoint: "/api/v1/me/", method: "GET", purpose: "Профиль и роли текущего пользователя", notes: null },
  { id: "P05", capability: "metadata", endpoint: "/api/v1/dataset/?q=(page:0,page_size:1)", method: "GET", purpose: "Каталог датасетов (count)", notes: null },
  { id: "P06", capability: "metadata", endpoint: "/api/v1/dataset/4732", method: "GET", purpose: "Детальные метаданные P0-датасета", notes: null },
  { id: "P07", capability: "metadata", endpoint: "/api/v1/dataset/4732/related_objects", method: "GET", purpose: "Связанные объекты датасета", notes: null },
  { id: "P08", capability: "metadata", endpoint: "/api/v1/chart/?q=(page:0,page_size:1)", method: "GET", purpose: "Каталог чартов (count)", notes: null },
  { id: "P09", capability: "metadata", endpoint: "/api/v1/chart/28360", method: "GET", purpose: "Детальные метаданные чарта", notes: null },
  { id: "P10", capability: "metadata", endpoint: "/api/v1/dashboard/?q=(page:0,page_size:1)", method: "GET", purpose: "Каталог дашбордов (count)", notes: null },
  { id: "P11", capability: "metadata", endpoint: "/api/v1/dashboard/1680", method: "GET", purpose: "Детальные метаданные дашборда", notes: null },
  { id: "P12", capability: "filters", endpoint: "/api/v1/dashboard/1680/charts", method: "GET", purpose: "Чарты дашборда с form_data (фильтры, метрики)", notes: null },
  { id: "P13", capability: "filters", endpoint: "/api/v1/dashboard/1680/filters", method: "GET", purpose: "Значения фильтров дашборда", notes: null },
  { id: "P14", capability: "filters", endpoint: "/api/v1/dashboard/1680/filter_state", method: "GET", purpose: "Состояние фильтров дашборда", notes: null },
  { id: "P15", capability: "filters", endpoint: "/api/v1/dashboard/1680/datasets", method: "GET", purpose: "Датасеты дашборда", notes: null },
  { id: "P16", capability: "values", endpoint: "/api/v1/dataset/4732/values/?column_name=order_status", method: "GET", purpose: "Уникальные значения колонки", notes: null },
  { id: "P17", capability: "values", endpoint: "/api/v1/datasource/table/4732/values/?column_name=order_status", method: "GET", purpose: "Уникальные значения колонки (альтернативный маршрут)", notes: null },
  { id: "P18", capability: "values", endpoint: "/api/v1/dataset/4732/column/order_status/values", method: "GET", purpose: "Уникальные значения колонки (альтернативный маршрут)", notes: null },
  { id: "P18b", capability: "values", endpoint: "/api/v1/datasource/table/4732/column/order_status/values", method: "GET", purpose: "Уникальные значения колонки (маршрут, вернувший 403 в этапе 1.6)", notes: null },
  { id: "P18c", capability: "values", endpoint: "/api/v1/datasource/table/4732/column/order_status/values/", method: "GET", purpose: "Уникальные значения колонки (со слэшем)", notes: null },
  { id: "P19", capability: "sql_lab", endpoint: "/api/v1/sqllab/", method: "GET", purpose: "Доступ к SQL Lab", notes: null },
  { id: "P20", capability: "sql_lab", endpoint: "/api/v1/sqllab/execute/", method: "POST", purpose: "Выполнение SELECT 1 (БД 92)", notes: "только SELECT 1, без DML" },
  { id: "P21", capability: "sql_lab", endpoint: "/api/v1/sqllab/estimate/", method: "POST", purpose: "Оценка запроса (БД 92)", notes: "только SELECT 1" },
  { id: "P22", capability: "chart_data", endpoint: "/api/v1/chart/data", method: "POST", purpose: "Данные чарта (агрегат COUNT по 4732)", notes: "только COUNT, без выгрузки строк" },
  { id: "P23", capability: "databases", endpoint: "/api/v1/database/?q=(page:0,page_size:50)", method: "GET", purpose: "Список доступных баз данных", notes: null },
  { id: "P24", capability: "databases", endpoint: "/api/v1/database/92", method: "GET", purpose: "Доступ к БД 92 (ClickHouse)", notes: null },
  { id: "P25", capability: "databases", endpoint: "/api/v1/database/76", method: "GET", purpose: "Доступ к БД 76 (Greenplum)", notes: null },
  { id: "P26", capability: "metadata", endpoint: "/api/v1/query/?q=(page:0,page_size:100)", method: "GET", purpose: "Сохранённые запросы и история SQL", notes: null },
];

function previewOf(body: any, text: string): string {
  try {
    const s = JSON.stringify(body ?? text);
    return s.length > 400 ? s.slice(0, 400) + "…" : s;
  } catch {
    return String(text).slice(0, 400);
  }
}

async function main() {
  const cfg = loadConfig();
  const client = new SqlLabClient(cfg);
  const started = nowIso();
  const probes: Probe[] = [];
  const auth: any = { login: "not_attempted", csrf: "not_attempted" };

  const base = new URL(cfg.baseUrl);
  const connectivity: any = {
    base_url: cfg.baseUrl,
    host: base.hostname,
    protocol: base.protocol,
    dns_tcp_tls: "not_checked",
    health_status: null,
    health_ms: null,
    vpn_observable: false,
    vpn_note: "Состояние VPN из процесса не определяется; доступность проверяется фактическими HTTPS-запросами.",
  };

  // P01 health — до логина, чтобы отделить сетевую доступность от авторизации.
  {
    const t0 = Date.now();
    try {
      const r = await client.get("/health");
      connectivity.dns_tcp_tls = "OK";
      connectivity.health_status = r.status;
      connectivity.health_ms = Date.now() - t0;
      probes.push({
        id: "P01", capability: "connectivity", endpoint: "/health", method: "GET",
        purpose: "DNS/TCP/TLS и доступность Superset", http_status: r.status, ok: r.ok,
        duration_ms: Date.now() - t0, error: null, preview: previewOf(r.body, r.text), notes: null,
      });
    } catch (e: any) {
      connectivity.dns_tcp_tls = "FAILED";
      probes.push({
        id: "P01", capability: "connectivity", endpoint: "/health", method: "GET",
        purpose: "DNS/TCP/TLS и доступность Superset", http_status: null, ok: false,
        duration_ms: Date.now() - t0, error: String(e?.message ?? e), preview: null, notes: null,
      });
    }
  }

  try {
    await client.login();
    auth.login = "OK";
  } catch (e: any) {
    auth.login = "FAILED";
    auth.login_error = String(e?.message ?? e);
  }
  try {
    const csrf = await client.getCsrf();
    auth.csrf = csrf.status === 200 ? "OK" : `HTTP ${csrf.status}`;
  } catch (e: any) {
    auth.csrf = `FAILED: ${String(e?.message ?? e)}`;
  }

  for (const p of PROBES) {
    if (p.id === "P01") continue;
    const t0 = Date.now();
    const path = p.endpoint.replace("(page:0,page_size:1)", encodeURIComponent("(page:0,page_size:1)")).replace("(page:0,page_size:50)", encodeURIComponent("(page:0,page_size:50)")).replace("(page:0,page_size:100)", encodeURIComponent("(page:0,page_size:100)"));
    try {
      let r: { status: number; ok: boolean; body: any; text: string };
      if (p.id === "P02") {
        // повторный логин не нужен: факт успешной аутентификации уже зафиксирован
        probes.push({
          id: p.id, capability: p.capability, endpoint: p.endpoint, method: p.method, purpose: p.purpose,
          http_status: auth.login === "OK" ? 200 : null, ok: auth.login === "OK", duration_ms: Date.now() - t0,
          error: auth.login === "OK" ? null : String(auth.login_error ?? "login failed"), preview: null,
          notes: "токен не сохраняется в артефактах",
        });
        continue;
      }
      if (p.method === "GET") {
        r = await client.get(path);
      } else if (p.id === "P20") {
        r = await client.post(path, { database_id: 92, sql: "SELECT 1 AS probe", json: true, runAsync: false, schema: null, expand_data: true, select_as_cta: false, client_id: crypto.randomUUID(), queryLimit: 10 });
      } else if (p.id === "P21") {
        r = await client.post(path, { database_id: 92, sql: "SELECT 1", schema: null });
      } else {
        r = await client.post(path, {
          datasource: { id: 4732, type: "table" },
          queries: [{ granularity: "date_order", groupby: [], metrics: [{ expressionType: "SIMPLE", column: { column_name: "id_order" }, aggregate: "COUNT", label: "cnt" }], time_range: "No filter", row_limit: 10, is_timeseries: false }],
          form_data: { datasource: "4732__table", viz_type: "table", time_range: "No filter" },
          result_type: "full", result_format: "json",
        });
      }
      probes.push({
        id: p.id, capability: p.capability, endpoint: p.endpoint, method: p.method, purpose: p.purpose,
        http_status: r.status, ok: r.ok, duration_ms: Date.now() - t0,
        error: r.ok ? null : previewOf(r.body, r.text), preview: previewOf(r.body, r.text), notes: p.notes,
      });
    } catch (e: any) {
      probes.push({
        id: p.id, capability: p.capability, endpoint: p.endpoint, method: p.method, purpose: p.purpose,
        http_status: null, ok: false, duration_ms: Date.now() - t0, error: String(e?.message ?? e), preview: null, notes: p.notes,
      });
    }
  }

  const byId = (id: string) => probes.find((p) => p.id === id);
  const cap = (ids: string[]) => {
    const items = ids.map(byId).filter(Boolean) as Probe[];
    if (!items.length) return "NOT_TESTED";
    if (items.some((p) => p.ok)) return "AVAILABLE";
    if (items.some((p) => p.http_status === 403 || p.http_status === 401)) return "FORBIDDEN";
    if (items.some((p) => p.http_status === 404 || p.http_status === 405)) return "NOT_FOUND";
    return "UNAVAILABLE";
  };

  const capabilities = {
    metadata_datasets: cap(["P05", "P06"]),
    metadata_charts: cap(["P08", "P09"]),
    metadata_dashboards: cap(["P10", "P11"]),
    related_objects: cap(["P07"]),
    dashboard_charts_form_data: cap(["P12"]),
    dashboard_datasets: cap(["P15"]),
    dashboard_filter_values: cap(["P13", "P14"]),
    column_values: cap(["P16", "P17", "P18", "P18b", "P18c"]),
    sql_lab: cap(["P19", "P20", "P21"]),
    chart_data: cap(["P22"]),
    databases: cap(["P23", "P24", "P25"]),
    saved_queries: cap(["P26"]),
  };

  const dbList = byId("P23");
  const dbCount = (() => {
    try {
      const m = String(dbList?.preview ?? "").match(/"count"\s*:\s*(\d+)/);
      return m ? Number(m[1]) : null;
    } catch {
      return null;
    }
  })();

  if (dbCount === 0) capabilities.databases = "NO_VISIBLE_DATABASES" as any;

  // Значения фильтров нельзя получить отдельным эндпоинтом (P13/P14 → 405),
  // но они содержатся в json_metadata деталей дашбордов — это отдельная возможность.
  const dashboardsDetail = readJson<any[]>(join(SNAP, "dashboards.detail.json")) ?? [];
  const nativeFilters = dashboardsDetail.reduce((n, d) => n + (Array.isArray(d?.native_filters) ? d.native_filters.length : 0), 0);
  (capabilities as any).dashboard_filter_values_via_detail = nativeFilters > 0 ? "AVAILABLE" : "NOT_AVAILABLE";
  (capabilities as any).dashboard_native_filters_count = nativeFilters;

  const out = {
    generated_at: started,
    finished_at: nowIso(),
    phase: "1.6.2",
    mode: "read-only",
    connectivity,
    auth,
    capabilities,
    databases_visible_count: dbCount,
    probes,
    summary: {
      total_probes: probes.length,
      ok: probes.filter((p) => p.ok).length,
      forbidden: probes.filter((p) => p.http_status === 403 || p.http_status === 401).length,
      not_found: probes.filter((p) => p.http_status === 404 || p.http_status === 405).length,
      errors: probes.filter((p) => p.http_status === null).length,
    },
    notes: [
      "Доступность HTTP 200 не считается доказательством права выполнять SQL.",
      "POST-пробы — только SELECT 1 / COUNT; DML и DDL не выполнялись.",
      "RBAC не обходился: использовалась только штатная учётная запись API.",
    ],
  };

  ensureDir(join(REPORTS, "evidence"));
  writeJson(join(REPORTS, "superset_access_matrix.json"), out);
  console.log(JSON.stringify({ capabilities, summary: out.summary, databases_visible_count: dbCount }, null, 2));
}

main();
