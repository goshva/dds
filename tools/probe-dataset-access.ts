#!/usr/bin/env bun
/**
 * tools/probe-dataset-access.ts
 *
 * Read-only dataset authorization probe for `POST /api/v1/chart/data`.
 *
 * For every dataset it sends the smallest possible aggregate query
 * (`COUNT(<column>)`, `time_range: "No filter"`, `row_limit: 1`) and records the verdict:
 *   ALLOWED        вЂ” HTTP 200, `result[]` present
 *   NOT_AUTHORIZED вЂ” HTTP 401 (dataset permission / RLS boundary)
 *   ERROR          вЂ” any other status
 *   NO_LOCAL_COLUMNвЂ” no column known from the local catalog, probe skipped
 *
 * This is how the "can we pull block X from the API?" question is answered with evidence:
 * the code path is identical for every dataset, so a 401 is a permission fact, not a bug.
 *
 * Usage:
 *   bun tools/probe-dataset-access.ts --live --yes --datasets 3035,3466,5888
 *   bun tools/probe-dataset-access.ts --live --yes            # default block datasets
 *   bun tools/probe-dataset-access.ts --live --yes --session "<cookie>"   # analyst session
 *
 * Only POST /api/v1/chart/data and the auth/CSRF endpoints are called. Nothing is mutated.
 */

import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { ReadOnlySuperset, type CliArgs } from "./fetch-darkstore-aggregates";

const ROOT = resolve(import.meta.dir, "..");
const DEFAULT_OUT = "reports/phase-01-9/dataset_access_matrix.json";

/** Datasets behind the operational blocks (docs/phase-1.9/darkstore_7745_requirements_gap.md). */
export const DEFAULT_PROBE_DATASETS: Array<[number, string]> = [
  [3035, "darkstore_time_click (Р·Р°РєР°Р·С‹/СЃР»РѕС‚С‹, РєРѕРЅС‚СЂРѕР»СЊ)"],
  [5979, "darkstore_time_date_update (slice 20161)"],
  [3466, "darkstore_time_sheet (СЃР±РѕСЂРєР°/РІР°Р№С‚С‹)"],
  [5888, "РџСЂРёС‡РёРЅС‹ РЅРµ СЃР±РѕСЂРєРё 41 click"],
  [5542, "ost_group_ch41 (РЅРµСЃРѕР±СЂР°РЅРЅС‹Рµ)"],
  [3406, "not_collected_kafe_pek (СЃР»РѕС‚С‹)"],
  [7696, "count_delay_generals (РѕРїРѕР·РґР°РЅРёСЏ)"],
  [7006, "cargo_main2 (РјР°СЂС€СЂСѓС‚РёР·Р°С‚РѕСЂ, late)"],
  [4547, "dts_for_late_delivery"],
  [1583, "Р“СЂР°С„РёРєРё РєСѓСЂСЊРµСЂРѕРІ (Р—РР—)"],
  [5939, "hr_daily_pers_mentors (РЅР°СЃС‚Р°РІРЅРёРєРё)"],
  [7473, "hr_couriers_five_shifts (5 СЃРјРµРЅ)"],
  [5797, "hr_couriers (С‚РµРєСѓС‡РµСЃС‚СЊ)"],
  [7712, "photo_control_shift_bi (С„РѕС‚Рѕ)"],
  [7713, "photo_control_photo_kind"],
  [7607, "photo_control_shift_draft"],
  [3268, "internal_audits (Р°СѓРґРёС‚С‹)"],
  [6310, "audit_delivery_ds"],
  [4732, "darkstore_ts_partners_new (РўРњР—/СЃР»РѕС‚С‹)"],
  [6863, "tt_geographical_zone (РєР°СЂС‚Р°)"],
];

export type AccessVerdict = "ALLOWED" | "NOT_AUTHORIZED" | "ERROR" | "NO_LOCAL_COLUMN" | "NETWORK_ERROR";

export interface AccessProbeResult {
  dataset_id: number;
  label: string;
  metric?: string;
  status?: number;
  verdict: AccessVerdict;
  message?: string | null;
  rows?: number | null;
  colnames?: string[];
}

// --- local catalogue lookup (columns/metrics for the probe metric) ----------

