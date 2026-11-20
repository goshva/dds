import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "./config";
import { loadConfig } from "./config";
import { SupersetClient, PaginationError } from "./superset";
import { CatalogStore } from "./store";

function idOf(x: any): string {
  return String(x?.id ?? x?.uuid ?? x?.slug ?? x?.table_name ?? "unknown");
}
function titleOf(x: any): string {
  return String(x?.dashboard_title ?? x?.slice_name ?? x?.table_name ?? x?.name ?? x?.title ?? "");
}
function textOf(x: any): string {
  return JSON.stringify(x).toLowerCase();
}
function classify(x: any, cfg: Config) {
  const text = textOf(x);
  const matched = cfg.courierKeywords.filter((k) => text.includes(k));
  const excluded = cfg.excludeKeywords.filter((k) => text.includes(k));
  const score = matched.length * 2 - excluded.length;
  return {
    score,
    matched_keywords: matched,
    excluded_keywords: excluded,
    classification: score >= 2 ? "courier_candidate" : matched.length ? "review" : "unrelated",
  };
}
async function saveJSON(path: string, data: unknown) {
  await writeFile(path, JSON.stringify(data, null, 2), { mode: 0o600 });
}
function getRows(x: any): any[] {
  if (Array.isArray(x?.result)) return x.result;
  if (Array.isArray(x?.result?.result)) return x.result.result;
  return [];
}

type ResourceStatus = "complete" | "incomplete" | "failed";

type ResourceResult = {
  rows: any[];
  api_count: number | null;
  downloaded_count: number | null;
  unique_ids_count: number | null;
  duplicate_rows: number | null;
  pages_count: number | null;
  status: ResourceStatus;
  download_error?: string;
};

type DetailErrorClass =
  | "http_401"
  | "http_403"
  | "http_429"
  | "http_5xx"
  | "http_4xx"
  | "network"
  | "other";

function classifyDetailError(detail: {
  status?: number;
  transient?: boolean;
  error_type?: string;
  error: string;
}): DetailErrorClass {
  const s = detail.status;
  if (s === 401) return "http_401";
  if (s === 403) return "http_403";
  if (s === 429) return "http_429";
  if (s != null && s >= 500) return "http_5xx";
  if (
    detail.transient ||
    detail.error_type ||
    /network|fetch|timeout|ECONN|ENOTFOUND|EAI_AGAIN|TLS|SSL|proxy/i.test(detail.error)
  ) {
    return "network";
  }
  if (s != null && s >= 400) return "http_4xx";
  return "other";
}

export type DiscoveryOptions = {
  /** Обновлять data/catalog.sqlite (по умолчанию false — read-only). */
  buildCatalog?: boolean;
  /** Сколько точечных detail-запросов на dashboard/chart (по умолчанию 2; 0 — не делать). */
  spotDetailLimit?: number;
  /** Загружать dashboard → charts/datasets relationships (по умолчанию true). */
  fetchRelations?: boolean;
};

