/**
 * Этап 1.1 — discovery smoke test (read-only).
 *
 * Проверяет:
 *  - локальный SQLite: quick_check, counts, relations (readonly);
 *  - наличие list-выгрузок dashboard/chart/dataset;
 *  - 12 dataset detail и dataset_detail_summary;
 *  - при наличии credentials — API-пагинацию listFull без записи в SQLite.
 *
 * Ничего не пишет в data/catalog.sqlite.
 * Отчёт: reports/phase-01-1/discovery_test.json
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { loadConfig } from "./config";
import { SupersetClient } from "./superset";

const OUT_DIR = "reports/phase-01-1";
const OUT = join(OUT_DIR, "discovery_test.json");
const PRIORITY_IDS = [4732, 7119, 7006, 7024, 7027, 7775, 5797, 7465, 7473, 5247, 5399, 7293];

function readJson(path: string): any | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function tableCounts(db: Database): Record<string, number> {
  const rows = db.query("SELECT object_type, COUNT(*) AS c FROM objects GROUP BY object_type").all() as any[];
  const out: Record<string, number> = {};
  for (const r of rows) out[String(r.object_type)] = Number(r.c);
  return out;
}

function validateDetail(id: number) {
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
    return { dataset_id: id, ok, table_name: res?.table_name ?? null, reason: ok ? null : "invalid_structure" };
  } catch (error: any) {
    return { dataset_id: id, ok: false, reason: `parse_error: ${String(error?.message ?? error)}` };
  }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const report: any = {
    generated_at: new Date().toISOString(),
    mode: "read-only",
    checks: {},
    errors: [],
    api: { attempted: false },
  };

  // --- SQLite readonly ---
  try {
    const db = new Database("data/catalog.sqlite", { readonly: true });
    const quick = db.query("PRAGMA quick_check").all() as any[];
    report.checks.sqlite = {
      quick_check: quick[0]?.quick_check ?? null,
      counts: tableCounts(db),
      relations: Number((db.query("SELECT COUNT(*) AS c FROM relations").get() as any).c),
    };
    db.close();
    if (report.checks.sqlite.quick_check !== "ok") report.errors.push("sqlite quick_check != ok");
    if (report.checks.sqlite.relations !== 0) report.errors.push("relations table is not empty");
  } catch (error: any) {
    report.checks.sqlite = { error: String(error?.message ?? error) };
    report.errors.push(`sqlite: ${String(error?.message ?? error)}`);
  }

  // --- Local list outputs vs local catalog counts ---
  const localCounts = report.checks.sqlite?.counts ?? {};
  report.checks.lists = {};
  for (const resource of ["dashboard", "chart", "dataset"] as const) {
    const path = join("output", `${resource}s.json`);
    const data = readJson(path);
    const rows = Array.isArray(data?.result) ? data.result.length : null;
    report.checks.lists[resource] = {
      file: path,
      present: Boolean(data),
      rows,
      local_catalog_count: localCounts[resource] ?? null,
    };
    if (!data) report.errors.push(`missing list file: ${path}`);
    if (rows !== null && (localCounts[resource] ?? rows) !== rows) {
      report.errors.push(`${resource}: list rows=${rows} != local catalog count=${localCounts[resource]}`);
    }
  }

  // --- 12 dataset details ---
  report.checks.dataset_details = Object.fromEntries(PRIORITY_IDS.map((id) => [String(id), validateDetail(id)]));
  const badDetails = Object.values(report.checks.dataset_details).filter((d: any) => !d.ok);
  if (badDetails.length) report.errors.push(`dataset details invalid: ${badDetails.map((d: any) => d.dataset_id).join(",")}`);

  const summary = readJson("output/dataset_detail_summary.json");
  report.checks.dataset_detail_summary = {
    present: Boolean(summary),
    priority: summary?.totals?.priority ?? null,
    valid_details: summary?.totals?.valid_details ?? null,
    all_valid: summary?.verification?.all_valid ?? null,
  };
  if (!summary) report.errors.push("missing output/dataset_detail_summary.json");

  // --- API pagination (optional) ---
  const cfg = loadConfig();
  const canAuth = Boolean(cfg.username && cfg.password) || Boolean(cfg.accessToken);
  if (canAuth) {
    report.api.attempted = true;
    const client = new SupersetClient(cfg);
    try {
      await client.login();
      report.api.auth = "ok";
      report.api.resources = {};
      for (const resource of ["dashboard", "chart", "dataset"] as const) {
        try {
          const result = await client.listFull(resource);
          report.api.resources[resource] = {
            api_count: result.api_count,
            downloaded_count: result.downloaded_count,
            unique_ids_count: result.unique_ids_count,
            duplicate_rows: result.duplicate_rows,
            pages_count: result.pages_count,
            complete: result.complete,
          };
          if (!result.complete || result.duplicate_rows > 0) {
            report.errors.push(`api ${resource}: complete=${result.complete}, duplicates=${result.duplicate_rows}`);
          }
        } catch (error: any) {
          report.api.resources[resource] = { error: String(error?.message ?? error) };
          report.errors.push(`api ${resource}: ${String(error?.message ?? error)}`);
        }
      }
      // Точечная проверка detail без слэша
      try {
        const detail = await client.detail("dataset", 4732);
        report.api.detail_4732 = {
          ok: String(detail?.result?.id) === "4732",
          table_name: detail?.result?.table_name ?? null,
          columns: Array.isArray(detail?.result?.columns) ? detail.result.columns.length : null,
        };
      } catch (error: any) {
        report.api.detail_4732 = { ok: false, error: String(error?.message ?? error) };
        report.errors.push(`api detail 4732: ${String(error?.message ?? error)}`);
      }
    } catch (error: any) {
      report.api.auth = "failed";
      report.api.error = String(error?.message ?? error);
      report.api.skipped_reason = "login failed";
    }
  } else {
    report.api.skipped_reason = "no credentials (SUPERSET_USERNAME/SUPERSET_PASSWORD/SUPERSET_ACCESS_TOKEN)";
  }

  report.status = report.errors.length === 0 ? "ok" : "failed";
  report.finished_at = new Date().toISOString();
  writeFileSync(OUT, JSON.stringify(report, null, 2), { mode: 0o600 });

  console.log(JSON.stringify({
    status: report.status,
    sqlite: report.checks.sqlite,
    lists: report.checks.lists,
    dataset_details_ok: Object.values(report.checks.dataset_details).filter((d: any) => d.ok).length,
    api: report.api,
    errors: report.errors,
    report: OUT,
  }, null, 2));

  if (report.errors.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error("[FATAL]", error);
  process.exit(1);
});
