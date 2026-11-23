// Security and failure-mode tests for the chart data client.
//
// ALL network is mocked: `globalThis.fetch` is replaced, so these tests never touch Superset.
// They pin: the read-only allowlist, retry/backoff behaviour for 5xx, no retry on 401/403,
// timeout handling, session/credential handling and the absence of secrets in the manifest.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ReadOnlySuperset,
  assertAllowed,
  runPipeline,
  type CliArgs,
} from "./fetch-darkstore-aggregates";

const SECRET_SESSION = "SECRET-SESSION-COOKIE-VALUE";
const SECRET_TOKEN = "SECRET-BEARER-TOKEN-VALUE";
const SECRET_PASSWORD = "SECRET-PASSWORD-VALUE";

const realFetch = globalThis.fetch;

function args(over: Partial<CliArgs> = {}): CliArgs {
  return {
    live: true,
    confirm: true,
    baseUrl: "https://superset.example.test",
    bodiesDir: "tools/har-out",
    outDir: "C:/Temp/unused",
    shopno: "7745",
    weeks: 2,
    from: null,
    to: null,
    timeRange: null,
    rowLimit: 500,
    timeoutMs: 5_000,
    pollTimeoutMs: 5_000,
    addDateSupply: true,
    injectShopno: true,
    forceShopno: false,
    session: SECRET_SESSION,
    csrf: "csrf-value",
    token: SECRET_TOKEN,
    username: "",
    password: SECRET_PASSWORD,
    provider: "db",
    files: [],
    fromCharts: [],
    chartDetailsDir: "output/chart_details",
    offlineCharts: false,
    rawArtifacts: false,
    help: false,
    ...over,
  };
}

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

type Responder = (call: Call, attempt: number) => { status: number; body: unknown } | "abort";

function mockFetch(responder: Responder): { calls: Call[] } {
  const calls: Call[] = [];
  const counters = new Map<string, number>();
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = String(input);
    const method = String(init?.method ?? "GET").toUpperCase();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k.toLowerCase()] = v));
    const call: Call = { url, method, headers, body: init?.body != null ? String(init.body) : null };
    calls.push(call);
    const key = `${method} ${new URL(url).pathname}`;
    const attempt = (counters.get(key) ?? 0) + 1;
    counters.set(key, attempt);
    const outcome = responder(call, attempt);
    if (outcome === "abort") {
      const error: any = new Error("The operation was aborted.");
      error.name = "AbortError";
      throw error;
    }
    const text = typeof outcome.body === "string" ? outcome.body : JSON.stringify(outcome.body ?? {});
    return new Response(text, { status: outcome.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls };
}

