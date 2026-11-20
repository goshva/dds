import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "./config";
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
  const matched = cfg.courierKeywords.filter(k => text.includes(k));
  const excluded = cfg.excludeKeywords.filter(k => text.includes(k));
  const score = matched.length * 2 - excluded.length;
  return { score, matched_keywords: matched, excluded_keywords: excluded, classification: score >= 2 ? "courier_candidate" : matched.length ? "review" : "unrelated" };
}
async function saveJSON(path: string, data: unknown) {
  await writeFile(path, JSON.stringify(data, null, 2), { mode: 0o600 });
}
function getRows(x: any): any[] {
  if (Array.isArray(x?.result)) return x.result;
  if (Array.isArray(x?.result?.result)) return x.result.result;
  return [];
}

export async function runDiscovery(client: SupersetClient, cfg: Config) {
  await mkdir(cfg.outputDir, { recursive: true });
  for (const dir of ["dashboard_details", "chart_details", "dataset_details"]) {
    await mkdir(join(cfg.outputDir, dir), { recursive: true });
  }

  const store = new CatalogStore(cfg.sqlitePath);
  const summary: any = {
    started_at: new Date().toISOString(),
    auth_mode: client.authMode(),
    resources: {},
    endpoint_errors: [],
    notes: ["Metadata discovery only. No source database access and no SQL execution."]
  };

  const resources = ["dashboard", "chart", "dataset"] as const;
  const all: Record<string, { rows: any[]; api_count: number; status: string; download_error?: string }> = {};

  for (const resource of resources) {
    console.log(`[DISCOVERY] Listing ${resource}s (full pagination)`);
    try {
      const result = await client.listFull(resource);
      all[resource] = {
        rows: result.rows,
        api_count: result.api_count,
        status: "complete",
      };
      summary.resources[resource] = {
        api_count: result.api_count,
        downloaded_count: result.downloaded_count,
        pages_count: result.pages_count,
        status: "complete",
      };
      await saveJSON(join(cfg.outputDir, `${resource}s.json`), { result: result.rows, api_count: result.api_count });
      for (const row of result.rows) {
        const id = idOf(row);
        store.saveObject(resource, id, titleOf(row), row);
      }
    } catch (e) {
      all[resource] = { rows: [], api_count: 0, status: "failed" };
      const status = e instanceof PaginationError ? "incomplete" : "failed";
      all[resource].status = status;
      summary.resources[resource] = {
        api_count: e instanceof PaginationError ? e.apiCount : 0,
        downloaded_count: e instanceof PaginationError ? e.downloadedCount : 0,
        status,
        download_error: String(e),
      };
      summary.endpoint_errors.push({ resource, error: String(e), status });
      console.warn(`[WARN] ${resource}: ${status} — ${String(e)}`);
    }
  }

  // --- Detail extraction (readonly, no overwrite of SQLite) ---
  // Мы не пишем detail обратно в catalog, только в output.
  // Для ресурсных детайлов используем ID из успешно выгруженного списка.
  const detailResources = ["dashboard", "chart", "dataset"] as const;
  let detailOk = 0, detailFail = 0, detail401 = 0;

  for (const resource of detailResources) {
    const listData = all[resource];
    if (!listData || listData.status !== "complete") {
      console.warn(`[SKIP] ${resource}_detail: list not complete, skipping detail extraction`);
      continue;
    }
    console.log(`[DISCOVERY] Fetching ${resource}_detail (${listData.rows.length} objects)`);
    for (let i = 0; i < listData.rows.length; i++) {
      const row = listData.rows[i];
      const id = idOf(row);
      if (i > 0 && i % 100 === 0) console.log(`  [${i}/${listData.rows.length}] ${resource} detail...`);

      const endpoint = `/api/v1/${resource}/${encodeURIComponent(id)}`;
      const detail = await client.tryGet(endpoint);
      if (detail.ok) {
        detailOk++;
        await saveJSON(
          join(cfg.outputDir, `${resource}_details`, `${id.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`),
          detail.data
        );
        store.saveObject(`${resource}_detail`, id, titleOf(detail.data?.result ?? detail.data), detail.data);
      } else {
        detailFail++;
        if (detail.status === 401) detail401++;
        summary.endpoint_errors.push({
          resource: `${resource}_detail`,
          id,
          status: detail.status,
          error: detail.error,
          transient: detail.transient,
        });
      }
    }
  }

  summary.detail_summary = {
    total_attempted: detailOk + detailFail,
    success: detailOk,
    failed: detailFail,
    http401: detail401,
  };

  // Dashboard relationships
  for (const dash of all.dashboard?.rows ?? []) {
    const id = idOf(dash);
    for (const [kind, suffix] of [["chart", "charts"], ["dataset", "datasets"]] as const) {
      const result = await client.tryGet(`/api/v1/dashboard/${encodeURIComponent(id)}/${suffix}`);
      if (!result.ok) {
        summary.endpoint_errors.push({ resource: `dashboard_${suffix}`, id, status: result.status, error: result.error });
        continue;
      }
      const rows = getRows(result.data);
      await saveJSON(join(cfg.outputDir, `dashboard_${id}_${suffix}.json`), result.data);
      for (const child of rows) {
        const childId = idOf(child);
        store.saveRelation("dashboard", id, kind, childId, `contains_${kind}`);
      }
    }
  }

  // Courier candidates
  const candidates: any[] = [];
  for (const [resource, listData] of Object.entries(all)) {
    if (!listData?.rows) continue;
    for (const row of listData.rows) {
      const id = idOf(row);
      const cls = classify(row, cfg);
      if (cls.classification !== "unrelated") {
        candidates.push({ resource, id, title: titleOf(row), ...cls });
      }
    }
  }
  const uniqueCandidates = [...new Map(candidates.map(x => [`${x.resource}:${x.id}`, x])).values()]
    .sort((a, b) => b.score - a.score);

  await saveJSON(join(cfg.outputDir, "courier_candidates.json"), uniqueCandidates);
  summary.courier_candidates = uniqueCandidates.length;
  summary.finished_at = new Date().toISOString();
  await saveJSON(join(cfg.outputDir, "discovery_summary.json"), summary);
  store.close();

  console.log(`[DONE] dashboards=${all.dashboard?.rows?.length ?? 0}/${all.dashboard?.api_count ?? "?"}, charts=${all.chart?.rows?.length ?? 0}/${all.chart?.api_count ?? "?"}, datasets=${all.dataset?.rows?.length ?? 0}/${all.dataset?.api_count ?? "?"}`);
  console.log(`[DONE] detail: ${detailOk} ok, ${detailFail} failed (${detail401}×401)`);
  console.log(`[DONE] courier candidates=${uniqueCandidates.length}`);
  console.log(`[DONE] report=${join(cfg.outputDir, "discovery_summary.json")}`);
}
