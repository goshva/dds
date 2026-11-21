/**
 * Этап 1.4, фаза 1.4.2 — синхронизация каталога Superset (read-only) с checkpoint/resume.
 *
 * Пишет:
 *  - data/snapshots/phase-01-4/<resource>s.compact.json
 *  - data/snapshots/phase-01-4/manifest.json
 *  - data/snapshots/phase-01-4/.checkpoint/<resource>/page-N.json + state.json
 *  - reports/phase-01-4/02_catalog_sync.md, 02_catalog_diff.csv, 02_catalog_diff.json
 *
 * Не изменяет data/catalog.sqlite и отчёты предыдущих этапов.
 */
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../config";
import { SupersetClient, buildPaginationQuery } from "../superset";
import {
  SNAPSHOT_ROOT,
  REPORT_DIR,
  ensureDir,
  readJson,
  writeJsonAtomic,
  writeAtomic,
  sha256,
  nowIso,
  csv,
  joinReport,
} from "./utils";

const RESOURCES = ["dashboard", "chart", "dataset"] as const;
type Resource = (typeof RESOURCES)[number];

type SafeDoc = Record<string, any>;

type Checkpoint = {
  resource: Resource;
  page_size: number;
  api_count: number | null;
  pages_done: number;
  started_at: string;
  updated_at: string;
};

function checkpointDir(resource: Resource): string {
  return join(SNAPSHOT_ROOT, ".checkpoint", resource);
}

function pagePath(resource: Resource, page: number): string {
  return join(checkpointDir(resource), `page-${String(page).padStart(5, "0")}.json`);
}

function loadCheckpoint(resource: Resource): Checkpoint | null {
  return readJson<Checkpoint>(join(checkpointDir(resource), "state.json"));
}

function saveCheckpoint(cp: Checkpoint): void {
  writeJsonAtomic(join(checkpointDir(cp.resource), "state.json"), cp);
}

function chartSearchFields(row: any): any {
  const raw = typeof row?.params === "string" ? row.params : typeof row?.form_data === "string" ? row.form_data : null;
  if (!raw) return { params_parse_status: "ABSENT", metrics: [], groupby: [], time_range: null, granularity: null, filter_columns: [] };
  try {
    const p = JSON.parse(raw);
    const metrics = (p.metrics ?? []).map((m: any) => (typeof m === "string" ? m : m?.label ?? m?.metric_name ?? null)).filter(Boolean);
    const groupby = Array.isArray(p.groupby) ? p.groupby.map(String) : [];
    const filters = Array.isArray(p.adhoc_filters) ? p.adhoc_filters.map((f: any) => f?.col ?? null).filter(Boolean) : [];
    return {
      params_parse_status: "PARSED",
      metrics,
      groupby,
      time_range: p.time_range ?? null,
      granularity: p.granularity_sqla ?? p.granularity ?? null,
      filter_columns: filters,
    };
  } catch {
    return { params_parse_status: "UNRESOLVED", params_hash: sha256(raw), params_len: raw.length, metrics: [], groupby: [], time_range: null, granularity: null, filter_columns: [] };
  }
}

