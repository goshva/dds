import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "./config";
import { SupersetClient } from "./superset";
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
  const all: Record<string, any[]> = {};

  for (const resource of resources) {
    console.log(`[DISCOVERY] Listing ${resource}s`);
    try {
      const rows = await client.list(resource);
      all[resource] = rows;
      summary.resources[resource] = { count: rows.length, status: "ok" };
      await saveJSON(join(cfg.outputDir, `${resource}s.json`), { result: rows });
      for (const row of rows) {
        const id = idOf(row);
        store.saveObject(resource, id, titleOf(row), row);
      }
    } catch (e) {
      all[resource] = [];
      summary.resources[resource] = { count: 0, status: "failed" };
      summary.endpoint_errors.push({ resource, error: String(e) });
      console.warn(`[WARN] ${resource}: ${String(e)}`);
    }
  }

  const candidates: any[] = [];
  for (const [resource, rows] of Object.entries(all)) {
    for (const row of rows) {
      const id = idOf(row);
      const cls = classify(row, cfg);
      if (cls.classification !== "unrelated") candidates.push({ resource, id, title: titleOf(row), ...cls });
      const endpoint = `/api/v1/${resource}/${encodeURIComponent(id)}`;
      const detail = await client.tryGet(endpoint);
      if (detail.ok) {
        await saveJSON(join(cfg.outputDir, `${resource}_details`, `${id.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`), detail.data);
        store.saveObject(`${resource}_detail`, id, titleOf(detail.data?.result ?? detail.data), detail.data);
        const detailClass = classify(detail.data, cfg);
        if (detailClass.classification !== "unrelated") candidates.push({ resource: `${resource}_detail`, id, title: titleOf(detail.data?.result ?? detail.data), ...detailClass });
      } else {
        summary.endpoint_errors.push({ resource: `${resource}_detail`, id, status: detail.status, error: detail.error });
      }
    }
  }

  // Dashboard relationships are useful when endpoints are permitted.
  for (const dash of all.dashboard ?? []) {
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

  const uniqueCandidates = [...new Map(candidates.map(x => [`${x.resource}:${x.id}`, x])).values()]
    .sort((a, b) => b.score - a.score);

  await saveJSON(join(cfg.outputDir, "courier_candidates.json"), uniqueCandidates);
  summary.courier_candidates = uniqueCandidates.length;
  summary.finished_at = new Date().toISOString();
  await saveJSON(join(cfg.outputDir, "discovery_summary.json"), summary);
  store.close();

  console.log(`[DONE] dashboards=${all.dashboard?.length ?? 0}, charts=${all.chart?.length ?? 0}, datasets=${all.dataset?.length ?? 0}`);
  console.log(`[DONE] courier candidates=${uniqueCandidates.length}`);
  console.log(`[DONE] report=${join(cfg.outputDir, "discovery_summary.json")}`);
}
