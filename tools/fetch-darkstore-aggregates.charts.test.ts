// Hermetic tests on REAL saved chart metadata (output/chart_details/*.json, produced by
// GET /api/v1/chart/{id}) вЂ” verifies body building and extraction without any network.
// Run: bun test tools/fetch-darkstore-aggregates.test.ts
import { describe, expect, test } from "bun:test";

import {
  buildBodyFromChartDetail,
  extractObservations,
  planMeta,
  planMetas,
  transformBody,
  type CliArgs,
  type RequestPlan,
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

const readDetail = async (id: number) => JSON.parse(await Bun.file(`output/chart_details/${id}.json`).text());

function planFromDetail(id: number, name: string, body: any): RequestPlan {
  const r = body?.form_data ?? {};
  return {
    n: 1,
    source: "chart",
    file: `output/chart_details/${id}.json`,
    chartId: id,
    chartName: name,
    sliceId: r?.slice_id ?? id,
    datasourceId: body?.datasource?.id ?? null,
    vizType: r?.viz_type ?? "unknown",
    body,
    bodySha256: "",
    url: "",
    ...planMeta(body),
    queryMetas: planMetas(body),
  };
}

describe("chart mode (real saved chart metadata)", () => {
  test("chart 20209 (slots, ds 3035) builds a valid chart/data body from query_context", async () => {
    const body = buildBodyFromChartDetail(await readDetail(20209));

    expect(body.datasource.id).toBe(3035);
    expect(body.datasource.type).toBe("table");
    expect(body.form_data.datasource).toBe("3035__table");
    expect(body.form_data.slice_id).toBe(20209);
    expect(body.queries.length).toBe(1);

    const q = body.queries[0];
    // the chart's date dimension is an ad-hoc SQL column, not a plain column name
    expect(q.columns.length).toBe(1);
    expect(q.columns[0].sqlExpression).toBe("toStartOfDay(date_supply)");
    expect(q.metrics).toContain("qty_orders_delivered");
    expect(q.metrics).toContain("share_not_in_slot_all");
    // the slots filter lives in extras.where
    expect(q.extras.where).toBe("(slots = 1)");
    expect(q.filters.some((f: any) => f.col === "date_supply" && f.op === "TEMPORAL_RANGE")).toBe(true);
  });

  test("transformBody keeps the ad-hoc date dimension and injects the darkstore filter", async () => {
    const body = buildBodyFromChartDetail(await readDetail(20209));
    const report = transformBody(body, { ...baseArgs, injectShopno: true }, { expression: "2026-10-13 : 2026-11-23" });

    // no duplicate temporal column: the chart already has one
    expect(report.datesupplyAdded).toBe(0);
    expect(report.temporalRewrites).toBe(1);
    expect(report.shopnoInjected).toBe(1);
    expect(body.queries[0].time_range).toBe("2026-10-13 : 2026-11-23");
    expect(body.queries[0].filters[0]).toEqual({ col: "shopno", op: "IN", val: ["7745"] });
    expect(body.queries[0].filters.find((f: any) => f.op === "TEMPORAL_RANGE").val).toBe("2026-10-13 : 2026-11-23");
    // row_limit 2000 is already above the floor
    expect(body.queries[0].row_limit).toBe(2000);
    expect(body.form_data.time_range).toBe("2026-10-13 : 2026-11-23");
  });

  test("planMeta derives metrics, dimensions and temporal candidates for other real charts", async () => {
    for (const [id, ds] of [[25053, 3466], [28163, 3466], [23507, 3035]] as const) {
      const body = buildBodyFromChartDetail(await readDetail(id));
      const meta = planMeta(body);
      expect(body.datasource.id).toBe(ds);
      expect(meta.metricNames.length).toBeGreaterThan(0);
      expect(meta.dimensionColumns.length).toBeGreaterThan(0);
      expect(meta.temporalColumns.length).toBeGreaterThan(0);
    }
  });

  test("extractObservations reads the period from the ad-hoc date column and matches declared metrics", async () => {
    const body = buildBodyFromChartDetail(await readDetail(20209));
    const plan = planFromDetail(20209, "Р”РѕСЃС‚Р°РІРєР° РїРѕ СЃР»РѕС‚Р°Рј", body);

    const response = {
      result: [{
        status: "success",
        error: null,
        rowcount: 2,
        colnames: ["Р”Р°С‚Р° РґРѕСЃС‚Р°РІРєРё РЎ", "qty_orders_delivered", "qty_couriers", "share_not_in_slot_all"],
        data: [
          { "Р”Р°С‚Р° РґРѕСЃС‚Р°РІРєРё РЎ": "2026-10-13", qty_orders_delivered: 100, qty_couriers: 10, share_not_in_slot_all: 0.1 },
          { "Р”Р°С‚Р° РґРѕСЃС‚Р°РІРєРё РЎ": "2026-10-14", qty_orders_delivered: 200, qty_couriers: 20, share_not_in_slot_all: 0.2 },
        ],
      }],
    };

    const { observations, warnings } = extractObservations(plan, response);
    expect(warnings).toEqual([]);
    expect(observations.length).toBe(6);
    const delivered = observations.filter((o) => o.metric === "qty_orders_delivered");
    expect(delivered.map((o) => o.date)).toEqual(["2026-10-13", "2026-10-14"]);
    expect(delivered.map((o) => o.value)).toEqual([100, 200]);
    expect(observations.find((o) => o.metric === "share_not_in_slot_all")?.kind).toBe("ratio");
    // the ad-hoc date column is the period, not a dimension
    expect(observations.every((o) => o.dimension1 === "")).toBe(true);
  });

  test("extractObservations ignores numeric metrics when looking for a period", async () => {
    const body = buildBodyFromChartDetail(await readDetail(23507));
    const plan = planFromDetail(23507, "Р—РѕРЅР° - Р’Р°Р№С‚С‹, РєСѓСЂСЊРµСЂС‹", body);
    const response = {
      result: [{
        error: null,
        rowcount: 1,
        colnames: ["qty_orders_delivered", "qty_couriers"],
        data: [{ qty_orders_delivered: 777, qty_couriers: 5 }],
      }],
    };

    const { observations } = extractObservations(plan, response);

    // metrics without a temporal column land in the grand-total bucket, never as a fake 1970 date
    expect(observations.length).toBeGreaterThan(0);
    expect(observations.every((o) => o.date === "")).toBe(true);
  });
});
