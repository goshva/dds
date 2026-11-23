// Adversarial / edge-case tests for --from-chart: multi-query charts, missing or broken
// query_context, unknown SQL, ambiguous temporal fields, shopno conflicts, completeness rules.
// Fully hermetic: no network, synthetic payloads plus the real saved chart details.
import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  aggregate,
  assessQuality,
  buildBodyFromChartDetail,
  countDuplicateRows,
  extractObservations,
  planMetas,
  runPipeline,
  transformBody,
  type CliArgs,
  type QueryExtractionStat,
  type RequestPlan,
} from "./fetch-darkstore-aggregates";

const baseArgs: CliArgs = {
  live: false,
  confirm: false,
  baseUrl: "https://superset.example.test",
  bodiesDir: "tools/har-out",
  outDir: "C:/Temp/unused",
  shopno: "7745",
  weeks: 2,
  from: null,
  to: null,
  timeRange: null,
  rowLimit: 1000,
  timeoutMs: 1_000,
  pollTimeoutMs: 1_000,
  addDateSupply: true,
  injectShopno: true,
  forceShopno: false,
  session: "",
  csrf: "",
  token: "",
  username: "",
  password: "",
  provider: "db",
  files: [],
  fromCharts: [],
  chartDetailsDir: "output/chart_details",
  offlineCharts: false,
  rawArtifacts: false,
  help: false,
};

const readDetail = async (id: number) => JSON.parse(await Bun.file(`output/chart_details/${id}.json`).text());

function planOf(body: any, chartId: number | null = null, viz = "table"): RequestPlan {
  const metas = planMetas(body);
  const first = metas[0] ?? { metricNames: [], dimensionColumns: [], temporalColumns: [], temporalChosen: null, rowLimit: null, isTimeseries: false, postProcessing: false };
  return {
    n: 1,
    source: chartId ? "chart" : "har",
    file: chartId ? `chart:${chartId}` : "synthetic",
    chartId,
    chartName: "synthetic",
    sliceId: body?.form_data?.slice_id ?? chartId,
    datasourceId: body?.datasource?.id ?? null,
    vizType: viz,
    body,
    bodySha256: "",
    url: "",
    metricNames: first.metricNames,
    dimensionColumns: first.dimensionColumns,
    temporalColumns: first.temporalColumns,
    queryMetas: metas,
  };
}