function safeDoc(resource: Resource, row: any): SafeDoc {
  if (resource === "dashboard") {
    return {
      id: String(row?.id ?? ""),
      name: row?.dashboard_title ?? null,
      slug: row?.slug ?? null,
      published: row?.published ?? null,
      description_hash: row?.description ? sha256(String(row.description)) : null,
      description_len: row?.description ? String(row.description).length : 0,
      description: typeof row?.description === "string" ? row.description.slice(0, 2000) : null,
    };
  }
  if (resource === "chart") {
    const search = chartSearchFields(row);
    return {
      id: String(row?.id ?? ""),
      name: row?.slice_name ?? null,
      viz_type: row?.viz_type ?? null,
      datasource_id: row?.datasource_id != null ? String(row.datasource_id) : null,
      datasource_type: row?.datasource_type ?? null,
      dashboards: Array.isArray(row?.dashboards) ? row.dashboards.map((d: any) => String(d?.id ?? "")).filter(Boolean).sort() : [],
      description_hash: row?.description ? sha256(String(row.description)) : null,
      description_len: row?.description ? String(row.description).length : 0,
      description: typeof row?.description === "string" ? row.description.slice(0, 2000) : null,
      ...search,
    };
  }
  return {
    id: String(row?.id ?? ""),
    name: row?.table_name ?? null,
    kind: row?.kind ?? null,
    schema: row?.schema ?? null,
    database: row?.database?.database_name ?? row?.database_name ?? null,
    sql: typeof row?.sql === "string" ? row.sql : "",
    sql_len: typeof row?.sql === "string" ? row.sql.length : 0,
    sql_hash: sha256(String(row?.sql ?? "")),
    description_hash: row?.description ? sha256(String(row.description)) : null,
    description_len: row?.description ? String(row.description).length : 0,
    description: typeof row?.description === "string" ? row.description.slice(0, 2000) : null,
  };
}

async function syncResource(client: SupersetClient, resource: Resource, pageSize: number, maxPages: number) {
  ensureDir(checkpointDir(resource));
  let cp = loadCheckpoint(resource);
  if (!cp) {
    cp = { resource, page_size: pageSize, api_count: null, pages_done: 0, started_at: nowIso(), updated_at: nowIso() };
    saveCheckpoint(cp);
  }

  const firstPath = pagePath(resource, 0);
  if (!existsSync(firstPath)) {
    const first = await client.get(`/api/v1/${resource}/?q=${buildPaginationQuery(0, pageSize)}`);
    const count = Number(first?.count ?? NaN);
    if (!Number.isFinite(count) || count < 0) throw new Error(`list(${resource}): no count`);
    if (!Array.isArray(first?.result)) throw new Error(`list(${resource}): page 0 has no result array`);
    writeJsonAtomic(firstPath, first.result);
    cp.api_count = count;
    cp.pages_done = 1;
    cp.updated_at = nowIso();
    saveCheckpoint(cp);
    console.log(`[sync] ${resource}: count=${count}, page 0 saved`);
  } else if (cp.api_count === null) {
    cp.api_count = Number(readJson<any>(firstPath)?.length ?? 0);
  }

  const apiCount = cp.api_count ?? 0;
  const requiredPages = Math.ceil(apiCount / pageSize);
  if (requiredPages > maxPages) {
    throw new Error(`list(${resource}): count=${apiCount} requires ${requiredPages} pages > MAX_PAGES=${maxPages}`);
  }

  for (let page = cp.pages_done; page < requiredPages; page++) {
    const path = pagePath(resource, page);
    if (existsSync(path)) {
      cp.pages_done = Math.max(cp.pages_done, page + 1);
      cp.updated_at = nowIso();
      saveCheckpoint(cp);
      continue;
    }
    const result = await client.get(`/api/v1/${resource}/?q=${buildPaginationQuery(page, pageSize)}`);
    if (!Array.isArray(result?.result)) throw new Error(`list(${resource}): page ${page} has no result array`);
    if (result.result.length === 0) break;
    writeJsonAtomic(path, result.result);
    cp.pages_done = page + 1;
    cp.updated_at = nowIso();
    saveCheckpoint(cp);
    if ((page + 1) % 20 === 0) console.log(`[sync] ${resource}: ${page + 1}/${requiredPages} pages`);
  }

  // сборка
  const rows: any[] = [];
  const files = readdirSync(checkpointDir(resource)).filter((f) => f.startsWith("page-") && f.endsWith(".json")).sort();
  for (const f of files) {
    const pageRows = readJson<any[]>(join(checkpointDir(resource), f)) ?? [];
    rows.push(...pageRows);
  }
  const ids = rows.map((r) => String(r?.id ?? ""));
  const unique = new Set(ids.filter(Boolean));
  const duplicates = ids.length - unique.size;
  const docs = rows.map((r) => safeDoc(resource, r));
  const compactPath = join(SNAPSHOT_ROOT, `${resource}s.compact.json`);
  writeJsonAtomic(compactPath, { resource, api_count: apiCount, downloaded_count: rows.length, unique_ids_count: unique.size, duplicate_rows: duplicates, pages_count: files.length, retrieved_at: nowIso(), docs });
  return { resource, api_count: apiCount, downloaded_count: rows.length, unique_ids_count: unique.size, duplicate_rows: duplicates, pages_count: files.length, compactPath };
}

