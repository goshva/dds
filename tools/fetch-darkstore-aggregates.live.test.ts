// LIVE tests against real Superset data (read-only).
//
// OPT-IN: they only run when SUPERSET_LIVE_TESTS=1 is set explicitly, so a plain `bun test`
// (or the hermetic suites) can never trigger network traffic. Credentials come from `.env`
// (Bun loads it automatically).
//
// Run: bun run aggregates:test:live        # sets SUPERSET_LIVE_TESTS=1
//
// They fetch real chart metadata via GET /api/v1/chart/{id}, build chart/data requests from it,
// execute them and assert on real responses.
//
// Environment fact these tests encode (see reports/phase-01-9/dataset_access_matrix.json):
// our API account may aggregate dataset 3035 via POST /api/v1/chart/data; other datasets
// answer HTTP 401 "Not authorized" (Superset dataset permission boundary, not a code path).
import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ReadOnlySuperset,
  buildBodyFromChartDetail,
  runPipeline,
  type CliArgs,
} from "./fetch-darkstore-aggregates";
import { probeDatasetAccess } from "./probe-dataset-access";

const liveEnabled = Bun.env.SUPERSET_LIVE_TESTS === "1";
const hasCredentials = Boolean(
  (Bun.env.SUPERSET_USERNAME && Bun.env.SUPERSET_PASSWORD) || Bun.env.SUPERSET_ACCESS_TOKEN || Bun.env.SUPERSET_SESSION_COOKIE,
);
const live = liveEnabled && hasCredentials ? test : test.skip;
const LIVE_TIMEOUT = 300_000;

/** Charts on dataset 3035 (authorized for this account). */
const ALLOWED_CHARTS = {
  slots: 20209, // ds 3035 вЂ” СЃР»РѕС‚С‹, dashboard 977
  zones: 23507, // ds 3035 вЂ” Р·РѕРЅС‹/РєР»Р°СЃС‚РµСЂС‹
} as const;
/** Chart on dataset 3466 вЂ” used to pin the permission boundary. */
const RESTRICTED_CHART = 25053; // ds 3466 вЂ” СЃР±РѕСЂРєР°
const ALLOWED_DATASET = 3035;
const RESTRICTED_DATASET = 3466;

function liveArgs(outDir: string, over: Partial<CliArgs> = {}): CliArgs {
  return {
    live: true,
    confirm: true,
    baseUrl: (Bun.env.SUPERSET_URL ?? "https://superset.svc.vkusvill.ru").replace(/\/+$/, ""),
    bodiesDir: "tools/har-out",
    outDir,
    shopno: "7745",
    weeks: 2,
    from: null,
    to: null,
    timeRange: null,
    rowLimit: 500,
    timeoutMs: 90_000,
    pollTimeoutMs: 180_000,
    addDateSupply: true,
    injectShopno: true,
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
    ...over,
  };
}

type Validation = {
  summary: { requests: number; ok: number; failed: number; observations: number; aggregate_rows: number };
  requests: Array<{ status: number | null; mode: string; rowcount: number | null; colnames: string[]; problems: string[] }>;
};
type Manifest = {
  mode: string;
  period: { time_range: string };
  sources: Array<{ source: string; chart_id: number | null; chart_name: string; datasource_id: number | null; metric_names: string[] }>;
  additive_metrics: string[];
  ratio_metrics: string[];
  observations: number;
  aggregate_rows: number;
};

