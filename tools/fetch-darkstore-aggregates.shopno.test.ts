// Regression tests for the shopno filtering fixes (РўР— В§1):
// per-query scoping, positive vs negative operators (=, !=, <>, NOT IN),
// conflict refusal and the SHOPNO_UNCONSTRAINED guard in chart mode.
// Fully hermetic: no network.
import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  injectShopnoFilter,
  runPipeline,
  scanShopno,
  transformBody,
  type CliArgs,
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

const bodyWith = (...queries: any[]) => ({
  datasource: { id: 3035, type: "table" },
  queries: queries.map((q) => ({
    metrics: ["qty_orders_delivered"],
    columns: ["night_and_others"],
    filters: [],
    extras: {},
    granularity: "date_supply",
    row_limit: 100,
    ...q,
  })),
  form_data: { slice_id: 9100, viz_type: "table" },
});

describe("shopno: negative operators are not treated as a restriction", () => {
  test("NOT IN with another darkstore: no positive restriction exists вЂ” injection is required", () => {
    const body = bodyWith({ filters: [{ col: "shopno", op: "NOT IN", val: ["1111"] }] });
    const scan = scanShopno(body);
    expect(scan.includeValues).toEqual([]);
    expect(scan.excludeValues).toEqual(["1111"]);

    const report = transformBody(body, baseArgs, { expression: "A : B" });
    expect(report.shopnoRewrites).toBe(0);
    expect(report.shopnoExcluded).toBe(false);
    // injectShopno (default in chart mode): the missing positive filter is added
    expect(report.shopnoInjected).toBe(1);
    expect(body.queries[0].filters[0]).toEqual({ col: "shopno", op: "IN", val: ["7745"] });

    // without injection the negative-only query stays unconstrained and is reported as such
    const body2 = bodyWith({ filters: [{ col: "shopno", op: "NOT IN", val: ["1111"] }] });
    const report2 = transformBody(body2, { ...baseArgs, injectShopno: false }, { expression: "A : B" });
    expect(report2.shopnoInjected).toBe(0);
    expect(report2.shopnoUnfilteredQueries).toEqual([0]);
  });

  test("NOT IN containing the target darkstore is refused (SHOPNO_EXCLUDED)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dds-shopnot-"));
    await Bun.write(
      join(dir, "9101.json"),
      JSON.stringify({
        result: {
          id: 9101,
          slice_name: "excludes",
          viz_type: "table",
          datasource_id: 3035,
          datasource_type: "table",
          params: "{}",
          query_context: JSON.stringify({
            datasource: { id: 3035, type: "table" },
            queries: [{ metrics: ["qty_orders_delivered"], columns: ["x"], filters: [{ col: "shopno", op: "NOT IN", val: ["7745"] }], extras: {}, granularity: "date_supply", row_limit: 10 }],
            form_data: { slice_id: 9101, viz_type: "table" },
          }),
        },
      }),
    );
    const outDir = await mkdtemp(join(tmpdir(), "dds-shopnot-out-"));
    await runPipeline({ ...baseArgs, outDir, offlineCharts: true, chartDetailsDir: dir, fromCharts: [9101] });

    const quality = (await Bun.file(join(outDir, "quality.json")).json()) as any;
    expect(quality.requests[0].problems.join(" ")).toContain("SHOPNO_EXCLUDED");
    expect(quality.requests[0].completeness).toBe("none");
  });

  test("= with another darkstore counts as an include filter and is rewritten", () => {
    const body = bodyWith({ filters: [{ col: "shopno", op: "EQUALS", val: "1111" }] });
    const scan = scanShopno(body);
    expect(scan.includeValues).toEqual(["1111"]);

    const report = transformBody(body, baseArgs, { expression: "A : B" });
    expect(report.shopnoRewrites).toBe(1);
    expect(report.shopnoInjected).toBe(0);
    expect(body.queries[0].filters[0].val).toEqual(["7745"]);
  });

  test("!= / <> are exclusions, not restrictions вЂ” injection (when enabled) still applies", () => {
    for (const op of ["!=", "<>", "NOT EQUALS"]) {
      const body = bodyWith({ filters: [{ col: "shopno", op, val: "1111" }] });
      const scan = scanShopno(body);
      expect(scan.includeValues).toEqual([]);
      expect(scan.excludeValues).toEqual(["1111"]);

      const report = transformBody(body, baseArgs, { expression: "A : B" });
      expect(report.shopnoRewrites).toBe(0);
      expect(report.shopnoInjected).toBe(1);
      expect(body.queries[0].filters.some((f: any) => f.col === "shopno" && f.op === "IN")).toBe(true);

      // with injection off the exclusion alone must be reported as an unconstrained query
      const body2 = bodyWith({ filters: [{ col: "shopno", op, val: "1111" }] });
      const report2 = transformBody(body2, { ...baseArgs, injectShopno: false }, { expression: "A : B" });
      expect(report2.shopnoUnfilteredQueries).toEqual([0]);
    }
  });

  test("!= pointing at the target darkstore contradicts the request and is refused", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dds-neq-"));
    await Bun.write(
      join(dir, "9102.json"),
      JSON.stringify({
        result: {
          id: 9102,
          slice_name: "excludes via !=",
          viz_type: "table",
          datasource_id: 3035,
          datasource_type: "table",
          params: "{}",
          query_context: JSON.stringify({
            datasource: { id: 3035, type: "table" },
            queries: [{ metrics: ["qty_orders_delivered"], columns: ["x"], filters: [{ col: "shopno", op: "!=", val: "7745" }], extras: {}, granularity: "date_supply", row_limit: 10 }],
            form_data: { slice_id: 9102, viz_type: "table" },
          }),
        },
      }),
    );
    const outDir = await mkdtemp(join(tmpdir(), "dds-neq-out-"));
    await runPipeline({ ...baseArgs, outDir, offlineCharts: true, chartDetailsDir: dir, fromCharts: [9102] });

    const quality = (await Bun.file(join(outDir, "quality.json")).json()) as any;
    expect(quality.requests[0].problems.join(" ")).toContain("SHOPNO_EXCLUDED");
  });
});