function previousDocs(resource: Resource): SafeDoc[] {
  const prev = readJson<any>(`output/${resource}s.json`);
  const rows = Array.isArray(prev?.result) ? prev.result : [];
  return rows.map((r: any) => safeDoc(resource, r));
}

function diffDocs(resource: Resource, oldDocs: SafeDoc[], newDocs: SafeDoc[]) {
  const oldMap = new Map(oldDocs.map((d) => [String(d.id), d]));
  const newMap = new Map(newDocs.map((d) => [String(d.id), d]));
  const rows: unknown[][] = [];
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  const compareFields: Record<Resource, string[]> = {
    dashboard: ["name", "slug", "published", "description_hash"],
    chart: ["name", "viz_type", "datasource_id", "description_hash", "dashboards", "metrics", "groupby", "time_range"],
    dataset: ["name", "kind", "schema", "database", "sql_hash", "sql_len", "description_hash"],
  };
  for (const [id, nd] of newMap) {
    const od = oldMap.get(id);
    if (!od) {
      added.push(id);
      rows.push([resource, id, "ADDED", "", "", nd.name ?? "", ""]);
      continue;
    }
    for (const f of compareFields[resource]) {
      const a = JSON.stringify(od[f] ?? null);
      const b = JSON.stringify(nd[f] ?? null);
      if (a !== b) {
        changed.push(id);
        rows.push([resource, id, "CHANGED", f, a.slice(0, 200), b.slice(0, 200), ""]);
      }
    }
  }
  for (const [id, od] of oldMap) {
    if (!newMap.has(id)) {
      removed.push(id);
      rows.push([resource, id, "NOT_SEEN_IN_SNAPSHOT", "", od.name ?? "", "", "не доказывает удаление"]);
    }
  }
  return { rows, added, removed, changed };
}

