#!/usr/bin/env bun
/**
 * tools/fetch-darkstore-aggregates.ts
 *
 * Fetch and assemble aggregated data for one darkstore (shopno) from Superset.
 *
 * Source of truth: the six HAR request bodies saved in `tools/har-out/`
 * (100..105 — the dashboard `services_lite` = 977 requests that were issued with
 * `shopno IN ("7745")` selected in the native filter NATIVE_FILTER-xY1pKYb8B).
 * The original HAR contains no response bodies, so the aggregates have to be
 * obtained by replaying those exact requests with a real session.
 *
 * The tool:
 *   1. reads the six request bodies;
 *   2. rewrites the time window (default: last 6 weeks) and, where it makes sense,
 *      adds `date_supply` to `columns` so the result is a daily grid;
 *   3. in live mode sends read-only `POST /api/v1/chart/data` (plus the CSRF/login
 *      endpoints), handles `202 -> GET /api/v1/chart/data/{key}` polling;
 *   4. validates every response by `result[].error` / `colnames` / `rowcount`;
 *   5. writes raw responses, a long-format observation table and a consolidated
 *      `aggregate_7745.csv` where additive metrics are summed and ratio metrics
 *      (`share_*`) are re-aggregated as a weighted mean with the shared denominator
 *      `qty_orders_delivered`.
 *
 * Modes:
 *   dry-run (default) — no network at all; writes the transformed request bodies,
 *                       the metric-kind map and an empty aggregate with headers.
 *   live (--live --yes) — requires an explicit confirmation flag plus
 *                       a session cookie, an access token or username+password.
 *                       `--live` alone is refused (exit 3) and only prints the plan,
 *                       so credentials found in `.env` can never trigger traffic by accident.
 *
 * Safety: the tool only ever calls
 *   POST /api/v1/security/login
 *   GET  /api/v1/security/csrf_token/
 *   POST /api/v1/chart/data
 *   GET  /api/v1/chart/data/{key}
 * It never writes to Superset. Secrets are never written to disk.
 *
 * Usage:
 *   bun tools/fetch-darkstore-aggregates.ts --dry-run
 *   bun tools/fetch-darkstore-aggregates.ts --live --session "$SUPERSET_SESSION_COOKIE"
 *   bun tools/fetch-darkstore-aggregates.ts --live --username u --password p --weeks 8
 */

import { mkdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { PERSON_ID_PLACEHOLDER, isPersonIdKey, redactJson, redactText } from "./redact-pii";

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = "https://superset.svc.vkusvill.ru";
const DEFAULT_BODIES_DIR = "tools/har-out";
const DEFAULT_OUT_DIR = "data/extraction/superset/7745";
const DEFAULT_SHOPNO = "7745";
const DEFAULT_WEEKS = 6;
const DEFAULT_ROW_LIMIT = 1000;
const DEFAULT_TIMEOUT_S = 60;
const DEFAULT_POLL_TIMEOUT_S = 120;

/** Slice ids of the six saved bodies, in file order. */
const DEFAULT_SLICE_FILES = [100, 101, 102, 103, 104, 105];

/** Freshness check, not an aggregate: leave `row_limit`/columns alone. */
const FRESHNESS_SLICE = 20161;

const PERIOD_KEYS = new Set(["date_supply", "__timestamp", "date_update", "date"]);
const RATIO_RE = /^share_|доля|percent|%/i;
const METRIC_RE = /^(share_|qty_|sum_|avg_|count|min_|max_|доля)/i;
const TEMPORAL_LABEL_RE = /date|дата|день|day|week|недел|месяц|month|timestamp|слот|hour|час/i;
const WEIGHT_METRIC = "qty_orders_delivered";
const MSK = "Europe/Moscow";

const DEFAULT_CHART_DETAILS_DIR = "output/chart_details";

/** Charts used by the live cross-domain check (one per process block). */
const DEFAULT_BLOCK_CHARTS: Record<string, number[]> = {
  assembly: [25053],
  slots: [20209],
  waits: [28163],
  retention: [25939],
  photo: [31704],
  zones: [23507],
};

/** Route table: every allowed call is pinned to exactly one HTTP method. */
const ALLOWED_ROUTES: Array<{ method: string; path?: string; prefix?: string }> = [
  { method: "POST", path: "/api/v1/security/login" },
  { method: "GET", path: "/api/v1/security/csrf_token/" },
  { method: "POST", path: "/api/v1/chart/data" },
  { method: "GET", prefix: "/api/v1/chart/data/" },
  { method: "GET", prefix: "/api/v1/chart/" },
];

/** Exact method+path pairs that must never pass, even if a prefix rule would match them. */
const ALLOWED_ROUTE_DENY: Array<{ method: string; path: string }> = [
  // chart/data is a POST endpoint; the GET prefix above exists for /chart/data/{key} only
  { method: "GET", path: "/api/v1/chart/data" },
];

// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

type Json = any;

export interface CliArgs {
  live: boolean;
  confirm: boolean;
  baseUrl: string;
  bodiesDir: string;
  outDir: string;
  shopno: string;
  weeks: number;
  from: string | null;
  to: string | null;
  timeRange: string | null;
  rowLimit: number;
  timeoutMs: number;
  pollTimeoutMs: number;
  addDateSupply: boolean;
  injectShopno: boolean;
  /** proceed even when the chart explicitly excludes the requested darkstore (NOT IN) */
  forceShopno: boolean;
  session: string;
  csrf: string;
  token: string;
  username: string;
  password: string;
  provider: string;
  files: number[];
  /** chart ids to build requests for via GET /api/v1/chart/{id} */
  fromCharts: number[];
  /** directory with saved chart details for --offline */
  chartDetailsDir: string;
  /** build chart requests from saved details instead of the API */
  offlineCharts: boolean;
  /** write artifact JSON/CSV verbatim (PII may appear in chart titles and dimension values) */
  rawArtifacts: boolean;
  help: boolean;
}

export interface RequestPlan {
  n: number;
  source: "har" | "chart";
  file: string;
  chartId: number | null;
  chartName: string;
  sliceId: number | null;
  datasourceId: number | null;
  vizType: string;
  body: Json;
  bodySha256: string;
  url: string;
  /** metrics declared by the query (named metrics or ad-hoc labels) */
  metricNames: string[];
  /** dimension columns declared by the query (names or ad-hoc labels) */
  dimensionColumns: string[];
  /** candidate temporal columns (granularity, temporal filters, date-like columns) */
  temporalColumns: string[];
  /** per-query metadata; charts may carry several queries and the response mirrors the order */
  queryMetas: QueryMeta[];
}

/** Metadata of one entry of `queries[]`. */
export interface QueryMeta {
  metricNames: string[];
  dimensionColumns: string[];
  temporalColumns: string[];
  /** the temporal column transformBody actually used for this query (for auditability) */
  temporalChosen: string | null;
  rowLimit: number | null;
  isTimeseries: boolean;
  postProcessing: boolean;
}

export type MetricKind = "additive" | "ratio";

export interface Observation {
  date: string;
  sliceId: number | null;
  datasourceId: number | null;
  vizType: string;
  dimension1: string;
  dimension2: string;
  metric: string;
  kind: MetricKind;
  value: number;
  /** Denominator of the same source row (`qty_orders_delivered`), when the row carries it. */
  weight?: number;
  /** index of the `result[]`/`queries[]` entry this observation came from */
  queryIndex?: number;
}

interface GroupAcc {
  date: string;
  sliceId: number | null;
  datasourceId: number | null;
  vizType: string;
  dimension1: string;
  dimension2: string;
  rows: number;
  /** metrics actually observed in this group (absent metrics must stay empty, not 0) */
  seen: Set<string>;
  additive: Map<string, number>;
  /** metric -> sum(value * weight) and sum(weight) for weighted ratio aggregation */
  ratioWsum: Map<string, number>;
  ratioW: Map<string, number>;
  ratioPlain: Map<string, number>;
  ratioRows: Map<string, number>;
  ratioRowsWithWeight: Map<string, number>;
}

interface RequestResult {
  n: number;
  file: string;
  sliceId: number | null;
  url: string;
  status: number | null;
  mode: "dry-run" | "200" | "202+poll" | "error";
  pollKey: string | null;
  attempts: number;
  rowCount: number | null;
  colnames: string[];
  problems: string[];
  requestSha256: string;
  responseSha256: string | null;
  responseFile: string | null;
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function sha256(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}

function nowIso(): string {
  return new Date().toISOString();
}

function mskDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: MSK,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function addDays(d: Date, days: number): Date {
  const copy = new Date(d.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

/** True only for values that really look like a date (numbers must be ms epochs). */
function parsesAsDate(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "number") return Number.isFinite(value) && value > 1e11;
  const s = String(value).trim();
  if (!s) return false;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return true;
  if (/^\d+$/.test(s)) return false; // pure numbers are metrics, not dates
  if (s.length < 8) return false;
  return !Number.isNaN(new Date(s).getTime());
}

function toDateKey(value: unknown): string {
  if (!parsesAsDate(value)) return "";
  if (typeof value === "number") return mskDate(new Date(value));
  const s = String(value);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return mskDate(new Date(s));
}

function numeric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.replace(/\s+/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function metricKind(name: string): MetricKind {
  return RATIO_RE.test(name) ? "ratio" : "additive";
}

// --- chart/query metadata helpers -----------------------------------------

/** Named metric -> its own name; ad-hoc metric/column -> its label. */
function fieldName(entry: Json): string | null {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object" && typeof entry.label === "string") return entry.label;
  return null;
}

function queryOf(body: Json): Json {
  return Array.isArray(body?.queries) ? (body.queries[0] ?? {}) : {};
}

/** Candidate temporal columns of a query, most reliable first. */
function temporalColumnsOf(body: Json): string[] {
  const q = queryOf(body);
  const fd = body?.form_data ?? {};
  const out: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string" && v && !out.includes(v)) out.push(v);
  };
  push(q.granularity);
  push(fd.granularity_sqla);
  push(fd.granularity);
  for (const f of Array.isArray(q.filters) ? q.filters : []) {
    if (f?.op === "TEMPORAL_RANGE") push(f.col);
  }
  for (const f of Array.isArray(fd.adhoc_filters) ? fd.adhoc_filters : []) {
    if (f?.operator === "TEMPORAL_RANGE") push(f.subject);
  }
  // date-like column entries (ad-hoc SQL date dimensions land here)
  for (const c of Array.isArray(q.columns) ? q.columns : []) {
    const name = fieldName(c);
    if (typeof name === "string" && TEMPORAL_LABEL_RE.test(name)) push(name);
    if (c && typeof c === "object" && typeof c.sqlExpression === "string") {
      const m = c.sqlExpression.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
      for (const token of m) if (/date|день|day/i.test(token)) push(token);
    }
  }
  return out;
}

function columnNamesOf(body: Json): string[] {
  const q = queryOf(body);
  const out: string[] = [];
  for (const c of Array.isArray(q.columns) ? q.columns : []) {
    const n = fieldName(c);
    if (n && !out.includes(n)) out.push(n);
  }
  // form_data.groupby* is a fallback only when the query does not state its own grain at all.
  // An explicit `columns: []` (e.g. the totals query of slice 20403) means "no grouping" and must
  // not inherit the chart-level groupby, otherwise the totals row looks like a missing dimension.
  if (out.length === 0 && q.columns === undefined) {
    const fd = body?.form_data ?? {};
    for (const g of [fd.groupby, fd.groupbyRows, fd.groupbyColumns]) {
      for (const c of Array.isArray(g) ? g : []) {
        const n = fieldName(c);
        if (n && !out.includes(n)) out.push(n);
      }
    }
  }
  return out;
}

function metricNamesOf(body: Json): string[] {
  const q = queryOf(body);
  const out: string[] = [];
  for (const m of Array.isArray(q.metrics) ? q.metrics : []) {
    const n = fieldName(m);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

/** True only when the *chosen* temporal column is already a dimension of the query. */
function hasTemporalDimension(body: Json, temporal: string | null): boolean {
  const q = queryOf(body);
  for (const c of Array.isArray(q.columns) ? q.columns : []) {
    const name = fieldName(c);
    if (temporal && name === temporal) return true;
    if (c && typeof c === "object" && typeof c.sqlExpression === "string" && temporal) {
      if (c.sqlExpression.toLowerCase().includes(temporal.toLowerCase())) return true;
    }
  }
  return false;
}

/** Date-like dimension columns that are NOT the chosen temporal column (grain ambiguity). */
function otherTemporalColumns(body: Json, temporal: string | null): string[] {
  const q = queryOf(body);
  const out: string[] = [];
  for (const c of Array.isArray(q.columns) ? q.columns : []) {
    const name = fieldName(c);
    if (typeof name !== "string" || name === temporal) continue;
    const looksTemporal = TEMPORAL_LABEL_RE.test(name);
    const sqlTemporal = c && typeof c === "object" && typeof c.sqlExpression === "string" && TEMPORAL_LABEL_RE.test(c.sqlExpression);
    if ((looksTemporal || sqlTemporal) && !out.includes(name)) out.push(name);
  }
  return out;
}

/** Positive operators that restrict a query to specific shopno values. */
const SHOPO_INCLUDE_OPS = /^(IN|IS IN|EQUALS?|=|==)$/i;
/** Negative operators that exclude values but do NOT restrict the selection to one darkstore. */
const SHOPO_EXCLUDE_OPS = /^(NOT IN|NOT EQUALS?|!=|<>)$/i;

/** Shopno operator classification: "include" | "exclude" | null (not a shopno constraint). */
function shopnoOpKind(op: string | null): "include" | "exclude" | null {
  if (op == null) return null;
  const normalized = op.toUpperCase().replace(/\s+/g, " ").trim();
  // TEMPORAL_RANGE also contains the substring "IN" but is never a shopno constraint
  if (/^TEMPORAL/i.test(normalized)) return null;
  if (SHOPO_EXCLUDE_OPS.test(normalized)) return "exclude";
  if (SHOPO_INCLUDE_OPS.test(normalized)) return "include";
  return null;
}

function shopnoFilterValues(f: Json): string[] {
  const raw = filterVal(f);
  return (Array.isArray(raw) ? raw : String(raw ?? "").split(",")).map((v) => String(v).trim()).filter((v) => v !== "");
}

/**
 * Does this single query object carry a shopno constraint?
 * `positive` counts only include-operators (IN/=) that really restrict the selection;
 * `any` additionally sees negative ones (NOT IN/!=/<>) — used for rewrite auditing,
 * never for skipping injection: an exclusion does not bound the result set to one darkstore.
 */
export function hasShopnoFilter(query: Json, mode: "positive" | "any" = "positive"): boolean {
  return (Array.isArray(query?.filters) ? query.filters : []).some(
    (f: Json) => filterCol(f) === "shopno" && shopnoOpKind(filterOp(f)) !== null &&
      (mode === "any" || shopnoOpKind(filterOp(f)) === "include"),
  );
}

/**
 * Adds `shopno IN [shopno]` to every query that lacks a POSITIVE shopno restriction.
 * Per-query on purpose: a sibling's filter or a mere NOT IN must never mask this one.
 */
export function injectShopnoFilter(body: Json, shopno: string): number {
  let added = 0;
  for (const q of Array.isArray(body?.queries) ? body.queries : []) {
    q.filters = Array.isArray(q.filters) ? q.filters : [];
    if (!hasShopnoFilter(q)) {
      q.filters.unshift({ col: "shopno", op: "IN", val: [shopno] });
      added++;
    }
  }
  return added;
}

function adhocToFilters(list: Json[]): Json[] {
  const out: Json[] = [];
  for (const f of Array.isArray(list) ? list : []) {
    if (f?.expressionType !== "SIMPLE" || !f?.subject) continue;
    // comparator is a comma-separated list for set operators, a scalar for equality operators
    const op = f.operator ?? "IN";
    const raw = f.comparator;
    const val = /^\s*NOT\s+IN\s*$/i.test(String(op)) || /^IN$/i.test(String(op))
      ? Array.isArray(raw)
        ? raw
        : String(raw ?? "").split(",").map((s) => s.trim()).filter(Boolean)
      : raw;
    out.push({ col: f.subject, op, val });
  }
  return out;
}

/** Build a chart/data body from a `GET /api/v1/chart/{id}` payload (or a saved detail file). */
export function buildBodyFromChartDetail(detail: Json): Json {
  const r = detail?.result ?? detail ?? {};
  const qcRaw = r?.query_context;
  let qc: Json | null = null;
  if (typeof qcRaw === "string" && qcRaw.trim()) {
    try { qc = JSON.parse(qcRaw); } catch { qc = null; }
  } else if (qcRaw && typeof qcRaw === "object") {
    qc = qcRaw;
  }
  let params: Json = {};
  if (typeof r?.params === "string" && r.params.trim()) {
    try { params = JSON.parse(r.params); } catch { params = {}; }
  } else if (r?.params && typeof r.params === "object") {
    params = r.params;
  }

  const dsId = r?.datasource_id ?? qc?.datasource?.id ?? params?.datasource_id ?? null;
  const dsType = r?.datasource_type ?? qc?.datasource?.type ?? "table";

  let queries: Json[];
  if (Array.isArray(qc?.queries) && qc.queries.length) {
    queries = JSON.parse(JSON.stringify(qc.queries));
  } else {
    queries = [{
      time_range: params?.time_range ?? "No filter",
      granularity: params?.granularity_sqla ?? params?.granularity,
      filters: adhocToFilters(params?.adhoc_filters),
      extras: { time_grain_sqla: params?.time_grain_sqla ?? null, having: "", where: "" },
      columns: params?.groupby ?? params?.groupbyRows ?? params?.all_columns ?? [],
      metrics: params?.metrics ?? [],
      orderby: [],
      row_limit: numeric(params?.row_limit) ?? 1000,
      is_timeseries: false,
      annotation_layers: [],
      url_params: {},
      custom_params: {},
      custom_form_data: {},
      post_processing: [],
      time_offsets: [],
    }];
  }

  const formData: Json = { ...(qc?.form_data ?? {}) };
  for (const key of ["viz_type", "metrics", "groupby", "groupbyRows", "groupbyColumns", "adhoc_filters", "time_range", "granularity_sqla", "time_grain_sqla", "row_limit", "order_desc", "all_columns"]) {
    if (formData[key] === undefined && params?.[key] !== undefined) formData[key] = params[key];
  }
  formData.datasource = `${dsId}__${dsType}`;
  formData.viz_type = r?.viz_type ?? params?.viz_type ?? formData.viz_type ?? "table";
  formData.slice_id = r?.id ?? params?.slice_id ?? formData.slice_id ?? null;
  const dashId = (Array.isArray(r?.dashboards) ? r.dashboards[0]?.id : undefined) ?? formData.dashboardId ?? 977;
  formData.dashboardId = dashId;
  formData.result_format = "json";
  formData.result_type = "full";

  return {
    datasource: { id: dsId, type: dsType },
    force: false,
    queries,
    form_data: formData,
    result_format: "json",
    result_type: "full",
    client_id: `chart_${r?.id ?? "unknown"}`,
  };
}

function fmtNumber(value: number): string {
  if (!Number.isFinite(value)) return "";
  return String(Math.round(value * 1e6) / 1e6);
}

function csvCell(value: unknown): string {
  if (value == null) return "";
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(header: string[], rows: Array<Array<unknown>>): string {
  const lines = [header.map(csvCell).join(",")];
  for (const row of rows) lines.push(row.map(csvCell).join(","));
  return `${lines.join("\n")}\n`;
}

async function writeText(path: string, text: string): Promise<void> {
  await mkdir(dirname(resolve(path)), { recursive: true });
  await Bun.write(path, text);
}

/** Mask PII in artifact text (chart titles, dimension values, filter values) unless --raw-artifacts. */
function piiSafe(value: string, args: CliArgs): string {
  return args.rawArtifacts ? value : redactText(value).text;
}

/**
 * Mask one CSV cell. The column header carries the semantics, so a value under
 * `courier_id` / `id_courier` / `person_code` / `employee_id` is masked even when it is a bare number
 * (redactText alone cannot see the key there).
 */
function piiSafeCell(header: string, value: unknown, args: CliArgs): unknown {
  if (args.rawArtifacts) return value;
  if (isPersonIdKey(header)) {
    if (value === "" || value === null || value === undefined) return value;
    return PERSON_ID_PLACEHOLDER;
  }
  return typeof value === "string" ? redactText(value).text : value;
}

/** Serialise an artifact with PII masked by default; returns the payload and the hit counts. */
function artifactJson(value: unknown, args: CliArgs): { text: string; hits: number } {
  if (args.rawArtifacts) return { text: `${JSON.stringify(value, null, 2)}\n`, hits: 0 };
  const { value: masked, counts } = redactJson(value);
  const hits = Object.values(counts).reduce((a, b) => a + b, 0);
  return { text: `${JSON.stringify(masked, null, 2)}\n`, hits };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage(): string {
  return `usage: bun tools/fetch-darkstore-aggregates.ts [options]

Modes
  --dry-run                 build and validate requests only, no network (default)
  --live                    send requests to Superset (requires auth)
  --yes                     required together with --live; without it --live only prints the plan

Selection
  --shopno <n>              darkstore number, rewrites shopno IN (...) (default ${DEFAULT_SHOPNO})
  --files <list>            HAR body numbers, comma separated (default ${DEFAULT_SLICE_FILES.join(",")})
  --bodies <dir>            directory with HAR request bodies (default ${DEFAULT_BODIES_DIR})
  --out <dir>               output directory (default ${DEFAULT_OUT_DIR})

Time window
  --weeks <n>               window length in weeks ending today, MSK (default ${DEFAULT_WEEKS})
  --from <YYYY-MM-DD>       explicit window start
  --to <YYYY-MM-DD>         explicit window end (inclusive)
  --time-range <expr>       full Superset time_range expression, overrides --weeks/--from/--to
  --row-limit <n>           raise smaller row_limit values to this (default ${DEFAULT_ROW_LIMIT})
  --keep-columns            do not add the temporal column to queries[].columns
  --inject-shopno           add "shopno IN (...)" when the query has no shopno filter (default on in chart mode)
  --no-inject-shopno        disable shopno injection
  --force-shopno            proceed even if the chart excludes the requested darkstore (NOT IN)

Charts (build requests from chart metadata instead of saved HAR bodies)
  --from-chart <ids>        comma separated chart ids, e.g. 25053,20209,28163
  --charts <ids>            alias for --from-chart
  --offline                 build from saved details in --chart-details-dir (no network)
  --raw-artifacts           keep chart titles / dimension values verbatim in artifacts (PII not masked)
  --chart-details-dir <d>   directory with GET /api/v1/chart/{id} payloads (default ${DEFAULT_CHART_DETAILS_DIR})

Network
  --base <url>              Superset base URL (default env SUPERSET_URL or ${DEFAULT_BASE_URL})
  --session <cookie>        session cookie value or full "k=v; k=v" string
  --csrf <token>            X-CSRFToken value (otherwise fetched from the CSRF endpoint)
  --token <jwt>             Authorization: Bearer token
  --username <u>            login (with --password) when no session/token is available
  --password <p>
  --provider <p>            login provider (default db)
  --timeout <s>             per-request timeout (default ${DEFAULT_TIMEOUT_S})
  --poll-timeout <s>        async 202 polling budget (default ${DEFAULT_POLL_TIMEOUT_S})

  --help
`;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    live: false,
    confirm: false,
    baseUrl: (Bun.env.SUPERSET_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, ""),
    bodiesDir: DEFAULT_BODIES_DIR,
    outDir: DEFAULT_OUT_DIR,
    shopno: DEFAULT_SHOPNO,
    weeks: DEFAULT_WEEKS,
    from: null,
    to: null,
    timeRange: null,
    rowLimit: DEFAULT_ROW_LIMIT,
    timeoutMs: DEFAULT_TIMEOUT_S * 1000,
    pollTimeoutMs: DEFAULT_POLL_TIMEOUT_S * 1000,
    addDateSupply: true,
    injectShopno: false,
    forceShopno: false,
    session: Bun.env.SUPERSET_SESSION_COOKIE ?? "",
    csrf: Bun.env.SUPERSET_CSRF_TOKEN ?? "",
    token: Bun.env.SUPERSET_ACCESS_TOKEN ?? "",
    username: Bun.env.SUPERSET_USERNAME ?? "",
    password: Bun.env.SUPERSET_PASSWORD ?? "",
    provider: Bun.env.SUPERSET_PROVIDER ?? "db",
    files: [...DEFAULT_SLICE_FILES],
    fromCharts: [],
    chartDetailsDir: DEFAULT_CHART_DETAILS_DIR,
    offlineCharts: false,
    rawArtifacts: false,
    help: false,
  };

  let filesExplicit = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v == null) throw new Error(`missing value for ${a}`);
      return v;
    };
    switch (a) {
      case "--live": args.live = true; break;
      case "--yes": case "--confirm-live": args.confirm = true; break;
      case "--dry-run": args.live = false; break;
      case "--help": case "-h": args.help = true; break;
      case "--keep-columns": args.addDateSupply = false; break;
      case "--inject-shopno": args.injectShopno = true; break;
      case "--no-inject-shopno": args.injectShopno = false; break;
      case "--force-shopno": args.forceShopno = true; break;
      case "--offline": args.offlineCharts = true; break;
      case "--raw-artifacts": args.rawArtifacts = true; break;
      case "--chart-details-dir": args.chartDetailsDir = next(); break;
      case "--from-chart": case "--charts":
        args.fromCharts = next()
          .split(",")
          .map((x) => Number.parseInt(x.trim(), 10))
          .filter((x) => Number.isFinite(x));
        break;
      case "--base": args.baseUrl = next().replace(/\/+$/, ""); break;
      case "--shopno": args.shopno = next(); break;
      case "--bodies": args.bodiesDir = next(); break;
      case "--out": args.outDir = next(); break;
      case "--weeks": args.weeks = Number.parseInt(next(), 10); break;
      case "--from": args.from = next(); break;
      case "--to": args.to = next(); break;
      case "--time-range": args.timeRange = next(); break;
      case "--row-limit": args.rowLimit = Number.parseInt(next(), 10); break;
      case "--session": args.session = next(); break;
      case "--csrf": args.csrf = next(); break;
      case "--token": args.token = next(); break;
      case "--username": args.username = next(); break;
      case "--password": args.password = next(); break;
      case "--provider": args.provider = next(); break;
      case "--timeout": args.timeoutMs = Number.parseInt(next(), 10) * 1000; break;
      case "--poll-timeout": args.pollTimeoutMs = Number.parseInt(next(), 10) * 1000; break;
      case "--files":
        filesExplicit = true;
        args.files = next()
          .split(",")
          .map((x) => Number.parseInt(x.trim(), 10))
          .filter((x) => Number.isFinite(x));
        break;
      default:
        throw new Error(`unknown option: ${a}`);
    }
  }

  if (!Number.isFinite(args.weeks) || args.weeks <= 0) throw new Error("--weeks must be a positive integer");
  if (!Number.isFinite(args.rowLimit) || args.rowLimit <= 0) throw new Error("--row-limit must be a positive integer");
  if (!args.files.length && !args.fromCharts.length) {
    throw new Error("provide --files <har body numbers> or --from-chart <chart ids>");
  }
  if (args.fromCharts.length && !filesExplicit) args.files = [];
  if (args.fromCharts.length && !argv.includes("--no-inject-shopno")) args.injectShopno = true;
  if (args.offlineCharts && args.live) throw new Error("--offline cannot be combined with --live");
  return args;
}

// ---------------------------------------------------------------------------
// period
// ---------------------------------------------------------------------------

function resolveTimeRange(args: CliArgs): { from: string; to: string; expression: string } {
  if (args.timeRange) {
    return { from: args.from ?? "", to: args.to ?? "", expression: args.timeRange };
  }
  const today = mskDate(new Date());
  const to = args.to ?? today;
  const from = args.from ?? mskDate(addDays(new Date(`${to}T12:00:00Z`), -(args.weeks * 7 - 1)));
  return { from, to, expression: `${from} : ${to}` };
}

// ---------------------------------------------------------------------------
// request transformation
// ---------------------------------------------------------------------------

function walkFilters(node: Json, visit: (f: Json) => void): void {
  if (node == null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walkFilters(item, visit);
    return;
  }
  for (const key of Object.keys(node)) {
    const value = node[key];
    if ((key === "filters" || key === "adhoc_filters") && Array.isArray(value)) {
      for (const f of value) if (f && typeof f === "object") visit(f);
    }
    walkFilters(value, visit);
  }
}

/** Filter field accessors covering both shapes: {col,op,val} and {subject,operator,comparator}. */
function filterCol(f: Json): string | null {
  const v = f?.col ?? f?.subject;
  return typeof v === "string" ? v : null;
}
function filterOp(f: Json): string | null {
  const v = f?.op ?? f?.operator;
  return typeof v === "string" ? v : null;
}
function filterVal(f: Json): unknown {
  return f?.val !== undefined ? f.val : f?.comparator;
}
function setFilterVal(f: Json, value: unknown): void {
  if (f?.val !== undefined || f?.comparator === undefined) f.val = value;
  else {
    // SIMPLE ad-hoc filters keep the scalar shape of the comparator for equality operators
    const op = filterOp(f);
    const scalar = op != null && shopnoOpKind(op) === "include" && !/\bIN\b/i.test(` ${op.trim()} `);
    f.comparator = scalar && Array.isArray(value) ? String(value[0] ?? "") : value;
  }
}

export interface ShopnoScan {
  includeValues: string[];
  excludeValues: string[];
  /** queries[] without a POSITIVE shopno restriction (indices); NOT IN alone does not bound the scan */
  unfilteredQueries: number[];
}

export function scanShopno(body: Json): ShopnoScan {
  const includeValues: string[] = [];
  const excludeValues: string[] = [];
  walkFilters(body, (f) => {
    if (filterCol(f) !== "shopno") return;
    const kind = shopnoOpKind(filterOp(f));
    if (kind == null) return;
    const values = shopnoFilterValues(f);
    (kind === "exclude" ? excludeValues : includeValues).push(...values);
  });
  const unfilteredQueries: number[] = [];
  (Array.isArray(body?.queries) ? body.queries : []).forEach((q: Json, i: number) => {
    if (!hasShopnoFilter(q)) unfilteredQueries.push(i);
  });
  return {
    includeValues: [...new Set(includeValues)],
    excludeValues: [...new Set(excludeValues)],
    unfilteredQueries,
  };
}

function rewriteShopno(body: Json, shopno: string): number {
  let rewrites = 0;
  walkFilters(body, (f) => {
    if (filterCol(f) === "shopno" && shopnoOpKind(filterOp(f)) === "include") {
      if (JSON.stringify(shopnoFilterValues(f)) !== JSON.stringify([shopno])) rewrites++;
      setFilterVal(f, [shopno]);
    }
  });
  return rewrites;
}

export interface TransformReport {
  sliceId: number | null;
  queries: number;
  datesupplyAdded: number;
  temporalRewrites: number;
  rowLimitRaised: number;
  shopnoRewrites: number;
  shopnoInjected: number;
  /** shopno values present in the chart before rewriting (semantic-change audit) */
  shopnoOriginalValues: string[];
  /** true when the target darkstore is explicitly excluded (NOT IN / != / <>) by the chart */
  shopnoExcluded: boolean;
  /** indices of queries[] left without any shopno constraint (chart mode must never query them unrestricted) */
  shopnoUnfilteredQueries: number[];
  /** every semantic override applied to the original chart, human readable */
  semanticOverrides: string[];
  /** date-like dimensions that are not the chosen temporal column (grain ambiguity, never guessed) */
  temporalAmbiguity: string[];
  timeRange: string;
}

export function transformBody(body: Json, args: CliArgs, period: { expression: string }): TransformReport {
  const before = scanShopno(body);
  const overrides: string[] = [];
  const report: TransformReport = {
    sliceId: body?.form_data?.slice_id ?? null,
    queries: Array.isArray(body?.queries) ? body.queries.length : 0,
    datesupplyAdded: 0,
    temporalRewrites: 0,
    rowLimitRaised: 0,
    shopnoRewrites: rewriteShopno(body, args.shopno),
    shopnoInjected: 0,
    shopnoOriginalValues: before.includeValues,
    shopnoExcluded: before.excludeValues.includes(args.shopno),
    shopnoUnfilteredQueries: before.unfilteredQueries,
    semanticOverrides: overrides,
    temporalAmbiguity: [],
    timeRange: period.expression,
  };

  if (report.shopnoRewrites > 0) {
    overrides.push(`shopno IN ${JSON.stringify(before.includeValues)} -> ${JSON.stringify([args.shopno])} (${report.shopnoRewrites} filter(s))`);
  }
  if (report.shopnoExcluded) {
    overrides.push(`shopno NOT IN ${JSON.stringify(before.excludeValues)} excludes the requested darkstore ${args.shopno}`);
  }
  if (before.unfilteredQueries.length && args.injectShopno) {
    overrides.push(`unfiltered query indices: ${before.unfilteredQueries.join(", ")} — will inject shopno IN (${args.shopno})`);
  }

  const isFreshness = report.sliceId === FRESHNESS_SLICE;
  const primaryTemporal = temporalColumnsOf(body)[0] ?? null;

  for (const q of Array.isArray(body?.queries) ? body.queries : []) {
    if (q.time_range !== undefined && q.time_range !== period.expression) {
      overrides.push(`time_range ${JSON.stringify(q.time_range)} -> ${JSON.stringify(period.expression)}`);
    }
    q.time_range = period.expression;
    if (!q.granularity && primaryTemporal) q.granularity = primaryTemporal;

    if (!isFreshness) {
      q.extras = q.extras ?? {};
      if (q.extras.time_grain_sqla !== undefined && q.extras.time_grain_sqla !== "P1D") {
        overrides.push(`time_grain_sqla ${JSON.stringify(q.extras.time_grain_sqla)} -> "P1D"`);
      }
      q.extras.time_grain_sqla = "P1D";
      q.time_grain_sqla = "P1D";
    }

    if (Array.isArray(q.filters)) {
      for (const f of q.filters) {
        if (f?.op === "TEMPORAL_RANGE" && f.val !== period.expression) {
          overrides.push(`TEMPORAL_RANGE ${JSON.stringify(f.col)} ${JSON.stringify(f.val)} -> ${JSON.stringify(period.expression)}`);
          f.val = period.expression;
          report.temporalRewrites++;
        }
      }
    }

    const isSeries = q.is_timeseries === true;
    const temporal = typeof q.granularity === "string" && q.granularity ? q.granularity : primaryTemporal;

    // per-query: a shopno constraint on a sibling query must never mask this one
    if (args.injectShopno && !hasShopnoFilter(q)) {
      const injected = injectShopnoFilter({ queries: [q] }, args.shopno);
      report.shopnoInjected += injected;
      if (injected > 0) overrides.push(`injected shopno IN ${JSON.stringify([args.shopno])}`);
    }

    if (
      args.addDateSupply &&
      !isFreshness &&
      !isSeries &&
      temporal &&
      Array.isArray(q.columns) &&
      q.columns.length > 0
    ) {
      if (!hasTemporalDimension({ queries: [q] }, temporal)) {
        const others = otherTemporalColumns({ queries: [q] }, temporal);
        if (others.length) {
          // never silently mix two grains: keep the chart's own date dimension and report it
          for (const other of others) {
            if (!report.temporalAmbiguity.includes(other)) report.temporalAmbiguity.push(other);
          }
        } else {
          q.columns.unshift(temporal);
          report.datesupplyAdded++;
          overrides.push(`columns += ${JSON.stringify(temporal)}`);
        }
      }
    }

    if (!isFreshness && q.row_limit !== 0) {
      const limit = numeric(q.row_limit);
      if (limit == null || limit < args.rowLimit) {
        overrides.push(`row_limit ${JSON.stringify(q.row_limit ?? null)} -> ${args.rowLimit}`);
        q.row_limit = args.rowLimit;
        report.rowLimitRaised++;
      }
    }
  }

  const fd = body?.form_data;
  if (fd && typeof fd === "object") {
    fd.time_range = period.expression;
    if (!isFreshness) fd.time_grain_sqla = "P1D";
    if (fd.extra_form_data && typeof fd.extra_form_data === "object") {
      fd.extra_form_data.time_range = period.expression;
      if (!isFreshness) fd.extra_form_data.time_grain_sqla = "P1D";
    }
    if (fd.form_data_bak && typeof fd.form_data_bak === "object") {
      fd.form_data_bak.time_range = period.expression;
      if (!isFreshness) fd.form_data_bak.time_grain_sqla = "P1D";
    }
    if (Array.isArray(fd.adhoc_filters)) {
      for (const f of fd.adhoc_filters) {
        if (f?.operator === "TEMPORAL_RANGE") f.comparator = period.expression;
      }
    }
    if (fd.extra_form_data && Array.isArray(fd.extra_form_data.filters)) {
      for (const f of fd.extra_form_data.filters) {
        if (f?.op === "TEMPORAL_RANGE") f.val = period.expression;
      }
    }
    if (!isFreshness) {
      const fdLimit = numeric(fd.row_limit);
      if (fdLimit != null && fdLimit !== 0 && fdLimit < args.rowLimit) {
        fd.row_limit = args.rowLimit;
        report.rowLimitRaised++;
      }
    }
  }

  return report;
}

export function planMeta(body: Json): Pick<RequestPlan, "metricNames" | "dimensionColumns" | "temporalColumns"> {
  const metas = planMetas(body);
  const first = metas[0] ?? { metricNames: [], dimensionColumns: [], temporalColumns: [] };
  return {
    metricNames: first.metricNames,
    dimensionColumns: first.dimensionColumns,
    temporalColumns: first.temporalColumns,
  };
}

/** Per-query metadata: charts with several `queries[]` get one entry each, in response order. */
export function planMetas(body: Json): QueryMeta[] {
  const queries: Json[] = Array.isArray(body?.queries) ? body.queries : [];
  if (!queries.length) return [];
  return queries.map((q) => {
    const single = { queries: [q], form_data: body?.form_data };
    const temporal = temporalColumnsOf(single);
    return {
      metricNames: metricNamesOf(single),
      dimensionColumns: columnNamesOf(single),
      temporalColumns: temporal,
      temporalChosen: temporal[0] ?? null,
      rowLimit: numeric(q?.row_limit),
      isTimeseries: q?.is_timeseries === true,
      postProcessing: Array.isArray(q?.post_processing) && q.post_processing.length > 0,
    };
  });
}

function requestUrl(args: CliArgs, body: Json): string {
  const sliceId = body?.form_data?.slice_id ?? null;
  return (
    `${args.baseUrl}/api/v1/chart/data?form_data=` +
    encodeURIComponent(JSON.stringify({ slice_id: sliceId })) +
    `&dashboard_id=${body?.form_data?.dashboardId ?? 977}`
  );
}

export async function loadChartDetail(args: CliArgs, chartId: number): Promise<Json> {
  if (args.offlineCharts) {
    const file = join(args.chartDetailsDir, `${chartId}.json`);
    const text = await Bun.file(file).text();
    return JSON.parse(text);
  }
  throw new Error("loadChartDetail without --offline requires the HTTP client");
}

async function loadPlans(
  args: CliArgs,
  period: { expression: string },
  chartDetails?: Map<number, Json>,
): Promise<{ plans: RequestPlan[]; reports: TransformReport[] }> {
  const plans: RequestPlan[] = [];
  const reports: TransformReport[] = [];
  let ordinal = 0;

  for (const n of args.files) {
    const file = join(args.bodiesDir, `${String(n).padStart(3, "0")}_POST__api_v1_chart_data.request.json`);
    const raw = await Bun.file(file).text();
    const body = JSON.parse(raw);
    reports.push(transformBody(body, args, period));
    ordinal++;
    plans.push({
      n: ordinal,
      source: "har",
      file,
      chartId: null,
      chartName: `HAR body ${n}`,
      sliceId: body?.form_data?.slice_id ?? null,
      datasourceId: body?.datasource?.id ?? null,
      vizType: body?.form_data?.viz_type ?? "unknown",
      body,
      bodySha256: sha256(JSON.stringify(body)),
      url: requestUrl(args, body),
      ...planMeta(body),
      queryMetas: planMetas(body),
    });
  }

  for (const chartId of args.fromCharts) {
    const detail = chartDetails?.get(chartId) ?? (await loadChartDetail(args, chartId));
    const body = buildBodyFromChartDetail(detail);
    reports.push(transformBody(body, args, period));
    ordinal++;
    const r = detail?.result ?? detail ?? {};
    plans.push({
      n: ordinal,
      source: "chart",
      file: `${args.chartDetailsDir}/${chartId}.json`,
      chartId,
      chartName: String(r?.slice_name ?? ""),
      sliceId: body?.form_data?.slice_id ?? chartId,
      datasourceId: body?.datasource?.id ?? null,
      vizType: body?.form_data?.viz_type ?? "unknown",
      body,
      bodySha256: sha256(JSON.stringify(body)),
      url: requestUrl(args, body),
      ...planMeta(body),
      queryMetas: planMetas(body),
    });
  }

  return { plans, reports };
}

// ---------------------------------------------------------------------------
// HTTP (read-only)
// ---------------------------------------------------------------------------

interface HttpResponse {
  status: number;
  headers: Headers;
  text: string;
  json: Json | null;
}

export function assertAllowed(path: string, method = "GET"): void {
  const clean = path.split("?")[0] ?? path;
  const verb = method.toUpperCase();
  if (ALLOWED_ROUTE_DENY.some((r) => r.method === verb && r.path === clean)) {
    throw new Error(`refusing to call non-read-only endpoint: ${method} ${path}`);
  }
  const allowed = ALLOWED_ROUTES.some((r) => {
    if (r.method !== verb) return false;
    if (r.path != null) return r.path === clean;
    if (r.prefix != null) return clean.startsWith(r.prefix);
    return false;
  });
  if (!allowed) {
    throw new Error(`refusing to call non-read-only endpoint: ${method} ${path}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class ReadOnlySuperset {
  private token = "";
  private csrf = "";
  private sessionCookie: string;
  readonly log: string[] = [];

  constructor(private args: CliArgs) {
    this.token = args.token;
    this.csrf = args.csrf;
    this.sessionCookie = args.session;
  }

  private headers(init: RequestInit): Headers {
    const h = new Headers(init.headers);
    h.set("Accept", "application/json");
    if (this.sessionCookie) h.set("Cookie", this.sessionCookie.includes("=") ? this.sessionCookie : `session=${this.sessionCookie}`);
    if (this.token) h.set("Authorization", `Bearer ${this.token}`);
    if (this.csrf) h.set("X-CSRFToken", this.csrf);
    return h;
  }

  private async raw(path: string, init: RequestInit = {}): Promise<HttpResponse> {
    assertAllowed(path, String(init.method ?? "GET"));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.args.timeoutMs);
    try {
      const response = await fetch(new URL(path, this.args.baseUrl), {
        ...init,
        headers: this.headers(init),
        signal: controller.signal,
        redirect: "manual",
      });
      const text = await response.text();
      let json: Json | null = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      return { status: response.status, headers: response.headers, text, json };
    } finally {
      clearTimeout(timer);
    }
  }

  private async request(path: string, init: RequestInit = {}, retries = 3): Promise<HttpResponse> {
    let attempt = 0;
    for (;;) {
      let outcome: HttpResponse;
      try {
        outcome = await this.raw(path, init);
      } catch (error) {
        if (attempt < retries) {
          attempt++;
          await sleep(500 * 2 ** (attempt - 1));
          continue;
        }
        throw error;
      }
      const retryable = outcome.status === 429 || outcome.status >= 500;
      if (retryable && attempt < retries) {
        attempt++;
        await sleep(500 * 2 ** (attempt - 1));
        continue;
      }
      return outcome;
    }
  }

  async authenticate(): Promise<void> {
    if (this.sessionCookie) {
      this.log.push("auth: session cookie provided");
    } else if (!this.token && this.args.username && this.args.password) {
      const res = await this.request("/api/v1/security/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: this.args.username,
          password: this.args.password,
          provider: this.args.provider,
          refresh: true,
        }),
      });
      const access = res.json?.access_token;
      if (res.status !== 200 || typeof access !== "string" || !access) {
        throw new Error(`login failed: HTTP ${res.status} ${res.text.slice(0, 200)}`);
      }
      this.token = access;
      this.log.push("auth: login ok, bearer token acquired");
    } else if (this.token) {
      this.log.push("auth: bearer token provided");
    } else {
      throw new Error(
        "no credentials: pass --session (browser cookie), --token, or --username/--password; " +
          "or run in --dry-run mode",
      );
    }

    if (!this.csrf) {
      const res = await this.request("/api/v1/security/csrf_token/");
      const value = res.json?.result;
      if (res.status === 200 && typeof value === "string" && value) {
        this.csrf = value;
        this.log.push("csrf: fetched");
      } else {
        this.log.push(`csrf: unavailable (HTTP ${res.status}); continuing without it (chart/data worked without CSRF in the sampled session)`);
      }
    } else {
      this.log.push("csrf: provided");
    }
  }

  /** Read-only: chart metadata including `query_context` (GET /api/v1/chart/{id}). */
  async getChart(chartId: number): Promise<Json> {
    const res = await this.request(`/api/v1/chart/${chartId}`);
    if (res.status !== 200) {
      throw new Error(`GET /api/v1/chart/${chartId} -> HTTP ${res.status}: ${res.text.slice(0, 200)}`);
    }
    return res.json;
  }

  async postChartData(plan: RequestPlan): Promise<HttpResponse> {
    const { body, ...rest } = plan;
    void rest;
    return this.request(new URL(plan.url).pathname + new URL(plan.url).search, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: this.args.baseUrl, Referer: `${this.args.baseUrl}/superset/dashboard/services_lite/` },
      body: JSON.stringify(body),
    });
  }

  async getAsyncResult(key: string): Promise<HttpResponse> {
    return this.request(`/api/v1/chart/data/${key}`);
  }
}

function extractAsyncKey(text: string, json: Json | null): string | null {
  const byPattern = text.match(/qc-[A-Za-z0-9_-]{6,}/);
  if (byPattern) return byPattern[0];

  const seen = new Set<Json>();
  const stack: Json[] = [json];
  while (stack.length) {
    const node = stack.pop();
    if (node == null || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);
    for (const key of ["key", "query_id", "result_key", "cache_key", "id"]) {
      const v = (node as Json)[key];
      if (typeof v === "string" && /^qc-/.test(v)) return v;
    }
    for (const value of Object.values(node as Json)) {
      if (value && typeof value === "object") stack.push(value);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// validation
// ---------------------------------------------------------------------------

interface ValidationOutcome {
  ok: boolean;
  rowCount: number | null;
  colnames: string[];
  problems: string[];
  warnings: string[];
}

function validateChartResponse(
  json: Json | null,
  expectedColumns: string[],
  label: string,
  expectedQueries = 1,
): ValidationOutcome {
  const problems: string[] = [];
  const warnings: string[] = [];
  if (json == null || typeof json !== "object") {
    return { ok: false, rowCount: null, colnames: [], problems: [`${label}: response is not JSON`], warnings };
  }
  if (Array.isArray(json.errors) && json.errors.length > 0) {
    problems.push(`${label}: errors[] non-empty: ${JSON.stringify(json.errors).slice(0, 300)}`);
  }
  const result = json.result;
  if (!Array.isArray(result) || result.length === 0) {
    problems.push(`${label}: result[] missing or empty`);
    return { ok: false, rowCount: null, colnames: [], problems, warnings };
  }
  // strict correspondence: Superset mirrors queries[] order in result[]; a mismatch means we
  // cannot attribute metrics/dimensions to the right query, so it is an error, not a warning.
  if (result.length !== expectedQueries) {
    problems.push(`${label}: queries[]/result[] mismatch — sent ${expectedQueries} query(ies), got ${result.length} result(s)`);
  }
  let rowCount = 0;
  const colnames: string[] = [];
  for (const [i, item] of result.entries()) {
    if (item?.error != null && String(item.error) !== "") {
      problems.push(`${label}: result[${i}].error = ${String(item.error).slice(0, 200)}`);
    }    if (!Array.isArray(item?.colnames)) problems.push(`${label}: result[${i}].colnames missing`);
    else colnames.push(...item.colnames.map(String));
    const rc = numeric(item?.rowcount);
    if (rc == null) problems.push(`${label}: result[${i}].rowcount missing`);
    else rowCount += rc;
    const data = item?.data;
    if (!Array.isArray(data)) problems.push(`${label}: result[${i}].data missing`);
    else if (rc != null && data.length !== rc) problems.push(`${label}: result[${i}] rowcount=${rc} but data.length=${data.length}`);
  }
  // colname coverage is advisory: pivots/series/post_processing legitimately rename columns
  for (const expected of expectedColumns) {
    if (expected && !colnames.includes(expected)) warnings.push(`${label}: expected column "${expected}" not present in colnames`);
  }
  return { ok: problems.length === 0, rowCount, colnames, problems, warnings };
}

function expectedColumns(plan: RequestPlan): string[] {
  const q = plan.body?.queries?.[0] ?? {};
  if (q.is_timeseries === true || plan.vizType === "echarts_area") {
    // post_processing (pivot/rename/flatten) rewrites colnames: only the period column is stable.
    return [];
  }
  return [...new Set([...plan.metricNames, ...plan.dimensionColumns])];
}

/** Metrics declared by the request bodies/charts — seeds the aggregate header even in dry-run. */
function declaredMetrics(plans: RequestPlan[]): Map<string, MetricKind> {
  const declared = new Map<string, MetricKind>();
  for (const plan of plans) {
    for (const name of plan.metricNames) declared.set(name, metricKind(name));
    const q = queryOf(plan.body);
    if (q.is_timeseries === true && plan.metricNames.length === 0) declared.set(WEIGHT_METRIC, "additive");
  }
  return declared;
}

// ---------------------------------------------------------------------------
// observation extraction
// ---------------------------------------------------------------------------

export function extractObservations(
  plan: RequestPlan,
  json: Json,
): { observations: Observation[]; warnings: string[]; queryStats: QueryExtractionStat[]; queryCountMismatch: boolean } {
  const observations: Observation[] = [];
  const warnings: string[] = [];
  const queryStats: QueryExtractionStat[] = [];
  const metas = plan.queryMetas?.length ? plan.queryMetas : planMetas(plan.body);
  const results: Json[] = Array.isArray(json?.result) ? json.result : [];
  const queryCountMismatch = results.length !== metas.length;

  for (const [queryIndex, item] of results.entries()) {
    const meta = metas[queryIndex] ?? metas[0] ?? {
      metricNames: plan.metricNames,
      dimensionColumns: plan.dimensionColumns,
      temporalColumns: plan.temporalColumns,
      temporalChosen: plan.temporalColumns[0] ?? null,
      rowLimit: null,
      isTimeseries: false,
      postProcessing: false,
    };
    const queryWarnings: string[] = [];

    const seriesMetric = meta.metricNames[0] ?? WEIGHT_METRIC;
    const isSeries = meta.isTimeseries || plan.vizType === "echarts_area";
    const declaredMetricsSet = new Set(meta.metricNames);
    const declaredDimensions = new Set(meta.dimensionColumns);
    const temporalCandidates = meta.temporalColumns;

    const periodKeyOf = (row: Json, keys: string[]): string | null => {
      for (const candidate of [...temporalCandidates, "__timestamp", "date_supply", "date_update", "date"]) {
        if (keys.includes(candidate) && parsesAsDate(row[candidate])) return candidate;
      }
      for (const key of keys) {
        if (declaredMetricsSet.has(key)) continue;
        if (parsesAsDate(row[key])) return key;
      }
      return null;
    };

    const beforeCount = observations.length;
    for (const row of Array.isArray(item?.data) ? item.data : []) {
      if (row == null || typeof row !== "object") continue;
      const keys = Object.keys(row);
      const periodKey = periodKeyOf(row, keys);
      const date = periodKey ? toDateKey(row[periodKey]) : "";
      const rowWeight = numeric(row[WEIGHT_METRIC]) ?? undefined;

      if (isSeries) {
        for (const key of keys) {
          if (key === periodKey) continue;
          const value = numeric(row[key]);
          if (value == null) {
            if (row[key] != null) queryWarnings.push(`${plan.sliceId}: non-numeric series cell in column "${key}"`);
            continue;
          }
          observations.push({
            date,
            sliceId: plan.sliceId,
            datasourceId: plan.datasourceId,
            vizType: plan.vizType,
            dimension1: isPersonIdKey(key) ? PERSON_ID_PLACEHOLDER : key,
            dimension2: "",
            metric: seriesMetric,
            kind: "additive",
            value,
            weight: rowWeight,
            queryIndex,
          });
        }
        continue;
      }

      const declaredPresent = meta.metricNames.filter((m) => keys.includes(m));
      const metricKeys = declaredPresent.length
        ? declaredPresent
        : keys.filter((k) => k !== periodKey && METRIC_RE.test(k) && !declaredDimensions.has(k));
      const dimensionKeys = keys.filter(
        (k) => k !== periodKey && !metricKeys.includes(k) && (declaredDimensions.has(k) || !METRIC_RE.test(k)),
      );
      // a dimension that IS a personnel identifier keeps its meaning but never its value
      const dimValue = (key: string | undefined): string => {
        if (!key) return "";
        const raw = row[key];
        if (raw === null || raw === undefined || raw === "") return "";
        return isPersonIdKey(key) ? PERSON_ID_PLACEHOLDER : String(raw);
      };

      for (const metric of metricKeys) {
        const value = numeric(row[metric]);
        if (value == null) {
          if (row[metric] != null) queryWarnings.push(`${plan.sliceId}: non-numeric value in metric column "${metric}"`);
          continue;
        }
        observations.push({
          date,
          sliceId: plan.sliceId,
          datasourceId: plan.datasourceId,
          vizType: plan.vizType,
          dimension1: dimValue(dimensionKeys[0]),
          dimension2: dimValue(dimensionKeys[1]),
          metric,
          kind: metricKind(metric),
          value,
          weight: rowWeight,
          queryIndex,
        });
      }
    }

    const colnames = Array.isArray(item?.colnames) ? item.colnames.map(String) : [];
    // column names are only checkable when the response keeps the query shape:
    // pivots/series with post_processing turn metric and dimension values into column names by design.
    const shapeCheckable = !isSeries && !meta.postProcessing;
    const missingMetrics = shapeCheckable ? meta.metricNames.filter((m) => !colnames.includes(m)) : [];
    const missingDimensions = shapeCheckable
      ? meta.dimensionColumns.filter((d) => d !== meta.temporalChosen && !colnames.includes(d))
      : [];
    const rowLimit = meta.rowLimit;
    const rowCount = Array.isArray(item?.data) ? item.data.length : 0;
    queryStats.push({
      query_index: queryIndex,
      row_count: rowCount,
      observations: observations.length - beforeCount,
      metric_names: meta.metricNames,
      dimension_columns: meta.dimensionColumns,
      temporal_chosen: meta.temporalChosen,
      temporal_candidates: meta.temporalColumns,
      missing_metrics: missingMetrics,
      missing_dimensions: missingDimensions,
      row_limit: rowLimit,
      truncated: rowLimit != null && rowLimit > 0 && rowCount >= rowLimit,
      colnames,
      duplicate_rows: countDuplicateRows(Array.isArray(item?.data) ? item.data : []),
      warnings: [...new Set(queryWarnings)],
    });
    warnings.push(...queryWarnings);
  }

  return { observations, warnings: [...new Set(warnings)], queryStats, queryCountMismatch };
}

/** Number of fully duplicated rows in a result set (identical values across all columns). */
export function countDuplicateRows(rows: Json[]): number {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const row of rows) {
    if (row == null || typeof row !== "object") continue;
    const key = JSON.stringify(Object.keys(row).sort().map((k) => [k, row[k]]));
    if (seen.has(key)) duplicates++;
    else seen.add(key);
  }
  return duplicates;
}

export interface QueryExtractionStat {
  query_index: number;
  row_count: number;
  observations: number;
  metric_names: string[];
  dimension_columns: string[];
  temporal_chosen: string | null;
  temporal_candidates: string[];
  missing_metrics: string[];
  /** declared dimensions absent from colnames (only for non-pivot/non-series responses) */
  missing_dimensions: string[];
  row_limit: number | null;
  truncated: boolean;
  colnames: string[];
  duplicate_rows: number;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// data quality
// ---------------------------------------------------------------------------

export type Completeness = "full" | "partial" | "truncated" | "none";

export interface QualitySummary {
  chart_id: number | null;
  slice_id: number | null;
  datasource_id: number | null;
  source: "har" | "chart";
  viz_type: string;
  queries: number;
  applied_filters: Array<{ query_index: number; col: string | null; op: string | null; val: unknown }>;
  time_range: string | null;
  row_limit: number | null;
  row_count: number | null;
  metrics: string[];
  dimensions: string[];
  missing_metrics: string[];
  missing_dimensions: string[];
  query_count_mismatch: boolean;
  truncated_queries: number[];
  duplicate_rows: number;
  aggregation_method: string;
  ratio_weighting: "weighted" | "unweighted" | "mixed" | "none";
  unweighted_metrics: string[];
  http_status: number | null;
  mode: string;
  completeness: Completeness;
  completeness_reason: string;
  warnings: string[];
  problems: string[];
}

export interface QualityInput {
  plan: RequestPlan;
  status: number | null;
  mode: string;
  rowCount: number | null;
  problems: string[];
  warnings: string[];
  queryStats: QueryExtractionStat[];
  observations: Observation[];
  ratioWeightedMetrics: string[];
  ratioUnweightedMetrics: string[];
  timeRange: string;
  /** queries[]/result[] length mismatch detected by validation (or by extraction) */
  queryCountMismatch?: boolean;
}

/**
 * Quality gate for one extraction. A result is never "full" when something is missing:
 * empty rows, missing metrics, truncation at row_limit or extraction warnings all downgrade it.
 */
export function assessQuality(input: QualityInput): QualitySummary {
  const queries: Json[] = Array.isArray(input.plan.body?.queries) ? input.plan.body.queries : [];
  const filters = queries.flatMap((q: Json, queryIndex: number) =>
    (Array.isArray(q.filters) ? q.filters : []).map((f: Json) => ({
      query_index: queryIndex,
      col: filterCol(f),
      op: filterOp(f),
      val: filterVal(f),
    })),
  );
  const missing = [...new Set(input.queryStats.flatMap((s) => s.missing_metrics))];
  const missingDimensions = [...new Set(input.queryStats.flatMap((s) => s.missing_dimensions ?? []))];
  const duplicates = input.queryStats.reduce((sum, s) => sum + s.duplicate_rows, 0);
  // per-query limits: the first query's row_limit must not mask a truncation in a sibling query
  const rowLimits = (input.queryStats.length ? input.queryStats.map((s) => s.row_limit) : input.plan.queryMetas.map((m) => m.rowLimit))
    .filter((v): v is number => v != null && v > 0);
  const rowLimit = rowLimits.length ? Math.min(...rowLimits) : (numeric(queries[0]?.row_limit) ?? null);
  const truncatedQueries = input.queryStats.filter((s) => s.truncated).map((s) => s.query_index);
  const rowCount = input.rowCount;
  const queryCountMismatch = input.queryCountMismatch ?? false;

  const weighted = input.ratioWeightedMetrics.length;
  const unweighted = input.ratioUnweightedMetrics.length;
  const ratioWeighting: QualitySummary["ratio_weighting"] =
    weighted && unweighted ? "mixed" : weighted ? "weighted" : unweighted ? "unweighted" : "none";

  const method: string[] = ["superset_chart_data"];
  if (input.queryStats.some((s) => (input.plan.queryMetas[s.query_index]?.postProcessing ?? false))) {
    method.push("post_processing(pivot/rename/flatten)");
  }
  method.push("client:additive_sum");
  if (weighted || unweighted) method.push(`client:ratio_${ratioWeighting}_mean`);

  const reasons: string[] = [];
  let completeness: Completeness = "full";

  if (input.mode === "dry-run") {
    completeness = "none";
    reasons.push("dry-run: no request was issued");
  } else if (input.mode === "error") {
    completeness = "none";
    reasons.push("request failed or was refused");
  } else if (rowCount == null || rowCount === 0) {
    completeness = "partial";
    reasons.push("empty result set");
  } else {
    if (missing.length) {
      completeness = "partial";
      reasons.push(`declared metrics absent from colnames: ${missing.join(", ")}`);
    }
    if (missingDimensions.length) {
      completeness = "partial";
      reasons.push(`declared dimensions absent from colnames: ${missingDimensions.join(", ")}`);
    }
    if (queryCountMismatch) {
      completeness = "partial";
      reasons.push("queries[]/result[] count mismatch: metrics cannot be attributed to a query");
    }
    if (truncatedQueries.length) {
      completeness = "truncated";
      reasons.push(`query(ies) ${truncatedQueries.join(", ")} reached their row_limit`);
    }
    if (duplicates > 0) {
      if (completeness !== "truncated") completeness = "partial";
      reasons.push(`${duplicates} duplicated row(s) in the response`);
    }
    if (input.warnings.length) {
      if (completeness === "full") completeness = "partial";
      reasons.push(`${input.warnings.length} extraction/advisory warning(s)`);
    }
  }
  if (input.problems.length) {
    completeness = "none";
    reasons.push(...input.problems);
  }
  if (!reasons.length) reasons.push("all declared metrics and dimensions present, below row_limit");

  return {
    chart_id: input.plan.chartId,
    slice_id: input.plan.sliceId,
    datasource_id: input.plan.datasourceId,
    source: input.plan.source,
    viz_type: input.plan.vizType,
    queries: input.plan.queryMetas.length,
    applied_filters: filters,
    time_range: input.timeRange || null,
    row_limit: rowLimit,
    row_count: rowCount,
    metrics: [...new Set(input.plan.queryMetas.flatMap((m) => m.metricNames))],
    dimensions: [...new Set(input.plan.queryMetas.flatMap((m) => m.dimensionColumns))],
    missing_metrics: missing,
    missing_dimensions: missingDimensions,
    query_count_mismatch: queryCountMismatch,
    truncated_queries: truncatedQueries,
    duplicate_rows: duplicates,
    aggregation_method: method.join(" + "),
    ratio_weighting: ratioWeighting,
    unweighted_metrics: [...new Set(input.ratioUnweightedMetrics)],
    http_status: input.status,
    mode: input.mode,
    completeness,
    completeness_reason: reasons.join("; "),
    warnings: [...new Set(input.warnings)].slice(0, 50),
    problems: [...new Set(input.problems)].slice(0, 50),
  };
}

// ---------------------------------------------------------------------------
// aggregation
// ---------------------------------------------------------------------------

function newGroup(
  date: string,
  sliceId: number | null,
  datasourceId: number | null,
  vizType: string,
  d1: string,
  d2: string,
): GroupAcc {
  return {
    date,
    sliceId,
    datasourceId,
    vizType,
    dimension1: d1,
    dimension2: d2,
    rows: 0,
    seen: new Set<string>(),
    additive: new Map(),
    ratioWsum: new Map(),
    ratioW: new Map(),
    ratioPlain: new Map(),
    ratioRows: new Map(),
    ratioRowsWithWeight: new Map(),
  };
}

function bump(map: Map<string, number>, key: string, delta: number): void {
  map.set(key, (map.get(key) ?? 0) + delta);
}

export interface AggregateResult {
  metricKinds: Record<string, MetricKind>;
  additiveMetrics: string[];
  ratioMetrics: string[];
  rows: Array<Record<string, string | number>>;
}

export function aggregate(observations: Observation[], declared: Map<string, MetricKind>): AggregateResult {
  const groups = new Map<string, GroupAcc>();
  const metricKindsMap = new Map<string, MetricKind>(declared);
  // unambiguous composite keys: dimension values may themselves contain "|" or "-",
  // and two datasources must never merge into one group
  const rowKey = (o: Observation): string => JSON.stringify([o.date, o.datasourceId, o.sliceId, o.dimension1, o.dimension2]);

  // weights per (date, slice, dimensions) so a ratio row can find its denominator
  const weightByRow = new Map<string, number>();
  for (const o of observations) {
    if (o.metric !== WEIGHT_METRIC) continue;
    weightByRow.set(rowKey(o), o.value);
  }

  for (const o of observations) {
    metricKindsMap.set(o.metric, o.kind);
    const key = rowKey(o);
    let group = groups.get(key);
    if (!group) {
      group = newGroup(o.date, o.sliceId, o.datasourceId, o.vizType, o.dimension1, o.dimension2);
      groups.set(key, group);
    }
    group.rows++;
    group.seen.add(o.metric);
    if (o.kind === "additive") {
      bump(group.additive, o.metric, o.value);
    } else {
      bump(group.ratioPlain, o.metric, o.value);
      bump(group.ratioRows, o.metric, 1);
      const weight = o.weight ?? weightByRow.get(key);
      if (weight != null && Number.isFinite(weight)) {
        bump(group.ratioWsum, o.metric, o.value * weight);
        bump(group.ratioW, o.metric, weight);
        bump(group.ratioRowsWithWeight, o.metric, 1);
      }
    }
  }

  const additiveMetrics = [...metricKindsMap.entries()].filter(([, k]) => k === "additive").map(([m]) => m).sort();
  const ratioMetrics = [...metricKindsMap.entries()].filter(([, k]) => k === "ratio").map(([m]) => m).sort();

  // collapse groups by (date, slice) across dimensions
  const collapsed = new Map<string, GroupAcc>();
  for (const group of groups.values()) {
    const key = JSON.stringify([group.date, group.datasourceId, group.sliceId]);
    let target = collapsed.get(key);
    if (!target) {
      target = newGroup(group.date, group.sliceId, group.datasourceId, group.vizType, "__ALL__", "");
      collapsed.set(key, target);
    }
    target.rows += group.rows;
    for (const m of group.seen) target.seen.add(m);
    for (const [m, v] of group.additive) bump(target.additive, m, v);
    for (const [m, v] of group.ratioWsum) bump(target.ratioWsum, m, v);
    for (const [m, v] of group.ratioW) bump(target.ratioW, m, v);
    for (const [m, v] of group.ratioPlain) bump(target.ratioPlain, m, v);
    for (const [m, v] of group.ratioRows) bump(target.ratioRows, m, v);
    for (const [m, v] of group.ratioRowsWithWeight) bump(target.ratioRowsWithWeight, m, v);
  }

  const orderedGroups = [...groups.values(), ...collapsed.values()].filter((g) => g.rows > 0);
  orderedGroups.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (String(a.sliceId) !== String(b.sliceId)) return String(a.sliceId) < String(b.sliceId) ? -1 : 1;
    if (a.dimension1 !== b.dimension1) return a.dimension1 < b.dimension1 ? -1 : 1;
    return a.dimension2 < b.dimension2 ? -1 : a.dimension2 > b.dimension2 ? 1 : 0;
  });

  const rows: Array<Record<string, string | number>> = [];
  const seen = new Set<string>();
  for (const g of orderedGroups) {
    const isTotal = g.date === "";
    const date = isTotal ? "__TOTAL__" : g.date;
    const dimension1 = isTotal && g.dimension1 === "" ? "__ALL__" : g.dimension1;
    const dedupeKey = JSON.stringify([date, g.datasourceId, g.sliceId, dimension1, g.dimension2]);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const row: Record<string, string | number> = {
      date,
      slice_id: g.sliceId ?? "",
      dataset_id: g.datasourceId ?? "",
      viz_type: g.vizType,
      dimension_1: dimension1,
      dimension_2: g.dimension2,
      source_rows: g.rows,
    };
    for (const m of additiveMetrics) row[m] = g.seen.has(m) ? g.additive.get(m) ?? 0 : "";
    let weighting = "";
    for (const m of ratioMetrics) {
      if (!g.seen.has(m)) continue;
      const wsum = g.ratioWsum.get(m) ?? 0;
      const w = g.ratioW.get(m) ?? 0;
      const n = g.ratioRows.get(m) ?? 0;
      const nw = g.ratioRowsWithWeight.get(m) ?? 0;
      if (n > 0 && nw === n && w > 0) {
        row[m] = wsum / w;
        weighting = `weighted:${WEIGHT_METRIC}`;
      } else if (n > 0) {
        row[m] = (g.ratioPlain.get(m) ?? 0) / n;
        weighting = "unweighted";
      }
    }
    row.ratio_weighting = weighting;
    rows.push(row);
  }

  return {
    metricKinds: Object.fromEntries(metricKindsMap),
    additiveMetrics,
    ratioMetrics,
    rows,
  };
}

// ---------------------------------------------------------------------------
// pipeline
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`[ERROR] ${String(error)}`);
    console.error(usage());
    return 2;
  }

  if (args.help) {
    console.log(usage());
    return 0;
  }

  return runPipeline(args);
}

/** Full pipeline, reusable from tests. */
export async function runPipeline(args: CliArgs): Promise<number> {
  const period = resolveTimeRange(args);
  const outDir = resolve(args.outDir);
  await mkdir(outDir, { recursive: true });

  const live = args.live && args.confirm;

  let client: ReadOnlySuperset | null = null;
  if (live) {
    console.log(`[live] endpoint: POST ${args.baseUrl}/api/v1/chart/data`);
    client = new ReadOnlySuperset(args);
    try {
      await client.authenticate();
    } catch (error) {
      console.error(`[ERROR] ${String(error)}`);
      return 2;
    }
    for (const line of client.log) console.log(`[auth] ${line}`);
  }

  // chart mode: fetch chart metadata (query_context) before building requests
  const chartDetails = new Map<number, Json>();
  if (args.fromCharts.length && !args.offlineCharts) {
    if (!client) {
      console.error("[ERROR] --from-chart without --offline requires --live --yes");
      return 2;
    }
    for (const id of args.fromCharts) {
      try {
        const detail = await client.getChart(id);
        chartDetails.set(id, detail);
        const r = detail?.result ?? {};
        console.log(`[chart] ${id}: "${piiSafe(String(r?.slice_name ?? "?"), args)}" viz=${r?.viz_type ?? "?"} ds=${r?.datasource_id ?? "?"}`);
      } catch (error) {
        console.error(`[ERROR] chart ${id}: ${String(error)}`);
        return 2;
      }
    }
  }

  const { plans, reports } = await loadPlans(args, period, chartDetails);
  const declared = declaredMetrics(plans);

  const results: RequestResult[] = [];
  const allObservations: Observation[] = [];
  const warnings: string[] = [];
  const expectedBySlice: Record<string, string[]> = {};
  const qualityByPlan = new Map<number, QualitySummary>();
  let freshness: Record<string, unknown> | null = null;

  if (live) {
    console.log(`[live] requests: ${plans.length}, period: ${period.expression}, shopno: ${args.shopno}`);
  } else {
    console.log(
      args.live
        ? "[mode] --live without --yes: refusing to send requests; writing the plan only (exit 3)"
        : "[mode] dry-run: no network calls; pass --live --yes to fetch",
    );
  }

  for (const [i, plan] of plans.entries()) {
    const report = reports[i]!;
    const label = `${plan.source === "chart" ? `chart ${plan.chartId}` : `slice ${plan.sliceId}`} (${basename(plan.file)})`;
    const stem = plan.source === "chart" ? `chart_${plan.chartId}` : `${String(plan.n).padStart(3, "0")}_slice_${plan.sliceId ?? "unknown"}`;
    const requestFile = join(outDir, `${stem}.request.json`);
    const serializedBody = JSON.stringify(plan.body, null, 2);
    // the copy on disk is PII-safe by default; the request actually sent uses plan.body in memory
    await writeText(requestFile, args.rawArtifacts ? `${serializedBody}\n` : artifactJson(plan.body, args).text);
    expectedBySlice[String(plan.sliceId)] = expectedColumns(plan);

    console.log(
      `[plan] ${label}: queries=${report.queries} time_range="${period.expression}" ` +
        `date_col+=${report.datesupplyAdded} temporal=${report.temporalRewrites} ` +
        `row_limit_raised=${report.rowLimitRaised} shopno_rewrites=${report.shopnoRewrites} shopno_injected=${report.shopnoInjected} ` +
        `overrides=${report.semanticOverrides.length}${report.shopnoExcluded ? " SHOPNO_EXCLUDED" : ""}`,
    );
    if (report.semanticOverrides.length) warnings.push(`${label}: semantic overrides applied: ${report.semanticOverrides.join("; ")}`);
    if (report.temporalAmbiguity.length) {
      warnings.push(
        `${label}: temporal grain ambiguity — chosen "${plan.queryMetas[0]?.temporalChosen ?? "?"}" is not a dimension; ` +
          `chart groups by ${report.temporalAmbiguity.join(", ")}; the extra temporal column was NOT added`,
      );
    }
    const result: RequestResult = {
      n: plan.n,
      file: plan.source === "chart" ? `chart:${plan.chartId}` : basename(plan.file),
      sliceId: plan.sliceId,
      url: plan.url,
      status: null,
      mode: live ? "error" : "dry-run",
      pollKey: null,
      attempts: 0,
      rowCount: null,
      colnames: [],
      problems: [],
      requestSha256: sha256(serializedBody),
      responseSha256: null,
      responseFile: null,
    };

    // refusal: never silently change the chart's semantics when it excludes the target darkstore
    if (report.shopnoExcluded && !args.forceShopno) {
      result.mode = "error";
      result.problems.push(
        `${label}: SHOPNO_EXCLUDED — the chart filters shopno NOT IN ${JSON.stringify(scanShopno(plan.body).excludeValues)} ` +
          `which excludes ${args.shopno}; pass --force-shopno to override`,
      );
      results.push(result);
      qualityByPlan.set(
        i,
        assessQuality({
          plan,
          status: null,
          mode: "error",
          rowCount: null,
          problems: result.problems,
          warnings: [],
          queryStats: [],
          observations: [],
          ratioWeightedMetrics: [],
          ratioUnweightedMetrics: [],
          timeRange: period.expression,
        }),
      );
      console.error(`[REFUSED] ${label}: shopno ${args.shopno} is excluded by the chart (NOT IN)`);
      continue;
    }

    // refusal: in chart mode no query may run without a shopno constraint (unbounded cross-store scan).
    // transformBody has already injected the filter when allowed; anything still unfiltered means
    // injection was disabled (--no-inject-shopno) while the chart itself does not filter shopno.
    if (plan.source === "chart" && plan.sliceId !== FRESHNESS_SLICE) {
      const unconstrained = (Array.isArray(plan.body?.queries) ? plan.body.queries : [])
        .map((q: Json, idx: number) => (hasShopnoFilter(q) ? null : idx))
        .filter((idx: number | null): idx is number => idx != null);
      if (unconstrained.length) {
        result.mode = "error";
        result.problems.push(
          `${label}: SHOPNO_UNCONSTRAINED — queries [${unconstrained.join(", ")}] have no positive shopno IN/= restriction; ` +
            `chart mode never runs a query that spans all darkstores. Enable --inject-shopno or filter the chart.`,
        );
        results.push(result);
        qualityByPlan.set(
          i,
          assessQuality({
            plan,
            status: null,
            mode: "error",
            rowCount: null,
            problems: result.problems,
            warnings: [],
            queryStats: [],
            observations: [],
            ratioWeightedMetrics: [],
            ratioUnweightedMetrics: [],
            timeRange: period.expression,
          }),
        );
        console.error(`[REFUSED] ${label}: ${unconstrained.length} query(ies) without a shopno filter`);
        continue;
      }
    }

    if (!live || !client) {
      results.push(result);
      continue;
    }

    try {
      let response = await client.postChartData(plan);
      result.status = response.status;
      result.attempts++;

      if (response.status === 202) {
        const key = extractAsyncKey(response.text, response.json);
        if (!key) {
          result.mode = "error";
          result.problems.push(`${label}: HTTP 202 without an async result key in the body`);
          results.push(result);
          continue;
        }
        result.pollKey = key;
        result.mode = "202+poll";
        const deadline = Date.now() + args.pollTimeoutMs;
        let polled: HttpResponse | null = null;
        while (Date.now() < deadline) {
          polled = await client.getAsyncResult(key);
          if (polled.status === 200) break;
          if (polled.status !== 202) {
            result.problems.push(`${label}: polling ${key} returned HTTP ${polled.status}`);
            break;
          }
          await sleep(1000);
        }
        if (!polled || polled.status !== 200) {
          result.mode = "error";
          result.problems.push(`${label}: async result ${key} not ready within ${args.pollTimeoutMs} ms`);
          results.push(result);
          continue;
        }
        response = polled;
      } else if (response.status === 200) {
        result.mode = "200";
      } else {
        result.mode = "error";
        result.problems.push(`${label}: HTTP ${response.status}: ${response.text.slice(0, 300)}`);
        results.push(result);
        continue;
      }

      const responseFile = join(outDir, `${stem}.response.json`);
      await writeText(responseFile, artifactJson(response.json ?? { raw_text: response.text }, args).text);
      result.responseFile = basename(responseFile);
      result.responseSha256 = sha256(response.text);

      const validation = validateChartResponse(
        response.json,
        expectedBySlice[String(plan.sliceId)] ?? [],
        label,
        plan.queryMetas.length || 1,
      );
      result.rowCount = validation.rowCount;
      result.colnames = [...new Set(validation.colnames)];
      result.problems.push(...validation.problems);
      warnings.push(...validation.warnings);

      const { observations, warnings: extractWarnings, queryStats, queryCountMismatch } = extractObservations(plan, response.json ?? {});
      allObservations.push(...observations);
      warnings.push(...extractWarnings);

      const ratioMetrics = [...new Set(observations.filter((o) => o.kind === "ratio").map((o) => o.metric))];
      const ratioWeightedMetrics = ratioMetrics.filter((m) =>
        observations.filter((o) => o.metric === m).every((o) => o.weight != null),
      );
      const ratioUnweightedMetrics = ratioMetrics.filter((m) => !ratioWeightedMetrics.includes(m));

      qualityByPlan.set(
        i,
        assessQuality({
          plan,
          status: result.status,
          mode: result.mode,
          rowCount: result.rowCount,
          problems: result.problems,
          warnings: [...validation.warnings, ...extractWarnings],
          queryStats,
          observations,
          ratioWeightedMetrics,
          ratioUnweightedMetrics,
          timeRange: period.expression,
          queryCountMismatch,
        }),
      );
      console.log(
        `[quality] ${label}: completeness=${qualityByPlan.get(i)!.completeness} row_count=${result.rowCount ?? "?"} ` +
          `missing_metrics=${qualityByPlan.get(i)!.missing_metrics.length} duplicates=${qualityByPlan.get(i)!.duplicate_rows} ` +
          `weighting=${qualityByPlan.get(i)!.ratio_weighting}`,
      );

      if (plan.sliceId === FRESHNESS_SLICE && Array.isArray(response.json?.result)) {
        const first = response.json.result[0]?.data?.[0];
        if (first && typeof first === "object") {
          freshness = {
            slice_id: plan.sliceId,
            date_update: (first as Json).date_update ?? null,
            colnames: response.json.result[0]?.colnames ?? [],
          };
        }
      }
      console.log(`[ok] ${label}: HTTP ${result.status} (${result.mode}), rows=${result.rowCount ?? "?"}, observations=${observations.length}`);
    } catch (error) {
      result.mode = "error";
      result.problems.push(`${label}: ${String(error)}`);
      console.error(`[ERROR] ${label}: ${String(error)}`);
    }

    results.push(result);
  }

  // quality summaries for every plan, including the ones that failed before extraction
  for (const [i, plan] of plans.entries()) {
    if (qualityByPlan.has(i)) continue;
    const r = results.find((x) => x.n === plan.n);
    qualityByPlan.set(
      i,
      assessQuality({
        plan,
        status: r?.status ?? null,
        mode: r?.mode ?? "error",
        rowCount: r?.rowCount ?? null,
        problems: r?.problems ?? [],
        warnings: [],
        queryStats: [],
        observations: [],
        ratioWeightedMetrics: [],
        ratioUnweightedMetrics: [],
        timeRange: period.expression,
      }),
    );
  }
  const qualitySummaries = [...qualityByPlan.entries()].sort((a, b) => a[0] - b[0]).map(([, q]) => q);

  const aggregateResult = aggregate(allObservations, declared);

  const longHeader = [
    "date",
    "slice_id",
    "dataset_id",
    "viz_type",
    "dimension_1",
    "dimension_2",
    "metric",
    "metric_kind",
    "value",
  ];
  const longRows = allObservations
    .slice()
    .sort((a, b) => (a.date === b.date ? a.metric.localeCompare(b.metric) : a.date < b.date ? -1 : 1))
    .map((o) => [o.date, o.sliceId, o.datasourceId, o.vizType, o.dimension1, o.dimension2, o.metric, o.kind, fmtNumber(o.value)])
    .map((row) => row.map((cell, index) => piiSafeCell(longHeader[index] ?? "", cell, args)));
  await writeText(join(outDir, "observations_7745.csv"), toCsv(longHeader, longRows));

  const aggregateHeader = [
    "date",
    "slice_id",
    "dataset_id",
    "viz_type",
    "dimension_1",
    "dimension_2",
    "source_rows",
    ...aggregateResult.additiveMetrics,
    ...aggregateResult.ratioMetrics,
    "ratio_weighting",
  ];
  const aggregateRows = aggregateResult.rows.map((row) => aggregateHeader.map((h) => piiSafeCell(h, row[h] ?? "", args)));
  await writeText(join(outDir, "aggregate_7745.csv"), toCsv(aggregateHeader, aggregateRows));

  const notes: string[] = [];
  if (aggregateResult.ratioMetrics.length > 0) {
    notes.push(
      `Доли (${aggregateResult.ratioMetrics.join(", ")}) агрегируются как взвешенное среднее с весом ${WEIGHT_METRIC} ` +
        `(общий знаменатель этих метрик). Если у строки нет веса — используется невзвешенное среднее (см. колонку ratio_weighting).`,
    );
  }
  if (aggregateResult.ratioMetrics.includes("share_orders_delivered")) {
    notes.push(
      "share_orders_delivered в этих запросах вырождается: фильтр feature_tt IN ('ДаркСтор') уже ограничивает выборку.",
    );
  }
  notes.push("sum_with_bonuses / sum_without_bonuses: verbose_name противоречит выражению метрики; доверять SQL-выражению.");
  notes.push(
    "Границы окна: Superset трактует конец интервала как исключающую границу суток — при --to 2026-11-23 последний день в данных 2026-11-22. " +
      "Чтобы включить сегодняшний день, задайте --to = завтра.",
  );

  const qualityDates = [...new Set(allObservations.map((o) => o.date).filter((d) => d && d !== "__TOTAL__"))].sort();
  const allZeroMetrics = [...new Set(allObservations.map((o) => o.metric))]
    .filter((m) => !allObservations.some((o) => o.metric === m && o.value !== 0))
    .sort();
  if (allZeroMetrics.length) {
    notes.push(`Метрики, у которых все значения = 0: ${allZeroMetrics.join(", ")} — проверить применимость фильтров/периода.`);
  }
  const quality = {
    days: qualityDates.length,
    date_min: qualityDates[0] ?? null,
    date_max: qualityDates[qualityDates.length - 1] ?? null,
    all_zero_metrics: allZeroMetrics,
  };

  const completenessCounts: Record<Completeness, number> = { full: 0, partial: 0, truncated: 0, none: 0 };
  for (const q of qualitySummaries) completenessCounts[q.completeness]++;
  const completenessIds = (c: Completeness) => qualitySummaries.filter((q) => q.completeness === c).map((q) => q.chart_id ?? q.slice_id);

  const manifest = {
    generated_at: nowIso(),
    mode: live ? "live" : "dry-run",
    live_requested: args.live,
    live_confirmed: live,
    base_url: args.baseUrl,
    shopno: args.shopno,
    dashboard_id: 977,
    period: { from: period.from, to: period.to, time_range: period.expression, weeks: args.weeks, timezone: MSK },
    sources: plans.map((p) => ({
      n: p.n,
      source: p.source,
      chart_id: p.chartId,
      chart_name: p.chartName,
      file: p.file,
      slice_id: p.sliceId,
      datasource_id: p.datasourceId,
      viz_type: p.vizType,
      metric_names: p.metricNames,
      dimension_columns: p.dimensionColumns,
      temporal_columns: p.temporalColumns,
      temporal_chosen: p.queryMetas.map((m) => m.temporalChosen),
      queries: p.queryMetas.length,
      request_sha256: p.bodySha256,
    })),
    inject_shopno: args.injectShopno,
    artifacts_pii_masked: !args.rawArtifacts,
    transforms: reports,
    metric_kinds: aggregateResult.metricKinds,
    additive_metrics: aggregateResult.additiveMetrics,
    ratio_metrics: aggregateResult.ratioMetrics,
    ratio_weight_metric: WEIGHT_METRIC,
    data_freshness: freshness,
    quality,
    completeness: {
      counts: completenessCounts,
      full: completenessIds("full"),
      partial: completenessIds("partial"),
      truncated: completenessIds("truncated"),
      none: completenessIds("none"),
    },
    quality_per_request: qualitySummaries,
    observations: allObservations.length,
    aggregate_rows: aggregateResult.rows.length,
    requests: results,
    outputs: {
      requests_dir: outDir,
      observations_csv: "observations_7745.csv",
      aggregate_csv: "aggregate_7745.csv",
      validation_json: "validation.json",
      quality_json: "quality.json",
    },
    notes,
    warnings: [...new Set(warnings)].slice(0, 200),
  };

  const validation = {
    generated_at: nowIso(),
    mode: manifest.mode,
    summary: {
      requests: results.length,
      ok: results.filter((r) => r.mode === "200" || r.mode === "202+poll").length,
      failed: results.filter((r) => r.mode === "error").length,
      observations: allObservations.length,
      aggregate_rows: aggregateResult.rows.length,
      warnings: manifest.warnings.length,
    },
    expected_colnames_by_slice: expectedBySlice,
    requests: results.map((r) => ({
      n: r.n,
      file: r.file,
      slice_id: r.sliceId,
      status: r.status,
      mode: r.mode,
      poll_key: r.pollKey,
      rowcount: r.rowCount,
      colnames: r.colnames,
      problems: r.problems,
      response_file: r.responseFile,
      response_sha256: r.responseSha256,
    })),
  };

  const qualityReport = {
    generated_at: nowIso(),
    mode: manifest.mode,
    period: { time_range: period.expression, weeks: args.weeks, timezone: MSK },
    shopno: args.shopno,
    run: {
      requests: qualitySummaries.length,
      completeness: completenessCounts,
      full: completenessIds("full"),
      partial: completenessIds("partial"),
      truncated: completenessIds("truncated"),
      none: completenessIds("none"),
      duplicate_rows_total: qualitySummaries.reduce((s, q) => s + q.duplicate_rows, 0),
      missing_metrics_total: qualitySummaries.reduce((s, q) => s + q.missing_metrics.length, 0),
      ratio_weighting: {
        weighted: qualitySummaries.filter((q) => q.ratio_weighting === "weighted").map((q) => q.chart_id ?? q.slice_id),
        unweighted: qualitySummaries.filter((q) => q.ratio_weighting === "unweighted").map((q) => q.chart_id ?? q.slice_id),
        mixed: qualitySummaries.filter((q) => q.ratio_weighting === "mixed").map((q) => q.chart_id ?? q.slice_id),
      },
    },
    requests: qualitySummaries,
  };

  const manifestArtifact = artifactJson(manifest, args);
  const validationArtifact = artifactJson(validation, args);
  const qualityArtifact = artifactJson(qualityReport, args);
  await writeText(join(outDir, "manifest.json"), manifestArtifact.text);
  await writeText(join(outDir, "validation.json"), validationArtifact.text);
  await writeText(join(outDir, "quality.json"), qualityArtifact.text);
  if (!args.rawArtifacts) {
    const hits = manifestArtifact.hits + validationArtifact.hits + qualityArtifact.hits;
    console.log(`[pii] artifacts masked: ${hits} hit(s) in manifest/validation/quality (use --raw-artifacts to disable)`);
  }

  console.log("");
  console.log(`[summary] mode=${manifest.mode} period=${period.expression}`);
  console.log(`[summary] requests=${validation.summary.requests} ok=${validation.summary.ok} failed=${validation.summary.failed}`);
  console.log(`[summary] observations=${validation.summary.observations} aggregate_rows=${validation.summary.aggregate_rows}`);
  console.log(`[summary] completeness full=${completenessCounts.full} partial=${completenessCounts.partial} truncated=${completenessCounts.truncated} none=${completenessCounts.none}`);
  console.log(`[summary] additive=[${aggregateResult.additiveMetrics.join(", ")}]`);
  console.log(`[summary] ratio=[${aggregateResult.ratioMetrics.join(", ")}]`);
  console.log(`[summary] output: ${outDir}`);

  if (args.live && !args.confirm) {
    console.error("[blocked] --live requires --yes: no requests were sent.");
    return 3;
  }
  // a run is only successful when every extraction is complete
  if (live && (validation.summary.failed > 0 || completenessCounts.partial > 0 || completenessCounts.truncated > 0 || completenessCounts.none > 0)) {
    return 1;
  }
  return 0;
}

if (import.meta.main) {
  process.exitCode = await main();
}