describe("shopno: per-query scoping", () => {
  test("first query filtered, second unfiltered вЂ” injection targets only the second", () => {
    const body = bodyWith(
      { filters: [{ col: "shopno", op: "IN", val: ["7745"] }] },
      { filters: [] },
    );
    const scan = scanShopno(body);
    expect(scan.unfilteredQueries).toEqual([1]);

    const report = transformBody(body, baseArgs, { expression: "A : B" });
    expect(report.shopnoInjected).toBe(1);
    expect(body.queries[0].filters.filter((f: any) => f.col === "shopno").length).toBe(1);
    expect(body.queries[1].filters[0]).toEqual({ col: "shopno", op: "IN", val: ["7745"] });
  });

  test("several queries with different original filters: each ends up restricted to the target shopno", () => {
    const body = bodyWith(
      { filters: [{ col: "shopno", op: "IN", val: ["1111", "2222"] }] },
      { filters: [{ col: "shopno", op: "NOT IN", val: ["3333"] }] },
      { filters: [] },
      { filters: [{ col: "night_and_others", op: "IN", val: ["x"] }] },
    );

    const report = transformBody(body, baseArgs, { expression: "A : B" });
    // q0 rewritten (multi-value -> single value); q1 has only a NOT IN, which does NOT bound the
    // selection to one darkstore, so it must be injected too вЂ” exactly like q2/q3.
    expect(report.shopnoRewrites).toBe(1);
    expect(report.shopnoInjected).toBe(3);
    // pre-injection audit: queries without a positive restriction
    expect(report.shopnoUnfilteredQueries).toEqual([1, 2, 3]);

    expect(body.queries[0].filters[0].val).toEqual(["7745"]);
    expect(body.queries[2].filters[0]).toEqual({ col: "shopno", op: "IN", val: ["7745"] });
    expect(body.queries[3].filters.some((f: any) => f.col === "shopno" && f.op === "IN")).toBe(true);
    // q1 keeps its NOT IN *and* gains the positive restriction вЂ” never a cross-store scan
    expect(body.queries[1].filters).toEqual([
      { col: "shopno", op: "IN", val: ["7745"] },
      { col: "shopno", op: "NOT IN", val: ["3333"] },
    ]);
    expect(report.shopnoExcluded).toBe(false);
    // every query is now bounded to the target store
    for (const q of body.queries) {
      expect(q.filters.some((f: any) => f.col === "shopno" && String(f.op).toUpperCase() === "IN")).toBe(true);
    }
  });

  test("injectShopnoFilter itself is per-query, not per-body", () => {
    const body = bodyWith(
      { filters: [{ col: "shopno", op: "IN", val: ["7745"] }] },
      { filters: [] },
    );
    const added = injectShopnoFilter(body, "7745");
    expect(added).toBe(1);
    expect(body.queries[0].filters.length).toBe(1);
    expect(body.queries[1].filters.length).toBe(1);
  });

  test("chart mode refuses a query left without any shopno constraint (--no-inject-shopno)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dds-unconstrained-"));
    await Bun.write(
      join(dir, "9103.json"),
      JSON.stringify({
        result: {
          id: 9103,
          slice_name: "no shopno at all",
          viz_type: "table",
          datasource_id: 3035,
          datasource_type: "table",
          params: "{}",
          query_context: JSON.stringify({
            datasource: { id: 3035, type: "table" },
            queries: [
              { metrics: ["qty_orders_delivered"], columns: ["x"], filters: [], extras: {}, granularity: "date_supply", row_limit: 10 },
              { metrics: ["qty_couriers"], columns: ["x"], filters: [{ col: "shopno", op: "IN", val: ["7745"] }], extras: {}, granularity: "date_supply", row_limit: 10 },
            ],
            form_data: { slice_id: 9103, viz_type: "table" },
          }),
        },
      }),
    );
    const outDir = await mkdtemp(join(tmpdir(), "dds-unconstrained-out-"));
    const exitCode = await runPipeline({
      ...baseArgs,
      outDir,
      offlineCharts: true,
      rawArtifacts: false,
      chartDetailsDir: dir,
      fromCharts: [9103],
      injectShopno: false,
    });

    const quality = (await Bun.file(join(outDir, "quality.json")).json()) as any;
    expect(quality.requests[0].problems.join(" ")).toContain("SHOPNO_UNCONSTRAINED");
    expect(quality.requests[0].problems.join(" ")).toContain("[0]");
    expect(exitCode).toBe(0); // dry-run: the refusal is reported, not fatal
  });
});