export async function runDiscovery(
  client: SupersetClient,
  cfg: Config,
  opts: DiscoveryOptions = {},
) {
  const buildCatalog = opts.buildCatalog ?? false;
  const spotDetailLimit = Math.max(0, opts.spotDetailLimit ?? 2);
  const fetchRelations = opts.fetchRelations ?? true;

  await mkdir(cfg.outputDir, { recursive: true });
  const spotDir = join(cfg.outputDir, "spot_details");
  await mkdir(spotDir, { recursive: true });

  const store = buildCatalog ? new CatalogStore(cfg.sqlitePath) : null;
  let critical = false;

  const summary: any = {
    started_at: new Date().toISOString(),
    mode: buildCatalog ? "build-catalog" : "read-only",
    auth_mode: client.authMode(),
    resources: {},
    endpoint_errors: [],
    notes: [
      "Metadata discovery only. No source database access and no SQL execution.",
      buildCatalog
        ? "Catalog SQLite is updated in --build-catalog mode."
        : "Read-only mode: data/catalog.sqlite is NOT modified.",
      "No mass detail loading. Dataset details are loaded by phase1-1-dataset-detail-loader.ts.",
    ],
  };

  const resources = ["dashboard", "chart", "dataset"] as const;
  const all: Record<string, ResourceResult> = {};

  for (const resource of resources) {
    console.log(`[DISCOVERY] Listing ${resource}s (full pagination)`);
    try {
      const result = await client.listFull(resource);
      all[resource] = {
        rows: result.rows,
        api_count: result.api_count,
        downloaded_count: result.downloaded_count,
        unique_ids_count: result.unique_ids_count,
        duplicate_rows: result.duplicate_rows,
        pages_count: result.pages_count,
        status: "complete",
      };
      summary.resources[resource] = {
        api_count: result.api_count,
        downloaded_count: result.downloaded_count,
        unique_ids_count: result.unique_ids_count,
        duplicate_rows: result.duplicate_rows,
        pages_count: result.pages_count,
        status: "complete",
      };
      await saveJSON(join(cfg.outputDir, `${resource}s.json`), {
        result: result.rows,
        api_count: result.api_count,
        downloaded_count: result.downloaded_count,
        unique_ids_count: result.unique_ids_count,
        duplicate_rows: result.duplicate_rows,
        pages_count: result.pages_count,
        complete: true,
      });
      if (store) {
        for (const row of result.rows) store.saveObject(resource, idOf(row), titleOf(row), row);
      }
    } catch (e) {
      critical = true;
      const isPagination = e instanceof PaginationError;
      const status: ResourceStatus = isPagination ? "incomplete" : "failed";
      all[resource] = {
        rows: [],
        api_count: isPagination ? e.apiCount : null,
        downloaded_count: isPagination ? e.downloadedCount : null,
        unique_ids_count: isPagination ? e.uniqueIdsCount : null,
        duplicate_rows: isPagination ? e.duplicateRows : null,
        pages_count: isPagination ? e.pagesCount : null,
        status,
        download_error: String(e),
      };
      summary.resources[resource] = {
        api_count: isPagination ? e.apiCount : null,
        downloaded_count: isPagination ? e.downloadedCount : null,
        unique_ids_count: isPagination ? e.uniqueIdsCount : null,
        duplicate_rows: isPagination ? e.duplicateRows : null,
        pages_count: isPagination ? e.pagesCount : null,
        status,
        download_error: String(e),
      };
      summary.endpoint_errors.push({ resource, status, error: String(e) });
      console.warn(`[WARN] ${resource}: ${status} — ${String(e)}`);
    }
  }

  // --- Точечные detail-проверки (не массовая загрузка) ---
  const detailCounters: any = {
    attempted: 0,
    ok: 0,
    failed: 0,
    by_class: {
      http_401: 0,
      http_403: 0,
      http_429: 0,
      http_5xx: 0,
      http_4xx: 0,
      network: 0,
      other: 0,
    },
    errors: [] as any[],
  };

  for (const resource of ["dashboard", "chart"] as const) {
    const listData = all[resource];
    if (!listData || listData.status !== "complete" || listData.rows.length === 0) {
      console.warn(`[SKIP] ${resource}_detail spot checks: list not complete`);
      continue;
    }
    const limit = Math.min(spotDetailLimit, listData.rows.length);
    for (let i = 0; i < limit; i++) {
      const row = listData.rows[i];
      const id = idOf(row);
      const endpoint = `/api/v1/${resource}/${encodeURIComponent(id)}`;
      const detail = await client.tryGet(endpoint);
      detailCounters.attempted++;
      if (detail.ok) {
        detailCounters.ok++;
        await saveJSON(
          join(spotDir, `${resource}_${id.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`),
          detail.data,
        );
      } else {
        detailCounters.failed++;
        const cls = classifyDetailError(detail);
        detailCounters.by_class[cls]++;
        const error = {
          resource: `${resource}_detail`,
          id,
          status: detail.status ?? null,
          error_class: cls,
          transient: detail.transient ?? false,
          error_type: detail.error_type ?? null,
          error: detail.error,
        };
        detailCounters.errors.push(error);
        summary.endpoint_errors.push(error);
        if (cls === "http_401" || cls === "http_403" || cls === "http_429" || cls === "http_5xx" || cls === "network") {
          critical = true;
        }
      }
    }
  }

  summary.detail_spot_checks = {
    ...detailCounters,
    note: "Только точечная выборка; полные dataset detail загружает phase1-1-dataset-detail-loader.ts.",
  };
  summary.detail_summary = {
    total_attempted: detailCounters.attempted,
    success: detailCounters.ok,
    failed: detailCounters.failed,
    http401: detailCounters.by_class.http_401,
    by_class: detailCounters.by_class,
    note: "Точечные dashboard/chart detail; dataset detail — отдельный загрузчик.",
  };

  // --- Dashboard relationships (metadata only) ---
  if (fetchRelations) {
    for (const dash of all.dashboard?.rows ?? []) {
      const id = idOf(dash);
      for (const [kind, suffix] of [
        ["chart", "charts"],
        ["dataset", "datasets"],
      ] as const) {
        const result = await client.tryGet(`/api/v1/dashboard/${encodeURIComponent(id)}/${suffix}`);
        if (!result.ok) {
          const cls = classifyDetailError(result);
          summary.endpoint_errors.push({
            resource: `dashboard_${suffix}`,
            id,
            status: result.status ?? null,
            error_class: cls,
            transient: result.transient ?? false,
            error_type: result.error_type ?? null,
            error: result.error,
          });
          if (cls === "http_401" || cls === "http_403" || cls === "http_429" || cls === "http_5xx" || cls === "network") {
            critical = true;
          }
          continue;
        }
        const rows = getRows(result.data);
        await saveJSON(join(cfg.outputDir, `dashboard_${id}_${suffix}.json`), result.data);
        if (store) {
          for (const child of rows) {
            store.saveRelation("dashboard", id, kind, idOf(child), `contains_${kind}`);
          }
        }
      }
    }
  } else {
    summary.notes.push("Dashboard relationships skipped (--skip-relations).");
  }

  // --- Courier candidates ---
  const candidates: any[] = [];
  for (const [resource, listData] of Object.entries(all)) {
    for (const row of listData.rows) {
      const id = idOf(row);
      const cls = classify(row, cfg);
      if (cls.classification !== "unrelated") {
        candidates.push({ resource, id, title: titleOf(row), ...cls });
      }
    }
  }
  const uniqueCandidates = [...new Map(candidates.map((x) => [`${x.resource}:${x.id}`, x])).values()]
    .sort((a, b) => b.score - a.score);

  await saveJSON(join(cfg.outputDir, "courier_candidates.json"), uniqueCandidates);
  summary.courier_candidates = uniqueCandidates.length;

  const failedResources = Object.entries(summary.resources).filter(
    ([, r]: [string, any]) => r.status !== "complete",
  );
  summary.status = failedResources.length || critical ? "failed" : "ok";
  summary.finished_at = new Date().toISOString();
  await saveJSON(join(cfg.outputDir, "discovery_summary.json"), summary);
  if (store) store.close();

  const counts = resources
    .map((r) => `${r}s=${all[r]?.downloaded_count ?? "?"}/${all[r]?.api_count ?? "?"}`)
    .join(", ");
  console.log(`[SUMMARY] ${counts}`);
  console.log(
    `[SUMMARY] detail spot checks: attempted=${detailCounters.attempted} ok=${detailCounters.ok} failed=${detailCounters.failed} ` +
    `(401=${detailCounters.by_class.http_401}, 403=${detailCounters.by_class.http_403}, 5xx=${detailCounters.by_class.http_5xx}, network=${detailCounters.by_class.network})`,
  );
  console.log(`[SUMMARY] courier candidates=${uniqueCandidates.length}`);

  if (failedResources.length || critical) {
    process.exitCode = 1;
    console.log(`[FAILED] discovery completed with critical errors; report=${join(cfg.outputDir, "discovery_summary.json")}`);
    for (const [resource, r] of failedResources) {
      console.log(`  - ${resource}: ${(r as any).status}${(r as any).download_error ? ` — ${(r as any).download_error}` : ""}`);
    }
  } else {
    console.log(`[DONE] discovery complete; report=${join(cfg.outputDir, "discovery_summary.json")}`);
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const cfg = loadConfig();
  const client = new SupersetClient(cfg);
  const spotArg = args.find((a) => a.startsWith("--spot-detail-limit="));
  const opts: DiscoveryOptions = {
    buildCatalog: args.includes("--build-catalog"),
    fetchRelations: !args.includes("--skip-relations"),
    spotDetailLimit: spotArg ? Number(spotArg.split("=")[1]) : 2,
  };
  await client.login();
  await client.getCsrf();
  await runDiscovery(client, cfg, opts);
}
