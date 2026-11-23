// Unit tests for tools/fetch-darkstore-aggregates.ts
// Run: bun test tools/fetch-darkstore-aggregates.test.ts
import { describe, expect, test } from "bun:test";

import {
  aggregate,
  metricKind,
  transformBody,
  type AggregateResult,
  type CliArgs,
  type Observation,
} from "./fetch-darkstore-aggregates";

const baseArgs: CliArgs = {
  live: false,
  confirm: false,
  baseUrl: "https://example.test",
  bodiesDir: "tools/har-out",
  outDir: "data/extraction/superset/7745",
  shopno: "7745",
  weeks: 6,
  from: null,
  to: null,
  timeRange: null,
  rowLimit: 1000,
  timeoutMs: 1000,
  pollTimeoutMs: 1000,
  addDateSupply: true,
  injectShopno: false,
  forceShopno: false,
  session: "",
  csrf: "",
  token: "",
  username: "",
  password: "",
  provider: "db",
  files: [101],
  fromCharts: [],
  chartDetailsDir: "output/chart_details",
  offlineCharts: false,
  rawArtifacts: false,
  help: false,
};

describe("transformBody", () => {
  test("rewrites the window, adds date_supply and raises row_limit", () => {
    const body: any = {
      datasource: { id: 3035, type: "table" },
      queries: [
        {
          time_range: 'DATETIME("today") : DATEADD(DATETIME("tomorrow"), -1, second)',
          granularity: "date_supply",
          filters: [
            { col: "shopno", op: "IN", val: ["7745"] },
            { col: "date_supply", op: "TEMPORAL_RANGE", val: "old-range" },
          ],
          extras: { time_grain_sqla: "P1D", having: "", where: "(gettype NOT IN (6))" },
          columns: ["night_and_others"],
          metrics: ["qty_orders_delivered"],
          row_limit: 100,
        },
      ],
      form_data: {
        slice_id: 20403,
        dashboardId: 977,
        time_range: "old-range",
        time_grain_sqla: "P1D",
        row_limit: 100,
        adhoc_filters: [{ subject: "date_supply", operator: "TEMPORAL_RANGE", comparator: "old-range" }],
        extra_form_data: { time_range: "old-range", filters: [{ col: "date_supply", op: "TEMPORAL_RANGE", val: "old-range" }] },
      },
      result_format: "json",
      result_type: "full",
    };

    const report = transformBody(body, baseArgs, { expression: "2026-10-13 : 2026-11-23" });

    expect(body.queries[0].time_range).toBe("2026-10-13 : 2026-11-23");
    expect(body.queries[0].columns).toEqual(["date_supply", "night_and_others"]);
    expect(body.queries[0].row_limit).toBe(1000);
    expect(body.queries[0].filters[1].val).toBe("2026-10-13 : 2026-11-23");
    expect(body.form_data.time_range).toBe("2026-10-13 : 2026-11-23");
    expect(body.form_data.row_limit).toBe(1000);
    expect(body.form_data.extra_form_data.filters[0].val).toBe("2026-10-13 : 2026-11-23");
    expect(report.datesupplyAdded).toBe(1);
    expect(report.temporalRewrites).toBe(1);
    expect(report.shopnoRewrites).toBe(0);
    expect(report.rowLimitRaised).toBe(2);
  });

  test("keeps series columns and only forces daily grain", () => {
    const body: any = {
      datasource: { id: 3035, type: "table" },
      queries: [
        {
          is_timeseries: true,
          granularity: "date_supply",
          extras: { time_grain_sqla: "P1W" },
          columns: ["name_service"],
          metrics: ["qty_orders_delivered"],
          row_limit: 10000,
        },
      ],
      form_data: { slice_id: 20623, time_grain_sqla: "P1W" },
    };

    transformBody(body, baseArgs, { expression: "X : Y" });

    expect(body.queries[0].columns).toEqual(["name_service"]);
    expect(body.queries[0].extras.time_grain_sqla).toBe("P1D");
    expect(body.form_data.time_grain_sqla).toBe("P1D");
    expect(body.queries[0].row_limit).toBe(10000);
  });

  test("does not touch the freshness request", () => {
    const body: any = {
      datasource: { id: 5979, type: "table" },
      queries: [{ columns: ["date_update"], metrics: [], extras: { time_grain_sqla: "P1D" }, row_limit: 1 }],
      form_data: { slice_id: 20161 },
    };

    transformBody(body, baseArgs, { expression: "X : Y" });

    expect(body.queries[0].row_limit).toBe(1);
    expect(body.queries[0].columns).toEqual(["date_update"]);
  });

  test("rewrites shopno when another darkstore is requested", () => {
    const body: any = {
      queries: [{ filters: [{ col: "shopno", op: "IN", val: ["7745"] }] }],
      form_data: { slice_id: 20403 },
    };

    const report = transformBody(body, { ...baseArgs, shopno: "1234" }, { expression: "X : Y" });

    expect(body.queries[0].filters[0].val).toEqual(["1234"]);
    expect(report.shopnoRewrites).toBe(1);
  });
});