describe("shopno: SIMPLE ad-hoc filters in form_data", () => {
  test("SIMPLE operator=scalar comparator participates in scan and rewrite", () => {
    const body: any = {
      datasource: { id: 3035, type: "table" },
      queries: [{ metrics: ["qty_orders_delivered"], columns: ["x"], filters: [], extras: {}, granularity: "date_supply", row_limit: 10 }],
      form_data: {
        slice_id: 9104,
        viz_type: "table",
        adhoc_filters: [
          { expressionType: "SIMPLE", subject: "shopno", operator: "IN", comparator: "1111,2222" },
          { expressionType: "SIMPLE", subject: "gettype", operator: "NOT IN", comparator: "6" },
        ],
      },
    };

    const scan = scanShopno(body);
    expect(scan.includeValues).toEqual(["1111", "2222"]);

    const report = transformBody(body, baseArgs, { expression: "A : B" });
    expect(report.shopnoRewrites).toBe(1);
    const f = body.form_data.adhoc_filters[0];
    expect(f.comparator).toEqual(["7745"]);
  });

  test("SIMPLE operator=scalar comparator stays scalar after rewrite", () => {
    const body: any = {
      queries: [{ filters: [] }],
      form_data: {
        slice_id: 1,
        adhoc_filters: [{ expressionType: "SIMPLE", subject: "shopno", operator: "==", comparator: "1111" }],
      },
    };

    const scan = scanShopno(body);
    expect(scan.includeValues).toEqual(["1111"]);

    const report = transformBody(body, baseArgs, { expression: "A : B" });
    expect(report.shopnoRewrites).toBe(1);
    expect(body.form_data.adhoc_filters[0].comparator).toBe("7745");
  });

  test("a SIMPLE NOT IN on the target shopno marks the body as excluded", () => {
    const body: any = {
      queries: [{ filters: [] }],
      form_data: {
        slice_id: 1,
        adhoc_filters: [{ expressionType: "SIMPLE", subject: "shopno", operator: "NOT IN", comparator: "7745" }],
      },
    };
    const scan = scanShopno(body);
    expect(scan.excludeValues).toEqual(["7745"]);
    const report = transformBody(body, baseArgs, { expression: "A : B" });
    expect(report.shopnoExcluded).toBe(true);
  });
});
