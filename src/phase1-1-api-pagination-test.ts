/**
 * Этап 1.1 — безопасный API smoke/pagination test (readonly).
 *
 * Что проверяет:
 *  - полную пагинацию dashboard/chart/dataset через Rison-формат q;
 *  - count из первого ответа, downloaded_count, уникальность ID;
 *  - сохранение list-объектов в output/api_pagination_test/;
 *  - сверку фактических ID с локальным каталогом (readonly);
 *  - наличие и валидность 12 dataset detail;
 *  - неизменность SQLite (counts до/после, readonly).
 *
 * НЕ загружает detail массово и НЕ пишет в SQLite.
 * Отчёт: reports/phase-01-1/api_pagination_test.json
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { loadConfig } from "./config";
import { SupersetClient } from "./superset";

const OUT_DIR = "reports/phase-01-1";
const OUT = join(OUT_DIR, "api_pagination_test.json");
const LIST_DIR = "output/api_pagination_test";
const PRIORITY_IDS = [4732, 7119, 7006, 7024, 7027, 7775, 5797, 7465, 7473, 5247, 5399, 7293];

function idOf(x: any): string {
  return String(x?.id ?? x?.uuid ?? x?.slug ?? x?.table_name ?? "");
}

function localIds(db: Database, type: string): Set<string> {
  const rows = db.query(`SELECT object_id FROM objects WHERE object_type=?`).all(type) as any[];
  return new Set(rows.map((r) => String(r.object_id)));
}

function tableCounts(db: Database): Record<string, number> {
  const rows = db.query("SELECT object_type, COUNT(*) AS c FROM objects GROUP BY object_type").all() as any[];
  const out: Record<string, number> = {};
  for (const r of rows) out[String(r.object_type)] = Number(r.c);
  return out;
}

function validateDetailFile(id: number) {
  const path = join("output", "dataset_details", `${id}.json`);
  if (!existsSync(path)) return { dataset_id: id, ok: false, reason: "file_missing" };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    const res = parsed?.result;
    const ok =
      String(res?.id) === String(id) &&
      typeof res?.table_name === "string" &&
      Array.isArray(res?.columns) &&
      Array.isArray(res?.metrics) &&
      typeof res?.sql === "string" &&
      res.sql.length > 0;
    return {
      dataset_id: id,
      ok,
      table_name: res?.table_name ?? null,
      columns: Array.isArray(res?.columns) ? res.columns.length : null,
      metrics: Array.isArray(res?.metrics) ? res.metrics.length : null,
      sql_length: typeof res?.sql === "string" ? res.sql.length : 0,
      reason: ok ? null : "invalid_structure",
    };
  } catch (error: any) {
    return { dataset_id: id, ok: false, reason: `parse_error: ${String(error?.message ?? error)}` };
  }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(LIST_DIR, { recursive: true });

  const cfg = loadConfig();
  const report: any = {
    generated_at: new Date().toISOString(),
    base_url: cfg.baseUrl,
    page_size: cfg.pageSize,
    rate_limit_ms: cfg.rateLimitMs,
    status: "running",
    resources: {},
    local_catalog: {},
    dataset_details: {},
    sqlite: {},
    errors: [],
  };

  const db = new Database("data/catalog.sqlite", { readonly: true });
  const before = tableCounts(db);
  report.sqlite.before = before;
  report.local_catalog = {
    dashboard: localIds(db, "dashboard").size,
    chart: localIds(db, "chart").size,
    dataset: localIds(db, "dataset").size,
  };

  const client = new SupersetClient(cfg);
  try {
    await client.login();
    report.auth = "ok";
  } catch (error: any) {
    report.auth = "failed";
    report.status = "blocked";
    report.errors.push(`login failed: ${String(error?.message ?? error)}`);
    report.sqlite.after = tableCounts(db);
    db.close();
    writeFileSync(OUT, JSON.stringify(report, null, 2), { mode: 0o600 });
    console.error(`[BLOCKED] login failed: ${String(error?.message ?? error)}`);
    console.error(`report: ${OUT}`);
    process.exitCode = 1;
    return;
  }

  for (const resource of ["dashboard", "chart", "dataset"] as const) {
    const t0 = Date.now();
    try {
      const result = await client.listFull(resource);
      const apiIds = result.rows.map(idOf);
      const unique = new Set(apiIds);
      const duplicates = apiIds.length - unique.size;
      const local = localIds(db, resource);
      const missingInLocal = [...unique].filter((id) => !local.has(id));
      const extraInLocal = [...local].filter((id) => !unique.has(id));

      writeFileSync(
        join(LIST_DIR, `${resource}.json`),
        JSON.stringify({ api_count: result.api_count, rows: result.rows }, null, 2),
        { mode: 0o600 },
      );

      report.resources[resource] = {
        api_count: result.api_count,
        downloaded_count: result.downloaded_count,
        pages_count: result.pages_count,
        complete: result.complete,
        unique_ids: unique.size,
        duplicate_ids: duplicates,
        local_catalog_ids: local.size,
        missing_in_local_catalog: missingInLocal.length,
        missing_in_local_catalog_sample: missingInLocal.slice(0, 20),
        extra_in_local_catalog: extraInLocal.length,
        extra_in_local_catalog_sample: extraInLocal.slice(0, 20),
        elapsed_ms: Date.now() - t0,
      };

      if (!result.complete || duplicates > 0) {
        report.errors.push(`${resource}: complete=${result.complete}, duplicate_ids=${duplicates}`);
        process.exitCode = 1;
      }
    } catch (error: any) {
      report.resources[resource] = {
        error: String(error?.message ?? error),
        name: error?.name ?? null,
        status: error?.status ?? null,
        api_count: error?.apiCount ?? null,
        downloaded_count: error?.downloadedCount ?? null,
        pages_count: error?.pagesCount ?? null,
        unique_ids: error?.uniqueIdsCount ?? null,
        duplicate_ids: error?.duplicateRows ?? null,
        elapsed_ms: Date.now() - t0,
      };
      report.errors.push(`${resource}: ${String(error?.message ?? error)}`);
      process.exitCode = 1;
    }
  }

  for (const id of PRIORITY_IDS) {
    report.dataset_details[String(id)] = validateDetailFile(id);
  }
  const badDetails = Object.values(report.dataset_details).filter((d: any) => !d.ok);
  if (badDetails.length) {
    report.errors.push(`dataset detail invalid: ${badDetails.map((d: any) => d.dataset_id).join(",")}`);
    process.exitCode = 1;
  }

  report.sqlite.after = tableCounts(db);
  report.sqlite.unchanged = JSON.stringify(report.sqlite.before) === JSON.stringify(report.sqlite.after);
  if (!report.sqlite.unchanged) {
    report.errors.push("SQLite counts changed during test");
    process.exitCode = 1;
  }
  db.close();

  report.status = report.errors.length === 0 ? "ok" : "failed";
  report.finished_at = new Date().toISOString();
  writeFileSync(OUT, JSON.stringify(report, null, 2), { mode: 0o600 });

  console.log(JSON.stringify({
    status: report.status,
    resources: Object.fromEntries(
      Object.entries(report.resources).map(([k, v]: [string, any]) => [
        k,
        v.error ? { error: v.error } : { api_count: v.api_count, downloaded: v.downloaded_count, unique: v.unique_ids, duplicates: v.duplicate_ids, complete: v.complete },
      ]),
    ),
    dataset_details_ok: Object.values(report.dataset_details).filter((d: any) => d.ok).length,
    sqlite_unchanged: report.sqlite.unchanged,
    errors: report.errors,
    report: OUT,
  }, null, 2));
}

main().catch((error) => {
  console.error("[FATAL]", error);
  process.exit(1);
});