function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function toObjects(rows: string[][]): Record<string, string>[] {
  const header = rows[0] ?? [];
  return rows.slice(1).filter((r) => r.length > 1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

async function loadCatalog(): Promise<{ column: Map<string, string>; metric: Map<string, string> }> {
  const column = new Map<string, string>();
  const metric = new Map<string, string>();
  const colsFile = Bun.file(`${ROOT}/reports/phase-01-6-2/dataset_columns.csv`);
  if (await colsFile.exists()) {
    for (const c of toObjects(parseCsv(await colsFile.text()))) {
      if (c.dataset_id && c.column_name && !column.has(c.dataset_id)) column.set(c.dataset_id, c.column_name);
    }
  }
  const metFile = Bun.file(`${ROOT}/reports/phase-01-6-2/dataset_metrics.csv`);
  if (await metFile.exists()) {
    for (const m of toObjects(parseCsv(await metFile.text()))) {
      if (m.dataset_id && m.metric_name && !metric.has(m.dataset_id)) metric.set(m.dataset_id, m.metric_name);
    }
  }
  return { column, metric };
}

// --- probe -----------------------------------------------------------------

/** Probe dataset authorization with a minimal COUNT query per dataset. */
export async function probeDatasetAccess(
  args: CliArgs,
  datasets: Array<[number, string]> = DEFAULT_PROBE_DATASETS,
  onLine?: (line: string) => void,
): Promise<AccessProbeResult[]> {
  const client = new ReadOnlySuperset(args);
  await client.authenticate();
  const catalog = await loadCatalog();
  const results: AccessProbeResult[] = [];

  for (const [id, label] of datasets) {
    const column = catalog.column.get(String(id));
    const namedMetric = catalog.metric.get(String(id));
    const metric = column
      ? { expressionType: "SIMPLE", column: { column_name: column }, aggregate: "COUNT", label: "cnt" }
      : namedMetric ?? null;
    if (!metric) {
      results.push({ dataset_id: id, label, verdict: "NO_LOCAL_COLUMN" });
      onLine?.(`${String(id).padEnd(6)} SKIP     ${label} (РєРѕР»РѕРЅРєР° РЅРµРёР·РІРµСЃС‚РЅР° Р»РѕРєР°Р»СЊРЅРѕ)`);
      continue;
    }
    const body = {
      datasource: { id, type: "table" },
      force: false,
      queries: [{
        time_range: "No filter",
        granularity: null,
        filters: [],
        extras: { where: "", having: "" },
        columns: [],
        metrics: [metric],
        row_limit: 1,
        is_timeseries: false,
        annotation_layers: [],
      }],
      form_data: { datasource: `${id}__table`, viz_type: "table", time_range: "No filter" },
      result_type: "full",
      result_format: "json",
    };
    const plan = {
      n: 1,
      source: "har" as const,
      file: "probe",
      chartId: null,
      chartName: label,
      sliceId: id,
      datasourceId: id,
      vizType: "table",
      body,
      bodySha256: "",
      url: `${args.baseUrl}/api/v1/chart/data?form_data=${encodeURIComponent(JSON.stringify({ slice_id: id }))}&dashboard_id=977`,
      metricNames: ["cnt"],
      dimensionColumns: [],
      temporalColumns: [],
    };
    const metricLabel = typeof metric === "string" ? metric : `COUNT(${metric.column?.column_name ?? "?"})`;
    try {
      const res = await client.postChartData(plan as any);
      const rows = Array.isArray(res.json?.result) ? (res.json.result[0]?.rowcount ?? null) : null;
      const colnames = Array.isArray(res.json?.result?.[0]?.colnames) ? res.json.result[0].colnames.map(String) : [];
      const allowed = res.status === 200 && Array.isArray(res.json?.result);
      const verdict: AccessVerdict = allowed ? "ALLOWED" : res.status === 401 ? "NOT_AUTHORIZED" : "ERROR";
      results.push({
        dataset_id: id,
        label,
        metric: metricLabel,
        status: res.status,
        verdict,
        message: allowed ? null : res.text.slice(0, 200),
        rows,
        colnames,
      });
      onLine?.(`${String(id).padEnd(6)} ${allowed ? "ALLOWED " : res.status === 401 ? "401 DENY" : `HTTP ${res.status}`} ${label} [${metricLabel}]`);
    } catch (error) {
      results.push({ dataset_id: id, label, metric: metricLabel, verdict: "NETWORK_ERROR", message: String(error).slice(0, 200) });
      onLine?.(`${String(id).padEnd(6)} NETWORK  ${label} вЂ” ${String(error).slice(0, 100)}`);
    }
  }
  return results;
}

// --- CLI -------------------------------------------------------------------

function parseArgs(argv: string[]): { args: CliArgs; datasets: Array<[number, string]>; out: string; help: boolean } {
  const base: CliArgs = {
    live: false,
    confirm: false,
    baseUrl: (Bun.env.SUPERSET_URL ?? "https://superset.svc.vkusvill.ru").replace(/\/+$/, ""),
    bodiesDir: "tools/har-out",
    outDir: "C:/Temp/ds-probe",
    shopno: "7745",
    weeks: 2,
    from: null,
    to: null,
    timeRange: null,
    rowLimit: 1,
    timeoutMs: 60_000,
    pollTimeoutMs: 60_000,
    addDateSupply: false,
    injectShopno: false,
    forceShopno: false,
    session: Bun.env.SUPERSET_SESSION_COOKIE ?? "",
    csrf: Bun.env.SUPERSET_CSRF_TOKEN ?? "",
    token: Bun.env.SUPERSET_ACCESS_TOKEN ?? "",
    username: Bun.env.SUPERSET_USERNAME ?? "",
    password: Bun.env.SUPERSET_PASSWORD ?? "",
    provider: Bun.env.SUPERSET_PROVIDER ?? "db",
    files: [],
    fromCharts: [],
    chartDetailsDir: "output/chart_details",
    offlineCharts: false,
    rawArtifacts: false,
    help: false,
  };
  let datasets = DEFAULT_PROBE_DATASETS;
  let out = DEFAULT_OUT;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => {
      const v = argv[++i];
      if (v == null) throw new Error(`missing value for ${a}`);
      return v;
    };
    switch (a) {
      case "--live": base.live = true; break;
      case "--yes": base.confirm = true; break;
      case "--help": case "-h": help = true; break;
      case "--base": base.baseUrl = next().replace(/\/+$/, ""); break;
      case "--session": base.session = next(); break;
      case "--csrf": base.csrf = next(); break;
      case "--token": base.token = next(); break;
      case "--username": base.username = next(); break;
      case "--password": base.password = next(); break;
      case "--provider": base.provider = next(); break;
      case "--timeout": base.timeoutMs = Number.parseInt(next(), 10) * 1000; break;
      case "--out": out = next(); break;
      case "--datasets": {
        const known = new Map(DEFAULT_PROBE_DATASETS.map(([id, label]) => [String(id), label]));
        datasets = next()
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)
          .map((x) => [Number.parseInt(x, 10), known.get(x) ?? `dataset ${x}`] as [number, string]);
        break;
      }
      default:
        throw new Error(`unknown option: ${a}`);
    }
  }
  if (!base.live || !base.confirm) throw new Error("--live --yes is required (nothing is sent otherwise)");
  return { args: base, datasets, out, help };
}

