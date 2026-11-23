/**
 * Этап 1.9 — проверка коннектора и получение полной картины по даркстору 7745.
 *
 * Использует СУЩЕСТВУЮЩИЙ в репозитории Superset-коннектор:
 *   - src/superset.ts        (SupersetClient: login + GET metadata)
 *   - src/phase1-6/client.ts (SqlLabClient: POST /sqllab/execute/, POST /chart/data)
 *
 * Логин и пароль берутся из .env (Bun.env.SUPERSET_USERNAME / SUPERSET_PASSWORD).
 * Read-only: никаких изменений БД и объектов Superset.
 *
 * Запуск:
 *   bun run src/check-darkstore-7745.ts
 *   DARKSTORE=8161 bun run src/check-darkstore-7745.ts   # другой даркстор
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config";
import { SupersetClient } from "./superset";
import { SqlLabClient } from "./phase1-6/client";

const DARKSTORE = Number(process.env.DARKSTORE ?? "7745");
const OUT_DIR = "reports/phase-01-9";

// Чарты, связанные с даркстором 7745 (см. output/charts.json / lineage_relations.csv).
// ds = dataset_id, на который чарт опирается.
const CHARTS: Array<{ id: number; title: string; ds: number }> = [
  { id: 27050, title: "Накопительный итог куст 7745", ds: 3035 },
  { id: 27137, title: "Динамика по часам - 7745", ds: 3035 },
  { id: 27074, title: "Доли сервисов куст 7745", ds: 3035 },
  { id: 27044, title: "Накопительный итог - 7745", ds: 3035 },
  { id: 25377, title: "Тест 7745 30 минут", ds: 3035 },
  { id: 23823, title: "Отчет по сервисам ДС 5017, 5848, 7745 и 8464", ds: 3035 },
  { id: 28713, title: "Предфасовка 7745", ds: 5454 },
];

type ProbeResult = {
  label: string;
  method: "GET" | "POST";
  endpoint: string;
  ok?: boolean;
  http_status?: number;
  error?: string;
  preview?: string;
};

async function main() {
  const cfg = loadConfig();
  mkdirSync(OUT_DIR, { recursive: true });

  const report: any = {
    generated_at: new Date().toISOString(),
    darkstore: DARKSTORE,
    superset_url: cfg.baseUrl,
    auth_mode: "username-password",
    steps: [] as any[],
    verdict: null as string | null,
  };
  const save = () =>
    writeFileSync(join(OUT_DIR, `darkstore_${DARKSTORE}_check.json`), JSON.stringify(report, null, 2));

  // ────────────────────────────────────────────────────────────────
  // ШАГ 1. Сессия по логину/паролю из .env → токен (GET-коннектор)
  // ────────────────────────────────────────────────────────────────
  const meta = new SupersetClient(cfg);
  try {
    await meta.login();
    console.log(`[1] LOGIN (SupersetClient): OK via ${cfg.baseUrl}`);
    report.steps.push({ step: "login", client: "SupersetClient", status: "OK" });
  } catch (e: any) {
    report.verdict = "LOGIN_FAILED";
    report.steps.push({ step: "login", error: String(e?.message ?? e) });
    save();
    console.error("[1] LOGIN FAILED:", e?.message ?? e);
    return;
  }

  // ────────────────────────────────────────────────────────────────
  // ШАГ 2. Метаданные датасетов 7745 через GET detail (работает)
  //   3035 → mart_mixed.darkstore_time_click (ClickHouse, db 92)
  //   5454 → Report.Предфасовка 7745 (db 6)
  // ────────────────────────────────────────────────────────────────
  for (const dsId of [3035, 5454]) {
    try {
      const d = await meta.detail("dataset", dsId);
      const r = d?.result ?? d;
      const cols = (r.columns ?? []).map((c: any) => c.column_name);
      console.log(
        `[2] dataset ${dsId}: table=${r.table_name} schema=${r.schema} db=${r.database?.database_name}(id=${r.database?.id}) kind=${r.kind} cols=${cols.length}`,
      );
      report.steps.push({
        step: "dataset_detail",
        dataset_id: dsId,
        table_name: r.table_name,
        schema: r.schema,
        database: r.database?.database_name,
        database_id: r.database?.id,
        kind: r.kind,
        columns_count: cols.length,
        has_sql: Boolean(r.sql),
      });
    } catch (e: any) {
      report.steps.push({ step: "dataset_detail", dataset_id: dsId, error: String(e?.message ?? e) });
      console.warn(`[2] dataset ${dsId} detail FAILED:`, e?.message ?? e);
    }
  }

  // ────────────────────────────────────────────────────────────────
  // ШАГ 3. Данные через SqlLabClient (POST chart/data и sqllab/execute)
  //   <ФИО> фактический доступ текущим логином.
  // ────────────────────────────────────────────────────────────────
  const lab = new SqlLabClient(cfg);
  try {
    await lab.login();
    const csrf = await lab.getCsrf();
    console.log(`[3] SqlLabClient login OK; csrf=${csrf.ok ? "OK" : `HTTP ${csrf.status}`}`);
  } catch (e: any) {
    report.steps.push({ step: "sqllab_login", error: String(e?.message ?? e) });
    console.warn("[3] SqlLabClient login FAILED:", e?.message ?? e);
  }

  const probes: ProbeResult[] = [];

  // 3a. POST /api/v1/chart/data — данные чарта 27050 ("Накопительный итог куст 7745").
  //     Фильтры из form_data чарта + shopno IN [DARKSTORE].
  //     Метрика: COUNT(id_order), группировка по name_tt.
  try {
    const res = await lab.post("/api/v1/chart/data", {
      datasource: { id: 3035, type: "table" },
      queries: [
        {
          granularity: "date_supply",
          groupby: ["name_tt"],
          metrics: [{ expressionType: "SIMPLE", column: { column_name: "id_order" }, aggregate: "COUNT", label: "orders" }],
          filters: [{ col: "shopno", op: "IN", val: [DARKSTORE] }],
          time_range: "Last week",
          row_limit: 100,
          is_timeseries: false,
        },
      ],
      form_data: { datasource: "3035__table", viz_type: "table", time_range: "Last week" },
      result_type: "full",
      result_format: "json",
    });
    const rows = res.body?.result?.[0]?.data ?? [];
    probes.push({
      label: `chart/data ds=3035 shopno=${DARKSTORE}`,
      method: "POST",
      endpoint: "/api/v1/chart/data",
      ok: res.ok,
      http_status: res.status,
      preview: JSON.stringify({ count: rows.length, sample: rows.slice(0, 3) }).slice(0, 800),
    });
    console.log(`[3a] chart/data -> HTTP ${res.status}${res.ok ? " (ДОСТУПНО)" : " (закрыто)"} | rows=${rows.length}`);
    if (rows.length > 0) {
      for (const r of rows.slice(0, 5)) console.log('  ', JSON.stringify(r));
    }
  } catch (e: any) {
    probes.push({ label: "chart/data", method: "POST", endpoint: "/api/v1/chart/data", error: String(e?.message ?? e) });
  }

  // 3b. POST /api/v1/sqllab/execute/ — прямой read-only SQL к источнику даркстора.
  //     Блокируется на уровне API (403) в текущей конфигурации, но фиксируем статус.
  const sqlProbe =
    `SELECT name_tt, shopno, date_supply, delivery_type_group, COUNT(*) AS orders\n` +
    `FROM mart_mixed.darkstore_time_click\n` +
    `WHERE shopno = ${DARKSTORE}\n` +
    `GROUP BY name_tt, shopno, date_supply, delivery_type_group\n` +
    `ORDER BY date_supply DESC\n` +
    `LIMIT 50`;
  try {
    const execRes = await lab.execute({ databaseId: 92, sql: sqlProbe, schema: "mart_mixed", limit: 50, label: `darkstore_${DARKSTORE}` });
    probes.push({
      label: `sqllab execute db=92 shopno=${DARKSTORE}`,
      method: "POST",
      endpoint: "/api/v1/sqllab/execute/",
      ok: execRes.status === "success",
      http_status: undefined,
      preview: JSON.stringify({ status: execRes.status, rows: execRes.rowCount, errors: execRes.errors }).slice(0, 400),
    });
    console.log(`[3b] sqllab/execute -> status=${execRes.status}, rows=${execRes.rowCount} (ожидаемо 403 на уровне Superset)`);
  } catch (e: any) {
    probes.push({ label: "sqllab execute", method: "POST", endpoint: "/api/v1/sqllab/execute/", error: String(e?.message ?? e) });
  }

  report.probes = probes;

  // ────────────────────────────────────────────────────────────────
  // ИТОГ
  // ────────────────────────────────────────────────────────────────
  const dataOk = probes.some((p) => p.ok && p.endpoint === "/api/v1/chart/data");
  const sqlOk = probes.some((p) => p.ok && p.endpoint.startsWith("/api/v1/sqllab"));
  if (dataOk || sqlOk) report.verdict = "DATA_ACCESSIBLE";
  else report.verdict = "METADATA_ONLY_DATA_BLOCKED";

  save();
  console.log("\n=== ИТОГ ===");
  console.log(`verdict: ${report.verdict}`);
  console.log(`login(GET): OK; dataset detail: см. steps; chart/data: ${dataOk ? "OK" : "закрыт"}; sqllab: ${sqlOk ? "OK" : "закрыт"}`);
  console.log(`отчёт: ${join(OUT_DIR, `darkstore_${DARKSTORE}_check.json`)}`);
}

main().catch((e) => {
  console.error("fatal:", e?.message ?? e);
  process.exitCode = 1;
});