describe("metricKind", () => {
  test("classifies ratios and additive metrics", () => {
    expect(metricKind("share_not_in_slot_all")).toBe("ratio");
    expect(metricKind("share_delivered_taxi")).toBe("ratio");
    expect(metricKind("qty_orders_delivered")).toBe("additive");
    expect(metricKind("sum_with_bonuses")).toBe("additive");
    expect(metricKind("sum_without_bonuses")).toBe("additive");
  });
});

describe("aggregate", () => {
  const observation = (
    over: Partial<Observation> & Pick<Observation, "metric" | "kind" | "value">,
  ): Observation => ({
    date: "2026-11-01",
    sliceId: 20403,
    datasourceId: 3035,
    vizType: "table",
    dimension1: "Р”Р°СЂРєРЎС‚РѕСЂ",
    dimension2: "",
    ...over,
  });

  test("sums additive metrics and re-aggregates ratios with the shared denominator", () => {
    const observations: Observation[] = [
      observation({ metric: "qty_orders_delivered", kind: "additive", value: 100 }),
      observation({ metric: "share_not_in_slot_all", kind: "ratio", value: 0.1, weight: 100 }),
      observation({ metric: "qty_orders_delivered", kind: "additive", value: 300 }),
      observation({ metric: "share_not_in_slot_all", kind: "ratio", value: 0.2, weight: 300 }),
    ];

    const result: AggregateResult = aggregate(observations, new Map());

    const detail = result.rows.find((r) => r.dimension_1 === "Р”Р°СЂРєРЎС‚РѕСЂ");
    expect(detail?.source_rows).toBe(4);
    expect(detail?.qty_orders_delivered).toBe(400);
    expect(Number(detail?.share_not_in_slot_all)).toBeCloseTo(0.175, 9);
    expect(detail?.ratio_weighting).toBe("weighted:qty_orders_delivered");

    const collapsed = result.rows.find((r) => r.dimension_1 === "__ALL__");
    expect(collapsed?.qty_orders_delivered).toBe(400);
    expect(Number(collapsed?.share_not_in_slot_all)).toBeCloseTo(0.175, 9);
  });

  test("falls back to an unweighted mean when the denominator is absent", () => {
    const observations: Observation[] = [
      observation({ sliceId: 20405, vizType: "pivot_table_v2", dimension1: "A", metric: "share_delivered_taxi", kind: "ratio", value: 0.4 }),
      observation({ sliceId: 20405, vizType: "pivot_table_v2", dimension1: "A", metric: "share_delivered_taxi", kind: "ratio", value: 0.6 }),
    ];

    const result = aggregate(observations, new Map());
    const row = result.rows.find((r) => r.dimension_1 === "A");

    expect(Number(row?.share_delivered_taxi)).toBeCloseTo(0.5, 9);
    expect(row?.ratio_weighting).toBe("unweighted");
  });

  test("leaves metrics that a slice never returned empty instead of zero", () => {
    const observations: Observation[] = [
      observation({ metric: "qty_orders_delivered", kind: "additive", value: 10 }),
    ];
    const declared = new Map<string, "additive" | "ratio">([
      ["qty_orders_delivered", "additive"],
      ["sum_with_bonuses", "additive"],
    ]);

    const result = aggregate(observations, declared);
    const row = result.rows.find((r) => r.dimension_1 === "Р”Р°СЂРєРЎС‚РѕСЂ");

    expect(row?.qty_orders_delivered).toBe(10);
    expect(row?.sum_with_bonuses).toBe("");
  });

  test("pre-populates metric kinds even without observations (dry-run header)", () => {
    const declared = new Map<string, "additive" | "ratio">([
      ["qty_orders_delivered", "additive"],
      ["share_not_in_slot_all", "ratio"],
    ]);

    const result = aggregate([], declared);

    expect(result.additiveMetrics).toEqual(["qty_orders_delivered"]);
    expect(result.ratioMetrics).toEqual(["share_not_in_slot_all"]);
    expect(result.rows).toEqual([]);
  });
});