/** Reuse the shipped CSV parser shape: header + rows. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += ch; }
    else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

describe("live Superset (real data)", () => {
  live("chart metadata comes from the API with a usable query_context", async () => {
    const client = new ReadOnlySuperset(liveArgs("unused"));
    await client.authenticate();

    const detail = await client.getChart(ALLOWED_CHARTS.slots);
    const r = detail?.result ?? {};

    expect(r.id).toBe(ALLOWED_CHARTS.slots);
    expect(String(r.slice_name ?? "").length).toBeGreaterThan(0);
    expect(r.datasource_id).toBe(ALLOWED_DATASET);
    expect(r.datasource_type).toBe("table");

    const qc = JSON.parse(r.query_context);
    expect(Array.isArray(qc.queries)).toBe(true);
    expect(qc.queries[0].metrics.length).toBeGreaterThan(0);

    const body = buildBodyFromChartDetail(detail);
    expect(body.datasource.id).toBe(ALLOWED_DATASET);
    expect(body.form_data.slice_id).toBe(ALLOWED_CHARTS.slots);
  }, LIVE_TIMEOUT);

  live("issued charts on 3035 return real 7745 rows and real aggregates", async () => {
    for (const [block, chartId] of Object.entries(ALLOWED_CHARTS)) {
      const outDir = await mkdtemp(join(tmpdir(), `dds-7745-live-${block}-`));
      const exitCode = await runPipeline(liveArgs(outDir, { fromCharts: [chartId] }));

      const validation = (await Bun.file(join(outDir, "validation.json")).json()) as Validation;
      const manifest = (await Bun.file(join(outDir, "manifest.json")).json()) as Manifest;

      expect(exitCode).toBe(0);
      expect(manifest.sources[0]?.chart_id).toBe(chartId);
      expect(manifest.sources[0]?.datasource_id).toBe(ALLOWED_DATASET);
      expect(manifest.sources[0]?.metric_names.length).toBeGreaterThan(0);
      expect(validation.summary.ok).toBe(1);
      expect(validation.summary.failed).toBe(0);
      expect(validation.summary.observations).toBeGreaterThan(0);

      const req = validation.requests[0]!;
      expect(req.status).toBe(200);
      expect(req.problems).toEqual([]);
      expect(req.rowcount ?? 0).toBeGreaterThan(0);

      // the built request really filters the requested darkstore
      const request = (await Bun.file(join(outDir, `chart_${chartId}.request.json`)).json()) as any;
      const filters = request.queries[0].filters ?? [];
      expect(filters.some((f: any) => f.col === "shopno" && String(f.op).includes("IN") && f.val.includes("7745"))).toBe(true);

      // the response carries real numbers
      const response = (await Bun.file(join(outDir, `chart_${chartId}.response.json`)).json()) as any;
      expect(response.result[0].error ?? null).toBeNull();
      expect(response.result[0].data.length).toBeGreaterThan(0);

      const csv = parseCsv(await Bun.file(join(outDir, "aggregate_7745.csv")).text());
      expect(csv.length).toBeGreaterThan(1);
      const header = csv[0]!;
      const valueColumns = header.filter((h) => h === "qty_orders_delivered" || /^qty_|^sum_/.test(h));
      expect(valueColumns.length).toBeGreaterThan(0);
      const hasNonZero = csv.slice(1).some((row) => valueColumns.some((c) => Number(row[header.indexOf(c)] ?? 0) > 0));
      expect(hasNonZero).toBe(true);
    }
  }, LIVE_TIMEOUT);

  live("dataset permission boundary is visible and explicit", async () => {
    const results = await probeDatasetAccess(
      liveArgs("unused"),
      [[ALLOWED_DATASET, "darkstore_time_click"], [RESTRICTED_DATASET, "darkstore_time_sheet"]],
    );

    const allowed = results.find((r) => r.dataset_id === ALLOWED_DATASET)!;
    const restricted = results.find((r) => r.dataset_id === RESTRICTED_DATASET)!;

    expect(allowed.verdict).toBe("ALLOWED");
    expect(allowed.status).toBe(200);
    // either the account was granted access, or Superset answers 401 "Not authorized"
    if (restricted.verdict === "NOT_AUTHORIZED") {
      expect(restricted.status).toBe(401);
      expect(String(restricted.message)).toContain("Not authorized");
    } else {
      expect(restricted.verdict).toBe("ALLOWED");
      expect(restricted.status).toBe(200);
    }
  }, LIVE_TIMEOUT);

  live("a chart on a restricted dataset fails loudly with HTTP 401", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "dds-7745-live-restricted-"));
    const exitCode = await runPipeline(liveArgs(outDir, { fromCharts: [RESTRICTED_CHART] }));

    const validation = (await Bun.file(join(outDir, "validation.json")).json()) as Validation;
    const manifest = (await Bun.file(join(outDir, "manifest.json")).json()) as Manifest;
    const probe = await probeDatasetAccess(liveArgs("unused"), [[RESTRICTED_DATASET, "darkstore_time_sheet"]]);
    const restricted = probe[0]!;

    // metadata is readable ...
    expect(manifest.sources[0]?.chart_id).toBe(RESTRICTED_CHART);
    expect(manifest.sources[0]?.datasource_id).toBe(RESTRICTED_DATASET);

    if (restricted.verdict === "NOT_AUTHORIZED") {
      // ... but the aggregate query is refused, and the tool reports it instead of pretending success
      expect(exitCode).toBe(1);
      expect(validation.summary.ok).toBe(0);
      expect(validation.summary.failed).toBe(1);
      expect(validation.requests[0]?.status).toBe(401);
      expect(validation.requests[0]?.problems.join(" ")).toContain("Not authorized");
    } else {
      expect(exitCode).toBe(0);
      expect(validation.summary.ok).toBe(1);
    }
  }, LIVE_TIMEOUT);
});