function stat(over: Partial<QueryExtractionStat> = {}): QueryExtractionStat {
  return {
    query_index: 0,
    row_count: 10,
    observations: 20,
    metric_names: ["qty_orders_delivered"],
    dimension_columns: ["night_and_others"],
    temporal_chosen: "date_supply",
    temporal_candidates: ["date_supply"],
    missing_metrics: [],
    missing_dimensions: [],
    row_limit: 100,
    truncated: false,
    colnames: ["date_supply", "night_and_others", "qty_orders_delivered"],
    duplicate_rows: 0,
    warnings: [],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// multi-query and fallbacks
// ---------------------------------------------------------------------------

describe("multi-query charts", () => {
  test("real chart 23507 carries two queries and extraction is per-query", async () => {
    const body = buildBodyFromChartDetail(await readDetail(23507));
    const plan = planOf(body, 23507);

    expect(plan.queryMetas.length).toBe(2);
    const q0 = plan.queryMetas[0]!;
    const q1 = plan.queryMetas[1]!;
    expect(q0.metricNames.length).toBeGreaterThan(0);

    // response mirrors queries[] order
    const response = {
      result: [
        { error: null, rowcount: 1, colnames: ["date_supply", "night_and_others", ...q0.metricNames], data: [{ date_supply: "2026-11-10", night_and_others: "X", ...Object.fromEntries(q0.metricNames.map((m) => [m, 1])) }] },
        { error: null, rowcount: 1, colnames: ["date_supply", ...q1.metricNames], data: [{ date_supply: "2026-11-11", ...Object.fromEntries(q1.metricNames.map((m) => [m, 2])) }] },
      ],
    };

    const { observations, queryStats, warnings } = extractObservations(plan, response);

    expect(queryStats.length).toBe(2);
    expect(warnings).toEqual([]);
    expect(new Set(observations.map((o) => o.queryIndex))).toEqual(new Set([0, 1]));
    for (const o of observations) {
      const meta = plan.queryMetas[o.queryIndex!]!;
      expect(meta.metricNames).toContain(o.metric);
    }
  });

  test("missing query_context falls back to params", () => {
    const detail = {
      result: {
        id: 777,
        slice_name: "params only",
        viz_type: "pivot_table_v2",
        datasource_id: 3035,
        datasource_type: "table",
        params: JSON.stringify({
          metrics: ["qty_orders_delivered"],
          groupbyRows: ["date_supply"],
          granularity_sqla: "date_supply",
          time_range: "last week : ",
          row_limit: 50,
          adhoc_filters: [{ expressionType: "SIMPLE", subject: "shopno", operator: "IN", comparator: ["7745"] }],
        }),
      },
    };

    const body = buildBodyFromChartDetail(detail);
    expect(body.datasource.id).toBe(3035);
    expect(body.queries.length).toBe(1);
    expect(body.queries[0].metrics).toEqual(["qty_orders_delivered"]);
    expect(body.queries[0].columns).toEqual(["date_supply"]);
    expect(body.queries[0].filters[0]).toEqual({ col: "shopno", op: "IN", val: ["7745"] });
    expect(body.form_data.datasource).toBe("3035__table");
  });

  test("broken JSON in query_context/params does not crash and keeps the datasource", () => {
    const detail = {
      result: {
        id: 778,
        slice_name: "broken",
        viz_type: "table",
        datasource_id: 3466,
        datasource_type: "table",
        query_context: "{not json",
        params: "[also not json",
      },
    };

    const body = buildBodyFromChartDetail(detail);
    expect(body.datasource.id).toBe(3466);
    expect(Array.isArray(body.queries)).toBe(true);
    expect(body.queries.length).toBe(1);
    expect(body.form_data.slice_id).toBe(778);
  });

  test("empty queries[] falls back to params", () => {
    const detail = {
      result: {
        id: 779,
        slice_name: "empty queries",
        viz_type: "table",
        datasource_id: 3035,
        datasource_type: "table",
        query_context: JSON.stringify({ datasource: { id: 3035, type: "table" }, queries: [], form_data: { slice_id: 779 } }),
        params: JSON.stringify({ metrics: ["qty_orders_delivered"], groupby: ["date_supply"] }),
      },
    };

    const body = buildBodyFromChartDetail(detail);
    expect(body.queries.length).toBe(1);
    expect(body.queries[0].metrics).toEqual(["qty_orders_delivered"]);
  });

  test("chart metadata wins over a conflicting query_context datasource", () => {
    const detail = {
      result: {
        id: 780,
        slice_name: "mismatch",
        viz_type: "table",
        datasource_id: 111,
        datasource_type: "table",
        query_context: JSON.stringify({ datasource: { id: 222, type: "table" }, queries: [{ metrics: ["m"], columns: ["c"], filters: [] }], form_data: {} }),
        params: "{}",
      },
    };

    const body = buildBodyFromChartDetail(detail);
    expect(body.datasource.id).toBe(111);
    expect(body.form_data.datasource).toBe("111__table");
  });
});

// ---------------------------------------------------------------------------
// ad-hoc SQL and temporal ambiguity
// ---------------------------------------------------------------------------

describe("ad-hoc SQL and temporal fields", () => {
  test("unknown SQL function is tolerated and the underlying date column is found", () => {
    const body = {
      datasource: { id: 3035, type: "table" },
      queries: [{
        metrics: ["qty_orders_delivered"],
        columns: [{ label: "Р”Р°С‚Р°", sqlExpression: "weirdUnknownFunc(date_supply)", expressionType: "SQL" }],
        filters: [],
        extras: {},
        row_limit: 100,
      }],
      form_data: { slice_id: 1, viz_type: "table" },
    };

    const metas = planMetas(body);
    expect(metas[0]!.temporalColumns).toContain("date_supply");

    const report = transformBody(body, baseArgs, { expression: "2026-11-10 : 2026-11-23" });
    // the ad-hoc column already carries the date dimension: nothing is added
    expect(report.datesupplyAdded).toBe(0);
    expect(body.queries[0].columns.length).toBe(1);
  });

  test("ambiguous temporal fields: the first candidate is used and all candidates are recorded", () => {
    const body = {
      datasource: { id: 3035, type: "table" },
      queries: [{
        metrics: ["qty_orders_delivered"],
        columns: ["night_and_others", "date_order"],
        filters: [
          { col: "date_supply", op: "TEMPORAL_RANGE", val: "No filter" },
          { col: "date_order", op: "TEMPORAL_RANGE", val: "No filter" },
        ],
        granularity: "date_supply",
        extras: {},
        row_limit: 100,
      }],
      form_data: { slice_id: 2, viz_type: "table", granularity_sqla: "date_supply" },
    };

    const report = transformBody(body, baseArgs, { expression: "2026-11-10 : 2026-11-23" });
    const metas = planMetas(body);

    expect(metas[0]!.temporalChosen).toBe("date_supply");
    expect(metas[0]!.temporalColumns.length).toBeGreaterThan(1);
    expect(report.temporalRewrites).toBe(2); // both TEMPORAL_RANGE filters rewritten
    // the chart's own grain (date_order) is kept and the ambiguity is reported, never silently mixed
    expect(report.datesupplyAdded).toBe(0);
    expect(report.temporalAmbiguity).toContain("date_order");
    expect(body.queries[0].columns).toEqual(["night_and_others", "date_order"]);
  });
});

// ---------------------------------------------------------------------------
// shopno semantics
// ---------------------------------------------------------------------------

describe("shopno filter conflicts", () => {
  const bodyWith = (filters: any[]) => ({
    datasource: { id: 3035, type: "table" },
    queries: [{ metrics: ["qty_orders_delivered"], columns: ["night_and_others"], filters, extras: {}, granularity: "date_supply", row_limit: 100 }],
    form_data: { slice_id: 3, viz_type: "table" },
  });

  test("an existing shopno IN is rewritten explicitly, not silently", () => {
    const body = bodyWith([{ col: "shopno", op: "IN", val: ["1111"] }]);
    const report = transformBody(body, baseArgs, { expression: "A : B" });

    expect(report.shopnoRewrites).toBe(1);
    expect(report.shopnoOriginalValues).toEqual(["1111"]);
    expect(report.shopnoExcluded).toBe(false);
    expect(report.semanticOverrides.some((s) => s.includes("1111"))).toBe(true);
    expect(body.queries[0].filters[0].val).toEqual(["7745"]);
  });

  test("a NOT IN excluding the target darkstore is flagged, not hidden", () => {
    const body = bodyWith([{ col: "shopno", op: "NOT IN", val: ["7745", "8519"] }]);
    const report = transformBody(body, baseArgs, { expression: "A : B" });

    expect(report.shopnoExcluded).toBe(true);
    expect(report.shopnoRewrites).toBe(0); // NOT IN is never rewritten
    // the exclusion stays untouched ...
    const notIn = body.queries[0].filters.find((f: any) => /NOT\s*IN/i.test(String(f.op)));
    expect(notIn?.val).toEqual(["7745", "8519"]);
    // ... and a positive bound is injected, because a NOT IN alone spans all other darkstores
    expect(report.shopnoInjected).toBe(1);
    expect(body.queries[0].filters.some((f: any) => f.col === "shopno" && String(f.op).toUpperCase() === "IN")).toBe(true);
    expect(report.semanticOverrides.some((s) => s.includes("excludes"))).toBe(true);
  });

  test("pipeline refuses to query a chart that excludes the darkstore", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dds-edge-excluded-"));
    await Bun.write(
      join(dir, "9001.json"),
      JSON.stringify({
        result: {
          id: 9001,
          slice_name: "excludes 7745",
          viz_type: "table",
          datasource_id: 3035,
          datasource_type: "table",
          params: "{}",
          query_context: JSON.stringify({
            datasource: { id: 3035, type: "table" },
            queries: [{ metrics: ["qty_orders_delivered"], columns: ["night_and_others"], filters: [{ col: "shopno", op: "NOT IN", val: ["7745"] }], extras: {}, granularity: "date_supply", row_limit: 100 }],
            form_data: { slice_id: 9001, viz_type: "table" },
          }),
        },
      }),
    );

    const outDir = await mkdtemp(join(tmpdir(), "dds-edge-excluded-out-"));
    await runPipeline({ ...baseArgs, outDir, offlineCharts: true, chartDetailsDir: dir, fromCharts: [9001] });

    const quality = (await Bun.file(join(outDir, "quality.json")).json()) as any;
    expect(quality.requests[0].completeness).toBe("none");
    expect(quality.requests[0].problems.join(" ")).toContain("SHOPNO_EXCLUDED");
    expect(quality.run.completeness.none).toBe(1);
  });

  test("--force-shopno lets the same chart through", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dds-edge-forced-"));
    await Bun.write(
      join(dir, "9002.json"),
      JSON.stringify({
        result: {
          id: 9002,
          slice_name: "excludes 7745",
          viz_type: "table",
          datasource_id: 3035,
          datasource_type: "table",
          params: "{}",
          query_context: JSON.stringify({
            datasource: { id: 3035, type: "table" },
            queries: [{ metrics: ["qty_orders_delivered"], columns: ["night_and_others"], filters: [{ col: "shopno", op: "NOT IN", val: ["7745"] }], extras: {}, granularity: "date_supply", row_limit: 100 }],
            form_data: { slice_id: 9002, viz_type: "table" },
          }),
        },
      }),
    );

    const outDir = await mkdtemp(join(tmpdir(), "dds-edge-forced-out-"));
    await runPipeline({ ...baseArgs, outDir, offlineCharts: true, chartDetailsDir: dir, fromCharts: [9002], forceShopno: true });

    const manifest = (await Bun.file(join(outDir, "manifest.json")).json()) as any;
    expect(manifest.transforms[0].shopnoExcluded).toBe(true);
    expect(manifest.transforms[0].semanticOverrides.some((s: string) => s.includes("excludes"))).toBe(true);
    const quality = (await Bun.file(join(outDir, "quality.json")).json()) as any;
    expect(quality.requests[0].problems.join(" ")).not.toContain("SHOPNO_EXCLUDED");
  });
});