beforeEach(() => {
  globalThis.fetch = realFetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("read-only allowlist", () => {
  test("allows only the documented endpoints and verbs", () => {
    expect(() => assertAllowed("/api/v1/chart/data", "POST")).not.toThrow();
    expect(() => assertAllowed("/api/v1/chart/data?form_data=%7B%7D", "POST")).not.toThrow();
    expect(() => assertAllowed("/api/v1/chart/data/qc-123", "GET")).not.toThrow();
    expect(() => assertAllowed("/api/v1/chart/20209", "GET")).not.toThrow();
    expect(() => assertAllowed("/api/v1/security/login", "POST")).not.toThrow();
    expect(() => assertAllowed("/api/v1/security/csrf_token/", "GET")).not.toThrow();

    // mutations and unrelated endpoints are refused
    expect(() => assertAllowed("/api/v1/chart/20209", "PUT")).toThrow(/refusing/);
    expect(() => assertAllowed("/api/v1/chart/20209", "DELETE")).toThrow(/refusing/);
    expect(() => assertAllowed("/api/v1/chart/", "POST")).toThrow(/refusing/);
    expect(() => assertAllowed("/api/v1/dataset/1", "GET")).toThrow(/refusing/);
    expect(() => assertAllowed("/api/v1/sqllab/execute/", "POST")).toThrow(/refusing/);
    expect(() => assertAllowed("/api/v1/chart/data", "PUT")).toThrow(/refusing/);
  });

  test("the method is pinned per endpoint, not per path", () => {
    // csrf_token is GET-only, login is POST-only, chart/data is POST-only
    expect(() => assertAllowed("/api/v1/security/csrf_token/", "POST")).toThrow(/refusing/);
    expect(() => assertAllowed("/api/v1/security/csrf_token/", "PUT")).toThrow(/refusing/);
    expect(() => assertAllowed("/api/v1/security/login", "GET")).toThrow(/refusing/);
    expect(() => assertAllowed("/api/v1/security/login", "PUT")).toThrow(/refusing/);
    expect(() => assertAllowed("/api/v1/chart/data", "GET")).toThrow(/refusing/);
    expect(() => assertAllowed("/api/v1/chart/data/../chart/data", "POST")).toThrow(/refusing/);
    // the async poll endpoint stays GET-only
    expect(() => assertAllowed("/api/v1/chart/data/qc-abc", "POST")).toThrow(/refusing/);
  });
});

describe("failure modes (mocked fetch)", () => {
  test("401 on chart data is reported, never retried and never treated as data", async () => {
    const mock = mockFetch((call) => {
      if (call.url.includes("/api/v1/security/csrf_token/")) return { status: 200, body: { result: "csrf-value" } };
      return { status: 401, body: { message: "Not authorized" } };
    });
    const client = new ReadOnlySuperset(args());
    await client.authenticate();

    const res = await client.postChartData({ url: "https://superset.example.test/api/v1/chart/data", body: {} } as any);

    expect(res.status).toBe(401);
    const chartDataCalls = mock.calls.filter((c) => c.url.includes("/api/v1/chart/data"));
    expect(chartDataCalls.length).toBe(1); // no retry loop for 401
  });

  test("403 is surfaced with its body and not retried", async () => {
    const mock = mockFetch(() => ({ status: 403, body: { message: "Forbidden" } }));
    const client = new ReadOnlySuperset(args());
    const res = await client.postChartData({ url: "https://superset.example.test/api/v1/chart/data", body: {} } as any);
    expect(res.status).toBe(403);
    expect(res.text).toContain("Forbidden");
    expect(mock.calls.length).toBe(1);
  });

  test("5xx is retried with backoff and finally surfaced", async () => {
    const mock = mockFetch(() => ({ status: 503, body: { message: "unavailable" } }));
    const client = new ReadOnlySuperset(args());
    const res = await client.postChartData({ url: "https://superset.example.test/api/v1/chart/data", body: {} } as any);

    expect(res.status).toBe(503);
    expect(mock.calls.length).toBe(4); // initial + 3 retries
  });

  test("timeout/abort is retried and then raised as a network error", async () => {
    const mock = mockFetch(() => "abort");
    const client = new ReadOnlySuperset(args());
    await expect(
      client.postChartData({ url: "https://superset.example.test/api/v1/chart/data", body: {} } as any),
    ).rejects.toThrow(/aborted/i);
    expect(mock.calls.length).toBe(4); // initial + 3 retries
  });

  test("expired session: chart detail fetch raises and the pipeline stops with exit 2", async () => {
    mockFetch((call) => {
      if (call.url.includes("/api/v1/security/csrf_token/")) return { status: 200, body: { result: "csrf" } };
      return { status: 401, body: { message: "Not authorized" } };
    });
    const outDir = await mkdtemp(join(tmpdir(), "dds-sec-401-"));
    const exitCode = await runPipeline(args({ outDir, fromCharts: [20209] }));
    expect(exitCode).toBe(2);
  });

  test("401 on chart data marks the run failed and completeness none", async () => {
    mockFetch((call) => {
      if (call.url.includes("/api/v1/security/csrf_token/")) return { status: 200, body: { result: "csrf" } };
      if (call.url.includes("/api/v1/chart/20209")) {
        return {
          status: 200,
          body: { result: { id: 20209, slice_name: "restricted", viz_type: "table", datasource_id: 3466, datasource_type: "table", params: "{}", query_context: JSON.stringify({ datasource: { id: 3466, type: "table" }, queries: [{ metrics: ["qty_orders_delivered"], columns: ["night_and_others"], filters: [], extras: {}, row_limit: 10 }], form_data: { datasource: "3466__table", viz_type: "table", slice_id: 20209 } }) } },
        };
      }
      return { status: 401, body: { message: "Not authorized" } };
    });
    const outDir = await mkdtemp(join(tmpdir(), "dds-sec-401-data-"));
    const exitCode = await runPipeline(args({ outDir, fromCharts: [20209] }));

    const quality = (await Bun.file(join(outDir, "quality.json")).json()) as any;
    const validation = (await Bun.file(join(outDir, "validation.json")).json()) as any;

    expect(exitCode).toBe(1);
    expect(validation.summary.failed).toBe(1);
    expect(quality.run.completeness.none).toBe(1);
    expect(quality.requests[0].http_status).toBe(401);
    expect(quality.requests[0].completeness).toBe("none");
  });

  test("no SQLite/DML side effects: only read endpoints are ever called", async () => {
    const mock = mockFetch((call) => {
      if (call.url.includes("csrf_token")) return { status: 200, body: { result: "csrf" } };
      return { status: 200, body: { result: [{ error: null, rowcount: 1, colnames: ["qty_orders_delivered"], data: [{ qty_orders_delivered: 1 }] }] } };
    });
    const outDir = await mkdtemp(join(tmpdir(), "dds-sec-endpoints-"));
    await runPipeline(args({ outDir, files: [101], injectShopno: false }));

    const paths = mock.calls.map((c) => `${c.method} ${new URL(c.url).pathname}`);
    for (const p of paths) {
      const path = p.split(" ")[1]!;
      expect(
        path === "/api/v1/chart/data" ||
          path.startsWith("/api/v1/chart/data/") ||
          path.startsWith("/api/v1/chart/") ||
          path === "/api/v1/security/csrf_token/" ||
          path === "/api/v1/security/login",
      ).toBe(true);
    }
    expect(paths.some((p) => /sqlite|sqllab|dataset|DELETE|PUT/i.test(p))).toBe(false);
  });
});

describe("secret handling", () => {  test("artifacts never contain the session cookie, bearer token or password", async () => {
    mockFetch((call) => {
      if (call.url.includes("csrf_token")) return { status: 200, body: { result: "csrf" } };
      return { status: 200, body: { result: [{ error: null, rowcount: 1, colnames: ["qty_orders_delivered"], data: [{ qty_orders_delivered: 42 }] }] } };
    });
    const outDir = await mkdtemp(join(tmpdir(), "dds-sec-secrets-"));
    await runPipeline(args({ outDir, files: [101], injectShopno: false }));

    const files = [...new Bun.Glob("**/*").scanSync({ cwd: outDir })];
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = await Bun.file(join(outDir, file)).text();
      expect(text).not.toContain(SECRET_SESSION);
      expect(text).not.toContain(SECRET_TOKEN);
      expect(text).not.toContain(SECRET_PASSWORD);
    }
  });

  test("session cookie and bearer token are sent as headers, never as query parameters", async () => {
    const mock = mockFetch((call) => {
      if (call.url.includes("csrf_token")) return { status: 200, body: { result: "csrf" } };
      return { status: 200, body: { result: [{ error: null, rowcount: 1, colnames: ["qty_orders_delivered"], data: [{ qty_orders_delivered: 1 }] }] } };
    });
    const outDir = await mkdtemp(join(tmpdir(), "dds-sec-headers-"));
    await runPipeline(args({ outDir, files: [101], injectShopno: false }));

    const chartCalls = mock.calls.filter((c) => c.url.includes("/api/v1/chart/data"));
    expect(chartCalls.length).toBeGreaterThan(0);
    for (const call of chartCalls) {
      expect(new URL(call.url).searchParams.get("session")).toBeNull();
      expect(call.headers["cookie"]).toContain(SECRET_SESSION);
      expect(call.headers["authorization"]).toBe(`Bearer ${SECRET_TOKEN}`);
    }
  });
});

describe("multi-query correspondence and PII-safe artifacts (mocked fetch)", () => {
  const PII_NAME = "<ФИО>";
  const PII_EMAIL = "<EMAIL>";

  /** Two queries in the chart; the response may deliberately return a different number of results. */
  const chartDetail = (id: number) => ({
    result: {
      id,
      slice_name: `Сводка ${PII_NAME}`,
      viz_type: "table",
      datasource_id: 3035,
      datasource_type: "table",
      params: "{}",
      query_context: JSON.stringify({
        datasource: { id: 3035, type: "table" },
        queries: [
          { metrics: ["qty_orders_delivered"], columns: ["night_and_others"], filters: [{ col: "shopno", op: "IN", val: ["7745"] }], extras: {}, granularity: "date_supply", row_limit: 100 },
          { metrics: ["qty_couriers"], columns: ["night_and_others"], filters: [{ col: "shopno", op: "IN", val: ["7745"] }], extras: {}, granularity: "date_supply", row_limit: 100 },
        ],
        form_data: { slice_id: id, viz_type: "table", adhoc_filters: [{ expressionType: "SIMPLE", subject: "name_tt", operator: "IN", comparator: PII_EMAIL }] },
      }),
    },
  });

  test("queries[]/result[] mismatch is an error, not a silent first-query mapping", async () => {
    mockFetch((call) => {
      if (call.url.includes("csrf_token")) return { status: 200, body: { result: "csrf" } };
      if (call.url.match(/\/api\/v1\/chart\/\d+$/)) return { status: 200, body: chartDetail(9200) };
      // only one result for two queries
      return { status: 200, body: { result: [{ error: null, rowcount: 1, colnames: ["date_supply", "night_and_others", "qty_orders_delivered"], data: [{ date_supply: "2026-11-10", night_and_others: "x", qty_orders_delivered: 5 }] }] } };
    });
    const outDir = await mkdtemp(join(tmpdir(), "dds-sec-mismatch-"));
    const exitCode = await runPipeline(args({ outDir, fromCharts: [9200], rowLimit: 1000 }));

    const validation = (await Bun.file(join(outDir, "validation.json")).json()) as any;
    const quality = (await Bun.file(join(outDir, "quality.json")).json()) as any;

    expect(exitCode).toBe(1);
    expect(validation.requests[0].problems.join(" ")).toContain("queries[]/result[] mismatch");
    expect(quality.requests[0].query_count_mismatch).toBe(true);
    expect(quality.requests[0].completeness).not.toBe("full");
  });

  test("chart titles and filter values are masked in manifest/quality/CSV by default", async () => {
    mockFetch((call) => {
      if (call.url.includes("csrf_token")) return { status: 200, body: { result: "csrf" } };
      if (call.url.match(/\/api\/v1\/chart\/\d+$/)) return { status: 200, body: chartDetail(9201) };
      return {
        status: 200,
        body: {
          result: [
            { error: null, rowcount: 1, colnames: ["date_supply", "night_and_others", "qty_orders_delivered"], data: [{ date_supply: "2026-11-10", night_and_others: "ДаркСтор", qty_orders_delivered: 5 }] },
            { error: null, rowcount: 1, colnames: ["date_supply", "night_and_others", "qty_couriers"], data: [{ date_supply: "2026-11-10", night_and_others: "ДаркСтор", qty_couriers: 2 }] },
          ],
        },
      };
    });
    const outDir = await mkdtemp(join(tmpdir(), "dds-sec-pii-"));
    await runPipeline(args({ outDir, fromCharts: [9201], rowLimit: 1000 }));

    const files = [...new Bun.Glob("**/*").scanSync({ cwd: outDir })];
    for (const file of files) {
      const text = await Bun.file(join(outDir, file)).text();
      expect(text, `${file} must not contain the person name`).not.toContain(PII_NAME);
      expect(text, `${file} must not contain the email`).not.toContain(PII_EMAIL);
    }
  });

  test("--raw-artifacts keeps the original values for debugging", async () => {
    mockFetch((call) => {
      if (call.url.includes("csrf_token")) return { status: 200, body: { result: "csrf" } };
      if (call.url.match(/\/api\/v1\/chart\/\d+$/)) return { status: 200, body: chartDetail(9202) };
      return {
        status: 200,
        body: {
          result: [
            { error: null, rowcount: 1, colnames: ["date_supply", "night_and_others", "qty_orders_delivered"], data: [{ date_supply: "2026-11-10", night_and_others: "ДаркСтор", qty_orders_delivered: 5 }] },
            { error: null, rowcount: 1, colnames: ["date_supply", "night_and_others", "qty_couriers"], data: [{ date_supply: "2026-11-10", night_and_others: "ДаркСтор", qty_couriers: 2 }] },
          ],
        },
      };
    });
    const outDir = await mkdtemp(join(tmpdir(), "dds-sec-raw-"));
    await runPipeline(args({ outDir, fromCharts: [9202], rowLimit: 1000, rawArtifacts: true }));

    const manifest = await Bun.file(join(outDir, "manifest.json")).text();
    expect(manifest).toContain(PII_NAME);
  });
});
