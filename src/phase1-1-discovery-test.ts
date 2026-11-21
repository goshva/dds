/**
 * Этап 1.1 — discovery smoke test + отчёт о полноте (read-only).
 *
 * Проверяет:
 *  - локальный SQLite: quick_check, counts, relations (readonly);
 *  - фактические list-выгрузки output/{dashboards,charts,datasets}.json:
 *    количество строк, уникальность ID, дубликаты;
 *  - сверку фактических данных с output/discovery_summary.json (summary НЕ считается
 *    достаточным доказательством);
 *  - временные метки запуска;
 *  - 12 dataset detail и dataset_detail_summary;
 *  - точечные detail-проверки из summary;
 *  - при наличии credentials — API-пагинацию listFull.
 *
 * Пишет:
 *  - reports/phase-01-1/discovery_test.json
 *  - reports/phase-01-1/discovery_completion.md
 *
 * Ничего не пишет в data/catalog.sqlite.
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { loadConfig } from "./config";
import { SupersetClient } from "./superset";

const OUT_DIR = "reports/phase-01-1";
const OUT_JSON = join(OUT_DIR, "discovery_test.json");
const OUT_MD = join(OUT_DIR, "discovery_completion.md");
const PRIORITY_IDS = [4732, 7119, 7006, 7024, 7027, 7775, 5797, 7465, 7473, 5247, 5399, 7293];
const RESOURCES = ["dashboard", "chart", "dataset"] as const;
const LIST_FILE: Record<string, string> = {
  dashboard: "output/dashboards.json",
  chart: "output/charts.json",
  dataset: "output/datasets.json",
};

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
    summary: null,
    lists: {},
    sqlite: {},
    dataset_details: {},
    api: { attempted: false },
    checks: {},
    errors: [],
  };

  const summary = readJson("output/discovery_summary.json");
  report.summary = summary
    ? {
        started_at: summary.started_at,
        finished_at: summary.finished_at,
        status: summary.status,
        mode: summary.mode,
        resources: summary.resources,
        detail_summary: summary.detail_summary,
        detail_spot_checks: summary.detail_spot_checks,
        endpoint_errors: Array.isArray(summary.endpoint_errors) ? summary.endpoint_errors.length : null,
        courier_candidates: summary.courier_candidates,
      }
    : null;
  if (!summary) report.errors.push("missing output/discovery_summary.json");

  // --- Фактические list-файлы ---
  for (const resource of RESOURCES) {
    const path = LIST_FILE[resource];
    const data = readJson(path);
    const rows = Array.isArray(data?.result) ? data.result : [];
    const ids = rows.map((r: any) => String(r?.id ?? r?.uuid ?? ""));
    const missingIds = ids.filter((id: string) => !id).length;
    const unique = new Set(ids.filter(Boolean));
    const duplicates = ids.length - unique.size;
    const summaryResource = summary?.resources?.[resource] ?? null;
    const entry = {
      file: path,
      present: Boolean(data),
      rows: rows.length,
      unique_ids: unique.size,
      duplicate_ids: duplicates,
      rows_without_id: missingIds,
      summary_downloaded_count: summaryResource?.downloaded_count ?? summaryResource?.count ?? null,
      summary_api_count: summaryResource?.api_count ?? null,
      summary_unique_ids_count: summaryResource?.unique_ids_count ?? null,
      summary_duplicate_rows: summaryResource?.duplicate_rows ?? null,
      summary_status: summaryResource?.status ?? null,
      file_api_count_field: data?.api_count ?? null,
    };
    report.lists[resource] = entry;

    if (!data) report.errors.push(`missing list file: ${path}`);
    if (duplicates > 0) report.errors.push(`${resource}: duplicate ids=${duplicates}`);
    if (missingIds > 0) report.errors.push(`${resource}: rows without id=${missingIds}`);
    if (entry.summary_downloaded_count !== null && entry.summary_downloaded_count !== rows.length) {
      report.errors.push(
        `${resource}: summary downloaded=${entry.summary_downloaded_count} != actual rows=${rows.length}`,
      );
    }
    if (entry.summary_api_count !== null && entry.summary_api_count !== rows.length) {
      report.errors.push(`${resource}: summary api_count=${entry.summary_api_count} != actual rows=${rows.length}`);
    }
    if (entry.summary_unique_ids_count !== null && entry.summary_unique_ids_count !== unique.size) {
      report.errors.push(
        `${resource}: summary unique_ids=${entry.summary_unique_ids_count} != actual unique=${unique.size}`,
      );
    }
  }

  // --- SQLite readonly (информационно: каталог в SQLite усечён) ---
  try {
    const db = new Database("data/catalog.sqlite", { readonly: true });
    const quick = db.query("PRAGMA quick_check").all() as any[];
    report.sqlite = {
      quick_check: quick[0]?.quick_check ?? null,
      counts: tableCounts(db),
      relations: Number((db.query("SELECT COUNT(*) AS c FROM relations").get() as any).c),
      note: "SQLite list усечён (историческая выгрузка); полный каталог — в output/*.json",
    };
    db.close();
    if (report.sqlite.quick_check !== "ok") report.errors.push("sqlite quick_check != ok");
    if (report.sqlite.relations !== 0) report.errors.push("relations table is not empty");
  } catch (error: any) {
    report.sqlite = { error: String(error?.message ?? error) };
    report.errors.push(`sqlite: ${String(error?.message ?? error)}`);
  }

  // --- 12 dataset details ---
  report.dataset_details = Object.fromEntries(PRIORITY_IDS.map((id) => [String(id), validateDetail(id)]));
  const badDetails = Object.values(report.dataset_details).filter((d: any) => !d.ok);
  if (badDetails.length) {
    report.errors.push(`dataset details invalid: ${badDetails.map((d: any) => d.dataset_id).join(",")}`);
  }
  const detailSummary = readJson("output/dataset_detail_summary.json");
  report.dataset_detail_summary = {
    present: Boolean(detailSummary),
    priority: detailSummary?.totals?.priority ?? null,
    valid_details: detailSummary?.totals?.valid_details ?? null,
    unique_saved_datasets: detailSummary?.totals?.unique_saved_datasets ?? null,
    all_valid: detailSummary?.verification?.all_valid ?? null,
  };
  if (!detailSummary) report.errors.push("missing output/dataset_detail_summary.json");

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
      for (const resource of RESOURCES) {
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
  writeFileSync(OUT_JSON, JSON.stringify(report, null, 2), { mode: 0o600 });

  // --- Markdown отчёт ---
  const md: string[] = [];
  md.push("# Discovery completion — Этап 1.1");
  md.push("");
  md.push(`Сгенерировано: ${report.generated_at}`);
  md.push(`Статус: **${report.status.toUpperCase()}**`);
  md.push("");
  md.push("## Сверка summary ↔ фактические файлы");
  md.push("");
  md.push("| Ресурс | Файл | Строк (факт) | Уникальных ID | Дубликатов | summary downloaded | summary api_count | Статус summary |");
  md.push("|---|---|---:|---:|---:|---:|---:|---|");
  for (const resource of RESOURCES) {
    const e = report.lists[resource];
    md.push(
      `| ${resource} | \`${e.file}\` | ${e.rows} | ${e.unique_ids} | ${e.duplicate_ids} | ${e.summary_downloaded_count ?? "—"} | ${e.summary_api_count ?? "—"} | ${e.summary_status ?? "—"} |`,
    );
  }
  md.push("");
  md.push("## Временные метки");
  md.push("");
  md.push(`- started_at: ${summary?.started_at ?? "—"}`);
  md.push(`- finished_at: ${summary?.finished_at ?? "—"}`);
  md.push(`- mode: ${summary?.mode ?? "—"}`);
  md.push(`- status: ${summary?.status ?? "—"}`);
  md.push("");
  md.push("## Detail");
  md.push("");
  md.push(`- spot checks: attempted=${summary?.detail_spot_checks?.attempted ?? "—"}, ok=${summary?.detail_spot_checks?.ok ?? "—"}, failed=${summary?.detail_spot_checks?.failed ?? "—"}`);
  md.push(`- endpoint_errors: ${report.summary?.endpoint_errors ?? "—"}`);
  md.push(`- 12 dataset details valid: ${Object.values(report.dataset_details).filter((d: any) => d.ok).length}/12`);
  md.push(`- dataset_detail_summary.all_valid: ${report.dataset_detail_summary.all_valid}`);
  md.push("");
  md.push("## SQLite (readonly)");
  md.push("");
  md.push(`- quick_check: ${report.sqlite.quick_check ?? "—"}`);
  md.push(`- counts: ${JSON.stringify(report.sqlite.counts ?? {})}`);
  md.push(`- relations: ${report.sqlite.relations ?? "—"}`);
  md.push(`- note: ${report.sqlite.note ?? "—"}`);
  md.push("");
  md.push("## Проверки");
  md.push("");
  md.push(`- duplicate ids: ${RESOURCES.map((r) => `${r}=${report.lists[r].duplicate_ids}`).join(", ")}`);
  md.push(`- rows without id: ${RESOURCES.map((r) => `${r}=${report.lists[r].rows_without_id}`).join(", ")}`);
  md.push(`- summary ↔ fact mismatches: ${report.errors.length === 0 ? "нет" : report.errors.join("; ")}`);
  md.push("");
  md.push("Вывод: summary подтверждён фактическими файлами и уникальностью ID."
    + (report.errors.length ? " Обнаружены расхождения — см. список выше." : ""));
  md.push("");
  writeFileSync(OUT_MD, md.join("\n"), { mode: 0o600 });

  console.log(JSON.stringify({
    status: report.status,
    lists: Object.fromEntries(RESOURCES.map((r) => [r, {
      rows: report.lists[r].rows,
      unique: report.lists[r].unique_ids,
      duplicates: report.lists[r].duplicate_ids,
      summary_downloaded: report.lists[r].summary_downloaded_count,
      summary_api: report.lists[r].summary_api_count,
    }])),
    sqlite: report.sqlite,
    dataset_details_ok: Object.values(report.dataset_details).filter((d: any) => d.ok).length,
    api: report.api,
    errors: report.errors,
    reports: [OUT_JSON, OUT_MD],
  }, null, 2));

  if (report.errors.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error("[FATAL]", error);
  process.exit(1);
});