// These tests pin the CURRENT key semantics as a specification
// (see reports/code-review/final-live-aggregator-acceptance.md, section 2).
// They document theoretical edge cases, not observed production data:
// no real Superset response was seen carrying "|" in a dimension value,
// and plan -> (slice_id, datasource_id) is bijective in practice.
describe("dedup keys (defect documentation)", () => {
  const observation = (
    over: Partial<Observation> & Pick<Observation, "metric" | "kind" | "value">,
  ): Observation => ({
    date: "2026-11-01",
    sliceId: 20403,
    datasourceId: 3035,
    vizType: "table",
    dimension1: "A",
    dimension2: "",
    ...over,
  });

  test("regression: '|' inside a dimension value no longer aliases two groups", () => {
    // ["x", "y|z"] and ["x|y", "z"] used to join to the same key "…|x|y|z" and merge.
    const observations: Observation[] = [
      observation({ dimension1: "x", dimension2: "y|z", metric: "qty_orders_delivered", kind: "additive", value: 10 }),
      observation({ dimension1: "x|y", dimension2: "z", metric: "qty_orders_delivered", kind: "additive", value: 20 }),
    ];

    const result = aggregate(observations, new Map());
    const detail = result.rows.filter(
      (r) => r.date === "2026-11-01" && r.slice_id === 20403 && r.dimension_1 !== "__ALL__",
    );

    // both groups survive with their own sums; nothing is merged
    expect(detail.length).toBe(2);
    expect(detail.map((r) => Number(r.qty_orders_delivered)).sort((a, b) => a - b)).toEqual([10, 20]);
    expect(detail.every((r) => r.source_rows === 1)).toBe(true);

    const collapsed = result.rows.find((r) => r.date === "2026-11-01" && r.dimension_1 === "__ALL__");
    expect(collapsed?.qty_orders_delivered).toBe(30);
  });

  test("regression: different datasource_id is never merged into one group", () => {
    const observations: Observation[] = [
      observation({ datasourceId: 3035, dimension1: "A", metric: "qty_orders_delivered", kind: "additive", value: 10 }),
      observation({ datasourceId: 3466, dimension1: "B", metric: "qty_orders_delivered", kind: "additive", value: 5 }),
    ];

    const result = aggregate(observations, new Map());
    const detail = result.rows.filter((r) => r.dimension_1 !== "__ALL__");
    const collapsed = result.rows.filter((r) => r.dimension_1 === "__ALL__");

    // details stay separate and so do the per-(date,datasource,slice) collapses
    expect(detail.length).toBe(2);
    expect(collapsed.length).toBe(2);
    expect(collapsed.map((r) => r.dataset_id).sort()).toEqual([3035, 3466]);
    expect(collapsed.map((r) => Number(r.qty_orders_delivered)).sort((a, b) => a - b)).toEqual([5, 10]);
  });
});