async function main() {
  ensureDir(SNAPSHOT_ROOT);
  ensureDir(REPORT_DIR);
  const cfg = loadConfig();
  const client = new SupersetClient(cfg);
  await client.login();

  const summary: any = { generated_at: nowIso(), snapshot_root: SNAPSHOT_ROOT, resources: {}, diff: {}, errors: [] };
  const diffRows: unknown[][] = [["resource", "id", "change_type", "field", "old_value", "new_value", "note"]];
  const diffJson: any = { generated_at: nowIso(), resources: {} };

  for (const resource of RESOURCES) {
    try {
      console.log(`[sync] ${resource}: start`);
      const res = await syncResource(client, resource, cfg.pageSize, cfg.maxPages);
      summary.resources[resource] = res;
      const oldDocs = previousDocs(resource);
      const newDocs = (readJson<any>(join(SNAPSHOT_ROOT, `${resource}s.compact.json`))?.docs ?? []) as SafeDoc[];
      const d = diffDocs(resource, oldDocs, newDocs);
      diffRows.push(...d.rows);
      diffJson.resources[resource] = { previous_count: oldDocs.length, current_count: newDocs.length, added: d.added, not_seen: d.removed, changed_ids: [...new Set(d.changed)] };
      summary.diff[resource] = { previous: oldDocs.length, current: newDocs.length, added: d.added.length, not_seen: d.removed.length, changed: new Set(d.changed).size };
      if (res.duplicate_rows > 0) summary.errors.push(`${resource}: duplicate_rows=${res.duplicate_rows}`);
      if (res.downloaded_count !== res.api_count) summary.errors.push(`${resource}: downloaded=${res.downloaded_count} != api_count=${res.api_count}`);
      console.log(`[sync] ${resource}: done (${res.downloaded_count}/${res.api_count})`);
    } catch (e: any) {
      summary.errors.push(`${resource}: ${String(e?.message ?? e)}`);
      console.log(`[sync] ${resource}: ERROR ${String(e?.message ?? e)}`);
    }
  }

  const manifest = {
    snapshot_id: `phase-01-4-${nowIso().replace(/[:.]/g, "-")}`,
    generated_at: nowIso(),
    source: "Superset list API (read-only)",
    page_size: cfg.pageSize,
    resources: summary.resources,
    diff: summary.diff,
    errors: summary.errors,
    note: "Полные raw-страницы лежат в .checkpoint/<resource>/page-N.json; compact snapshot — безопасные поля для анализа.",
  };
  writeJsonAtomic(join(SNAPSHOT_ROOT, "manifest.json"), manifest);
  writeAtomic(joinReport("02_catalog_diff.csv"), csv(diffRows));
  writeJsonAtomic(joinReport("02_catalog_diff.json"), diffJson);

  const md: string[] = [];
  md.push("# Фаза 1.4.2 — Синхронизация каталога Superset (read-only)");
  md.push("");
  md.push(`Сгенерировано: ${manifest.generated_at}`);
  md.push(`Snapshot root: \`${SNAPSHOT_ROOT}\``);
  md.push("");
  md.push("## Текущий snapshot vs предыдущий (`output/*.json`)");
  md.push("");
  md.push("| Ресурс | API count | Скачано | Уникальных ID | Дубли | Страниц | Было | Добавлено | Не видно в snapshot | Изменено |");
  md.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const r of RESOURCES) {
    const s = summary.resources[r] ?? {};
    const d = summary.diff[r] ?? {};
    md.push(`| ${r} | ${s.api_count ?? "—"} | ${s.downloaded_count ?? "—"} | ${s.unique_ids_count ?? "—"} | ${s.duplicate_rows ?? "—"} | ${s.pages_count ?? "—"} | ${d.previous ?? "—"} | ${d.added ?? "—"} | ${d.not_seen ?? "—"} | ${d.changed ?? "—"} |`);
  }
  md.push("");
  md.push("`NOT_SEEN_IN_SNAPSHOT` не доказывает удаление объекта — только отсутствие в текущем snapshot.");
  md.push("");
  md.push("## Ошибки");
  md.push("");
  if (summary.errors.length === 0) md.push("- нет");
  else for (const e of summary.errors) md.push(`- ${e}`);
  md.push("");
  md.push("## Изменённые объекты (по id)");
  md.push("");
  for (const r of RESOURCES) {
    const d = diffJson.resources[r] ?? {};
    md.push(`### ${r}`);
    md.push("");
    md.push(`- added: ${(d.added ?? []).slice(0, 50).join(", ") || "нет"}`);
    md.push(`- not_seen: ${(d.not_seen ?? []).slice(0, 50).join(", ") || "нет"}`);
    md.push(`- changed_ids: ${(d.changed_ids ?? []).slice(0, 50).join(", ") || "нет"}`);
    md.push("");
  }
  writeAtomic(joinReport("02_catalog_sync.md"), md.join("\n"));

  console.log(JSON.stringify({ resources: summary.resources, diff: summary.diff, errors: summary.errors, reports: ["02_catalog_sync.md", "02_catalog_diff.csv", "02_catalog_diff.json"] }, null, 2));
  if (summary.errors.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error("[FATAL]", e);
  process.exit(1);
});