// ---------------------------------------------------------------------------
// quality gate
// ---------------------------------------------------------------------------

describe("quality gate", () => {
  const plan = planOf({
    datasource: { id: 3035, type: "table" },
    queries: [{ metrics: ["qty_orders_delivered", "share_not_in_slot_all"], columns: ["night_and_others"], filters: [], granularity: "date_supply", row_limit: 100, extras: {} }],
    form_data: { slice_id: 4, viz_type: "table" },
  }, 4);

  const base = {
    plan,
    status: 200,
    mode: "200",
    rowCount: 10,
    problems: [] as string[],
    warnings: [] as string[],
    queryStats: [stat()],
    observations: [],
    ratioWeightedMetrics: [] as string[],
    ratioUnweightedMetrics: [] as string[],
    timeRange: "2026-11-10 : 2026-11-23",
  };

  test("full only when nothing is missing", () => {
    const q = assessQuality({ ...base, queryStats: [stat({ metric_names: ["qty_orders_delivered"], colnames: ["date_supply", "night_and_others", "qty_orders_delivered"] })] });
    expect(q.completeness).toBe("full");
    expect(q.duplicate_rows).toBe(0);
    expect(q.aggregation_method).toContain("superset_chart_data");
  });

  test("missing declared metrics downgrade to partial", () => {
    const q = assessQuality({ ...base, queryStats: [stat({ metric_names: ["qty_orders_delivered", "missing_metric"], missing_metrics: ["missing_metric"] })] });
    expect(q.completeness).toBe("partial");
    expect(q.missing_metrics).toEqual(["missing_metric"]);
  });

  test("row_count at row_limit is truncated, not full", () => {
    const q = assessQuality({ ...base, rowCount: 100, queryStats: [stat({ row_count: 100, row_limit: 100, truncated: true })] });
    expect(q.completeness).toBe("truncated");
    expect(q.truncated_queries).toEqual([0]);
    expect(q.completeness_reason).toContain("row_limit");
  });

  test("a sibling query hitting its limit is not hidden by the first query's limit", () => {
    const q = assessQuality({
      ...base,
      rowCount: 30,
      queryStats: [
        stat({ query_index: 0, row_count: 20, row_limit: 100, truncated: false }),
        stat({ query_index: 1, row_count: 10, row_limit: 10, truncated: true }),
      ],
    });
    expect(q.completeness).toBe("truncated");
    expect(q.truncated_queries).toEqual([1]);
  });

  test("missing dimensions, duplicated rows and query-count mismatch downgrade to partial", () => {
    expect(assessQuality({ ...base, queryStats: [stat({ missing_dimensions: ["night_and_others"] })] }).completeness).toBe("partial");
    expect(assessQuality({ ...base, queryStats: [stat({ duplicate_rows: 3 })] }).completeness).toBe("partial");
    const mismatch = assessQuality({ ...base, queryCountMismatch: true });
    expect(mismatch.completeness).toBe("partial");
    expect(mismatch.query_count_mismatch).toBe(true);
  });

  test("applied filters are reported per query, not only for the first one", () => {
    const multi = planOf({
      datasource: { id: 3035, type: "table" },
      queries: [
        { metrics: ["qty_orders_delivered"], columns: ["night_and_others"], filters: [{ col: "shopno", op: "IN", val: ["7745"] }], granularity: "date_supply", row_limit: 100, extras: {} },
        { metrics: ["qty_couriers"], columns: ["night_and_others"], filters: [{ col: "feature_tt", op: "IN", val: ["ДаркСтор"] }], granularity: "date_supply", row_limit: 100, extras: {} },
      ],
      form_data: { slice_id: 5, viz_type: "table" },
    }, 5);

    const q = assessQuality({ ...base, plan: multi, queryStats: [stat({ query_index: 0 }), stat({ query_index: 1 })] });

    expect(q.applied_filters.map((f) => f.query_index)).toEqual([0, 1]);
    expect(q.applied_filters.find((f) => f.query_index === 1)?.col).toBe("feature_tt");
  });

  test("aggregation keys survive dimension values containing the separator", () => {
    const mk = (dimension1: string): any => ({
      date: "2026-11-10",
      sliceId: 1,
      datasourceId: 3035,
      vizType: "table",
      dimension1,
      dimension2: "",
      metric: "qty_orders_delivered",
      kind: "additive",
      value: 1,
    });
    // both values would collapse into one group under a naive "|"-joined key
    const result = aggregate([mk("a|b"), mk("a"), mk("b"), mk("a|b|c")], new Map());
    const details = result.rows.filter((r) => r.dimension_1 !== "__ALL__");
    expect(details.length).toBe(4);
    expect(details.map((r) => r.dimension_1).sort()).toEqual(["a", "a|b", "a|b|c", "b"]);
    // plus exactly one collapsed per-(date,datasource,slice) row
    expect(result.rows.filter((r) => r.dimension_1 === "__ALL__").length).toBe(1);
  });

  test("zero rows, warnings, errors and dry-run are never full", () => {
    expect(assessQuality({ ...base, rowCount: 0 }).completeness).toBe("partial");
    expect(assessQuality({ ...base, warnings: ["non-numeric cell"] }).completeness).toBe("partial");
    expect(assessQuality({ ...base, mode: "error", status: 401, problems: ["HTTP 401"], rowCount: null }).completeness).toBe("none");
    expect(assessQuality({ ...base, mode: "dry-run", rowCount: null }).completeness).toBe("none");
  });

  test("weighting is reported per ratio metric", () => {
    const q = assessQuality({ ...base, ratioWeightedMetrics: ["share_not_in_slot_all"], ratioUnweightedMetrics: [] });
    expect(q.ratio_weighting).toBe("weighted");
    const mixed = assessQuality({ ...base, ratioWeightedMetrics: ["a"], ratioUnweightedMetrics: ["b"] });
    expect(mixed.ratio_weighting).toBe("mixed");
    expect(mixed.unweighted_metrics).toEqual(["b"]);
  });

  test("duplicate rows are counted", () => {
    expect(countDuplicateRows([{ a: 1, b: 2 }, { a: 1, b: 2 }, { a: 2, b: 2 }])).toBe(1);
    expect(countDuplicateRows([])).toBe(0);
  });
});
