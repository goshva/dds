/**
 * Этап 1.4, фаза 1.4.4 — извлечение метаданных выбранного охвата (read-only).
 *
 * - 12 утверждённых datasets: переиспользуем локальные detail JSON (без API).
 * - Новые P0/P1 кандидаты: detail fetch через Superset API с ограничением и checkpoint.
 * - Charts/dashboards: извлекаются безопасные поля из snapshot (владельцы и контакты не сохраняются).
 *
 * Пишет data/extracted/phase-01-4/ и reports/phase-01-4/04_extraction_report.md.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../config";
import { SupersetClient } from "../superset";
import {
  EXTRACT_ROOT,
  SNAPSHOT_ROOT,
  ensureDir,
  readJson,
  writeJsonAtomic,
  writeAtomic,
  sha256,
  nowIso,
  csv,
  joinReport,
} from "./utils";
import { safeDatasetMetadata } from "./lib";

const APPROVED_IDS = [4732, 5247, 5399, 5797, 7006, 7024, 7027, 7119, 7293, 7465, 7473, 7775];
const PARSER_VERSION = "phase1-4@1";
const DETAIL_CAP = Number(Bun.env.PHASE14_DETAIL_CAP ?? 50);

type Provenance = {
  source_system: string;
  source_object_type: string;
  source_object_id: string;
  retrieved_at: string;
  snapshot_id: string;
  extraction_status: string;
  content_hash: string;
  parser_version: string;
};

function provenance(type: string, id: string, status: string, snapshotId: string, payload: unknown): Provenance {
  return {
    source_system: "superset",
    source_object_type: type,
    source_object_id: id,
    retrieved_at: nowIso(),
    snapshot_id: snapshotId,
    extraction_status: status,
    content_hash: sha256(JSON.stringify(payload)),
    parser_version: PARSER_VERSION,
  };
}

/** Безопасное подмножество dataset detail: см. lib.safeDatasetMetadata (тестируется отдельно). */