if (import.meta.main) {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`[ERROR] ${String(error)}`);
    console.error("usage: bun tools/probe-dataset-access.ts --live --yes [--datasets 3035,3466] [--session <cookie>] [--out <file>]");
    process.exitCode = 2;
    process.exit();
  }
  if (parsed.help) {
    console.log("usage: bun tools/probe-dataset-access.ts --live --yes [--datasets 3035,3466] [--session <cookie>] [--out <file>]");
    process.exit();
  }

  const results = await probeDatasetAccess(parsed.args, parsed.datasets, (line) => console.log(line));
  const allowed = results.filter((r) => r.verdict === "ALLOWED").map((r) => r.dataset_id);
  const denied = results.filter((r) => r.verdict === "NOT_AUTHORIZED").map((r) => r.dataset_id);
  const errors = results.filter((r) => r.verdict === "ERROR" || r.verdict === "NETWORK_ERROR").map((r) => r.dataset_id);

  const payload = {
    generated_at: new Date().toISOString(),
    base_url: parsed.args.baseUrl,
    probe: 'POST /api/v1/chart/data, COUNT(<local column>), time_range "No filter", row_limit 1',
    summary: { total: results.length, allowed: allowed.length, not_authorized: denied.length, errors: errors.length },
    allowed_datasets: allowed,
    not_authorized_datasets: denied,
    results,
  };
  await mkdir(dirname(resolve(parsed.out)), { recursive: true });
  await Bun.write(resolve(parsed.out), `${JSON.stringify(payload, null, 2)}\n`);

  console.log("");
  console.log(`ALLOWED (${allowed.length}): ${allowed.join(", ") || "-"}`);
  console.log(`401 NOT_AUTHORIZED (${denied.length}): ${denied.join(", ") || "-"}`);
  console.log(`written: ${parsed.out}`);
  process.exitCode = errors.length > 0 ? 1 : 0;
}