async function main() {
  ensureDir(EXTRACT_ROOT);
  const snapshotManifest = readJson<any>(join(SNAPSHOT_ROOT, "manifest.json"));
  const snapshotId = snapshotManifest?.snapshot_id ?? "local-output-baseline";
  const candidates = readJson<any>(joinReport("03_dataset_candidates.json"));
  const datasets: any[] = candidates?.datasets ?? [];

  ensureDir(join(EXTRACT_ROOT, "datasets"));
  ensureDir(join(EXTRACT_ROOT, "charts"));
  ensureDir(join(EXTRACT_ROOT, "dashboards"));

  const report: any = {
    generated_at: nowIso(),
    snapshot_id: snapshotId,
    detail_cap: DETAIL_CAP,
    datasets: { approved_local: 0, new_api: 0, list_only: 0, errors: 0, items: [] as any[] },
    charts: { extracted: 0, index: 0 },
    dashboards: { extracted: 0, index: 0 },
    errors: [] as string[],
  };

  // 1) 12 утверждённых из локальных detail JSON
  const detailDir = "output/dataset_details";
  const localDetails = new Map<number, any>();
  if (existsSync(detailDir)) {
    for (const f of readdirSync(detailDir).filter((x) => x.endsWith(".json"))) {
      const j = readJson<any>(join(detailDir, f));
      if (j?.result?.id != null) localDetails.set(Number(j.result.id), j.result);
    }
  }
  for (const id of APPROVED_IDS) {
    const res = localDetails.get(id);
    if (!res) {
      report.datasets.errors++;
      report.errors.push(`dataset ${id}: local detail missing`);
      report.datasets.items.push({ dataset_id: id, status: "ERROR_MISSING_DETAIL" });
      continue;
    }
    const meta = safeDatasetMetadata(res);
    const doc = { provenance: provenance("dataset", String(id), "FULL_DETAIL_LOCAL", snapshotId, meta), metadata: meta };
    writeJsonAtomic(join(EXTRACT_ROOT, "datasets", `${id}.json`), doc);
    report.datasets.approved_local++;
    report.datasets.items.push({ dataset_id: id, status: "FULL_DETAIL_LOCAL", columns: meta.columns.length, metrics: meta.metrics.length });
  }

  // 2) Новые P0/P1 кандидаты: detail fetch (ограниченно), с checkpoint
  const cpPath = join(EXTRACT_ROOT, "checkpoint.json");
  const cp = readJson<any>(cpPath) ?? { fetched: [], failed: [] };
  const fetchedSet = new Set<string>((cp.fetched ?? []).map(String));
  const GAP_DOMAINS = new Set(["SHIFT", "PAY", "GEO", "QUEUE", "ROUTE", "MENTOR", "EVENTS", "FULFILLMENT"]);
  const newCandidates = datasets
    .filter((d) => !APPROVED_IDS.includes(Number(d.dataset_id)))
    .filter((d) => d.priority === "P0" || d.priority === "P1")
    .map((d) => ({
      ...d,
      gap_relevance: (d.matched_domains ?? []).filter((x: string) => GAP_DOMAINS.has(x)).length,
    }))
    .sort((a, b) => b.gap_relevance - a.gap_relevance || b.total_score - a.total_score)
    .slice(0, DETAIL_CAP);

  if (newCandidates.length) {
    const cfg = loadConfig();
    const client = new SupersetClient(cfg);
    try {
      await client.login();
      for (const c of newCandidates) {
        const id = String(c.dataset_id);
        const outPath = join(EXTRACT_ROOT, "datasets", `${id}.json`);
        if (fetchedSet.has(id) && existsSync(outPath)) {
          report.datasets.new_api++;
          report.datasets.items.push({ dataset_id: Number(id), status: "FULL_DETAIL_API_CACHED", priority: c.priority });
          continue;
        }
        try {
          const data = await client.detail("dataset", Number(id));
          const res = data?.result;
          if (!res) throw new Error("no result");
          const meta = safeDatasetMetadata(res);
          const doc = { provenance: provenance("dataset", id, "FULL_DETAIL_API", snapshotId, meta), metadata: meta };
          writeJsonAtomic(outPath, doc);
          fetchedSet.add(id);
          cp.fetched = [...fetchedSet];
          writeJsonAtomic(cpPath, cp);
          report.datasets.new_api++;
          report.datasets.items.push({ dataset_id: Number(id), status: "FULL_DETAIL_API", priority: c.priority, columns: meta.columns.length, metrics: meta.metrics.length });
        } catch (e: any) {
          cp.failed = [...new Set([...(cp.failed ?? []).map(String), id])];
          writeJsonAtomic(cpPath, cp);
          report.datasets.errors++;
          report.errors.push(`dataset ${id}: ${String(e?.message ?? e)}`);
          report.datasets.items.push({ dataset_id: Number(id), status: "LIST_ONLY", priority: c.priority, error: String(e?.message ?? e) });
        }
      }
    } catch (e: any) {
      report.errors.push(`login failed: ${String(e?.message ?? e)}`);
    }
  }

  // 3) datasets, для которых detail не получен, но есть list-level SQL
  const compact = readJson<any>(join(SNAPSHOT_ROOT, "datasets.compact.json"))?.docs ?? [];
  const compactById = new Map<string, any>(compact.map((d: any) => [String(d.id), d]));
  for (const c of newCandidates) {
    const id = String(c.dataset_id);
    const outPath = join(EXTRACT_ROOT, "datasets", `${id}.json`);
    if (existsSync(outPath)) continue;
    const src = compactById.get(id);
    if (!src) continue;
    const meta = {
      id: Number(id),
      table_name: src.name ?? null,
      kind: src.kind ?? null,
      schema: src.schema ?? null,
      database: src.database ?? null,
      description: src.description ?? null,
      sql: src.sql ?? "",
      sql_len: src.sql_len ?? 0,
      main_dttm_col: null,
      columns: [],
      calculated_columns: [],
      metrics: [],
    };
    const doc = { provenance: provenance("dataset", id, "LIST_ONLY", snapshotId, meta), metadata: meta };
    writeJsonAtomic(outPath, doc);
    report.datasets.list_only++;
    report.datasets.items.push({ dataset_id: Number(id), status: "LIST_ONLY", priority: c.priority, sql_len: meta.sql_len });
  }

  // 4) charts и dashboards, связанные с извлечёнными datasets (evidence-driven), + P0-кандидаты
  const exDir = join(EXTRACT_ROOT, "datasets");
  const extractedDatasetIds = new Set<string>();
  for (const f of readdirSync(exDir).filter((x) => x.endsWith(".json") && x !== "index.json")) extractedDatasetIds.add(f.replace(".json", ""));

  const chartDocs: any[] = readJson<any>(join(SNAPSHOT_ROOT, "charts.compact.json"))?.docs ?? [];
  const chartCandidates = readJson<any>(joinReport("03_chart_candidates.json"))?.candidates ?? [];
  const p0ChartIds = new Set<string>((chartCandidates ?? []).filter((c: any) => c.priority === "P0").map((c: any) => String(c.chart_id)));
  const chartById = new Map<string, any>(chartDocs.map((c: any) => [String(c.id), c]));
  const selectedChartIds = new Set<string>(p0ChartIds);
  for (const c of chartDocs) {
    if (selectedChartIds.size >= 500) break;
    if (c.datasource_id && extractedDatasetIds.has(String(c.datasource_id))) selectedChartIds.add(String(c.id));
  }
  let chartCount = 0;
  const chartIndex: any[] = [];
  for (const id of selectedChartIds) {
    const c = chartById.get(id);
    if (!c) continue;
    const safe = {
      id: Number(id), name: c.name ?? null, viz_type: c.viz_type ?? null, dataset_id: c.datasource_id ?? null,
      dashboards: c.dashboards ?? [], metrics: c.metrics ?? [], groupby: c.groupby ?? [], time_range: c.time_range ?? null,
      granularity: c.granularity ?? null, filter_columns: c.filter_columns ?? [], params_parse_status: c.params_parse_status ?? null,
    };
    writeJsonAtomic(join(EXTRACT_ROOT, "charts", `${id}.json`), { provenance: provenance("chart", id, "LIST_ONLY", snapshotId, safe), metadata: safe });
    chartIndex.push({ chart_id: Number(id), dataset_id: safe.dataset_id, priority: p0ChartIds.has(id) ? "P0" : "LINKED" });
    chartCount++;
  }
  writeJsonAtomic(join(EXTRACT_ROOT, "charts", "index.json"), { generated_at: nowIso(), count: chartCount, items: chartIndex });

  const dashDocs: any[] = readJson<any>(join(SNAPSHOT_ROOT, "dashboards.compact.json"))?.docs ?? [];
  const dashJson = readJson<any>(joinReport("03_dashboard_candidates.json"));
  const dashById = new Map<string, any>(dashDocs.map((d: any) => [String(d.id), d]));
  const p0DashIds = new Set<string>((dashJson?.candidates ?? []).filter((d: any) => d.priority === "P0").map((d: any) => String(d.dashboard_id)));
  const selectedDashIds = new Set<string>(p0DashIds);
  for (const id of selectedChartIds) {
    if (selectedDashIds.size >= 200) break;
    for (const did of chartById.get(id)?.dashboards ?? []) selectedDashIds.add(String(did));
  }
  let dashCount = 0;
  const dashIndex: any[] = [];
  for (const id of selectedDashIds) {
    const src = dashById.get(id);
    if (!src) continue;
    const safe = { id: Number(id), name: src.name ?? null, slug: src.slug ?? null, published: src.published ?? null };
    writeJsonAtomic(join(EXTRACT_ROOT, "dashboards", `${id}.json`), { provenance: provenance("dashboard", id, "LIST_ONLY", snapshotId, safe), metadata: safe });
    dashIndex.push({ dashboard_id: Number(id), name: safe.name });
    dashCount++;
  }
  writeJsonAtomic(join(EXTRACT_ROOT, "dashboards", "index.json"), { generated_at: nowIso(), count: dashCount, items: dashIndex });

  report.charts.extracted = chartCount;
  report.charts.index = chartIndex.length;
  report.dashboards.extracted = dashCount;
  report.dashboards.index = dashIndex.length;

  writeJsonAtomic(join(EXTRACT_ROOT, "extraction_report.json"), report);

  const csvRows: unknown[][] = [["object_type", "object_id", "status", "priority", "columns", "metrics", "sql_len", "note"]];
  for (const it of report.datasets.items) csvRows.push(["dataset", it.dataset_id, it.status, it.priority ?? "", it.columns ?? "", it.metrics ?? "", it.sql_len ?? "", it.error ?? ""]);
  for (const it of chartIndex) csvRows.push(["chart", it.chart_id, "LIST_ONLY", it.priority, "", "", "", ""]);
  for (const it of dashIndex) csvRows.push(["dashboard", it.dashboard_id, "LIST_ONLY", "P0", "", "", "", ""]);
  writeAtomic(joinReport("04_extraction_index.csv"), csv(csvRows));

  const md: string[] = [];
  md.push("# Фаза 1.4.4 — Извлечение метаданных");
  md.push("");
  md.push(`Сгенерировано: ${report.generated_at}`);
  md.push(`Snapshot: \`${snapshotId}\`; parser: \`${PARSER_VERSION}\`; detail cap: ${DETAIL_CAP}.`);
  md.push("");
  md.push("| Категория | Кол-во |");
  md.push("|---|---:|");
  md.push(`| datasets: approved local detail | ${report.datasets.approved_local} |`);
  md.push(`| datasets: new API detail | ${report.datasets.new_api} |`);
  md.push(`| datasets: list-only | ${report.datasets.list_only} |`);
  md.push(`| datasets: errors | ${report.datasets.errors} |`);
  md.push(`| charts extracted (P0) | ${chartCount} |`);
  md.push(`| dashboards extracted (P0) | ${dashCount} |`);
  md.push("");
  md.push("Каталоги:");
  md.push("");
  md.push("- `data/extracted/phase-01-4/datasets/`");
  md.push("- `data/extracted/phase-01-4/charts/`");
  md.push("- `data/extracted/phase-01-4/dashboards/`");
  md.push("");
  md.push("Владельцы, changed_by, email и прочие контакты не извлекаются.");
  md.push("");
  if (report.errors.length) {
    md.push("## Ошибки");
    md.push("");
    for (const e of report.errors) md.push(`- ${e}`);
    md.push("");
  }
  writeAtomic(joinReport("04_extraction_report.md"), md.join("\n"));

  console.log(JSON.stringify({
    snapshot_id: snapshotId,
    datasets: { approved_local: report.datasets.approved_local, new_api: report.datasets.new_api, list_only: report.datasets.list_only, errors: report.datasets.errors },
    charts: chartCount,
    dashboards: dashCount,
    reports: ["04_extraction_report.md", "04_extraction_index.csv"],
  }, null, 2));
}

main().catch((e) => {
  console.error("[FATAL]", e);
  process.exit(1);
});
