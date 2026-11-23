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
 *   live (--live)     — requires a session cookie, an access token or
 *                       username+password; see `--help`.
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
const RATIO_RE = /^share_/;
const METRIC_RE = /^(share_|qty_|sum_|avg_|count|min_|max_)/i;
const WEIGHT_METRIC = "qty_orders_delivered";
const MSK = "Europe/Moscow";

const ALLOWED_PATHS = [
  "/api/v1/security/login",
  "/api/v1/security/csrf_token/",
  "/api/v1/chart/data",
];
const ALLOWED_PREFIXES = ["/api/v1/chart/data/"];

// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

type Json = any;

export interface CliArgs {
  live: boolean;
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
  session: string;
  csrf: string;
  token: string;
  username: string;
  password: string;
  provider: string;
  files: number[];
  help: boolean;
}

interface RequestPlan {
  n: number;
  file: string;
  sliceId: number | null;
  datasourceId: number | null;
  vizType: string;
  body: Json;
  bodySha256: string;
  url: string;
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
}

interface GroupAcc {
  date: string;
  sliceId: number | null;
  datasourceId: number | null;
  vizType: string;
  dimension1: string;
  dimension2: string;
  rows: number;
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

function toDateKey(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number") return mskDate(new Date(value));
  const s = String(value);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) return mskDate(parsed);
  return "";
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

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage(): string {
  return `usage: bun tools/fetch-darkstore-aggregates.ts [options]

Modes
  --dry-run                 build and validate requests only, no network (default)
  --live                    send requests to Superset (requires auth)

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
  --keep-columns            do not add date_supply to queries[].columns

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
    session: Bun.env.SUPERSET_SESSION_COOKIE ?? "",
    csrf: Bun.env.SUPERSET_CSRF_TOKEN ?? "",
    token: Bun.env.SUPERSET_ACCESS_TOKEN ?? "",
    username: Bun.env.SUPERSET_USERNAME ?? "",
    password: Bun.env.SUPERSET_PASSWORD ?? "",
    provider: Bun.env.SUPERSET_PROVIDER ?? "db",
    files: [...DEFAULT_SLICE_FILES],
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v == null) throw new Error(`missing value for ${a}`);
      return v;
    };
    switch (a) {
      case "--live": args.live = true; break;
      case "--dry-run": args.live = false; break;
      case "--help": case "-h": args.help = true; break;
      case "--keep-columns": args.addDateSupply = false; break;
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
  if (!args.files.length) throw new Error("--files must list at least one body number");
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
    if (key === "filters" && Array.isArray(value)) {
      for (const f of value) if (f && typeof f === "object") visit(f);
    }
    walkFilters(value, visit);
  }
}

function rewriteShopno(body: Json, shopno: string): number {
  let rewrites = 0;
  walkFilters(body, (f) => {
    if (f.col === "shopno" && f.op === "IN") {
      if (JSON.stringify(f.val) !== JSON.stringify([shopno])) rewrites++;
      f.val = [shopno];
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
  timeRange: string;
}

export function transformBody(body: Json, args: CliArgs, period: { expression: string }): TransformReport {
  const report: TransformReport = {
    sliceId: body?.form_data?.slice_id ?? null,
    queries: Array.isArray(body?.queries) ? body.queries.length : 0,
    datesupplyAdded: 0,
    temporalRewrites: 0,
    rowLimitRaised: 0,
    shopnoRewrites: rewriteShopno(body, args.shopno),
    timeRange: period.expression,
  };

  const isFreshness = report.sliceId === FRESHNESS_SLICE;

  for (const q of Array.isArray(body?.queries) ? body.queries : []) {
    q.time_range = period.expression;
    q.granularity = q.granularity ?? "date_supply";

    if (!isFreshness) {
      q.extras = q.extras ?? {};
      q.extras.time_grain_sqla = "P1D";
      q.time_grain_sqla = "P1D";
    }

    if (Array.isArray(q.filters)) {
      for (const f of q.filters) {
        if (f?.col === "date_supply" && f?.op === "TEMPORAL_RANGE" && f.val !== period.expression) {
          f.val = period.expression;
          report.temporalRewrites++;
        }
      }
    }

    const isSeries = q.is_timeseries === true;
    if (args.addDateSupply && !isFreshness && !isSeries && Array.isArray(q.columns) && q.columns.length > 0) {
      if (!q.columns.includes("date_supply")) {
        q.columns.unshift("date_supply");
        report.datesupplyAdded++;
      }
    }

    if (!isFreshness && q.row_limit !== 0) {
      const limit = numeric(q.row_limit);
      if (limit == null || limit < args.rowLimit) {
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
        if (f?.subject === "date_supply" && f?.operator === "TEMPORAL_RANGE") f.comparator = period.expression;
      }
    }
    if (fd.extra_form_data && Array.isArray(fd.extra_form_data.filters)) {
      for (const f of fd.extra_form_data.filters) {
        if (f?.col === "date_supply" && f?.op === "TEMPORAL_RANGE") f.val = period.expression;
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

async function loadPlans(args: CliArgs, period: { expression: string }): Promise<{ plans: RequestPlan[]; reports: TransformReport[] }> {
  const plans: RequestPlan[] = [];
  const reports: TransformReport[] = [];

  for (const n of args.files) {
    const file = join(args.bodiesDir, `${String(n).padStart(3, "0")}_POST__api_v1_chart_data.request.json`);
    const raw = await Bun.file(file).text();
    const body = JSON.parse(raw);
    reports.push(transformBody(body, args, period));

    const serialized = JSON.stringify(body);
    const sliceId = body?.form_data?.slice_id ?? null;
    plans.push({
      n,
      file,
      sliceId,
      datasourceId: body?.datasource?.id ?? null,
      vizType: body?.form_data?.viz_type ?? "unknown",
      body,
      bodySha256: sha256(serialized),
      url:
        `${args.baseUrl}/api/v1/chart/data?form_data=` +
        encodeURIComponent(JSON.stringify({ slice_id: sliceId })) +
        `&dashboard_id=${body?.form_data?.dashboardId ?? 977}`,
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

function assertAllowed(path: string): void {
  const clean = path.split("?")[0] ?? path;
  if (ALLOWED_PATHS.includes(clean)) return;
  if (ALLOWED_PREFIXES.some((p) => clean.startsWith(p))) return;
  throw new Error(`refusing to call non-read-only endpoint: ${path}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

class ReadOnlySuperset {
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
    assertAllowed(path);
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
}

function validateChartResponse(json: Json | null, expectedColumns: string[], label: string): ValidationOutcome {
  const problems: string[] = [];
  if (json == null || typeof json !== "object") {
    return { ok: false, rowCount: null, colnames: [], problems: [`${label}: response is not JSON`] };
  }
  if (Array.isArray(json.errors) && json.errors.length > 0) {
    problems.push(`${label}: errors[] non-empty: ${JSON.stringify(json.errors).slice(0, 300)}`);
  }
  const result = json.result;
  if (!Array.isArray(result) || result.length === 0) {
    problems.push(`${label}: result[] missing or empty`);
    return { ok: false, rowCount: null, colnames: [], problems };
  }
  let rowCount = 0;
  const colnames: string[] = [];
  for (const [i, item] of result.entries()) {
    if (item?.error != null && String(item.error) !== "") {
      problems.push(`${label}: result[${i}].error = ${String(item.error).slice(0, 200)}`);
    }
    if (!Array.isArray(item?.colnames)) problems.push(`${label}: result[${i}].colnames missing`);
    else colnames.push(...item.colnames.map(String));
    const rc = numeric(item?.rowcount);
    if (rc == null) problems.push(`${label}: result[${i}].rowcount missing`);
    else rowCount += rc;
    const data = item?.data;
    if (!Array.isArray(data)) problems.push(`${label}: result[${i}].data missing`);
    else if (rc != null && data.length !== rc) problems.push(`${label}: result[${i}] rowcount=${rc} but data.length=${data.length}`);
  }
  for (const expected of expectedColumns) {
    if (expected && !colnames.includes(expected)) problems.push(`${label}: expected column "${expected}" not present in colnames`);
  }
  return { ok: problems.length === 0, rowCount, colnames, problems };
}

function expectedColumns(plan: RequestPlan): string[] {
  const q = plan.body?.queries?.[0] ?? {};
  const cols = new Set<string>();
  for (const c of Array.isArray(q.columns) ? q.columns : []) if (typeof c === "string") cols.add(c);
  for (const m of Array.isArray(q.metrics) ? q.metrics : []) {
    if (typeof m === "string") cols.add(m);
    else if (m && typeof m === "object" && typeof m.label === "string") cols.add(m.label);
  }
  return [...cols];
}

/** Metrics declared in the request bodies — used to seed the aggregate header even in dry-run. */
function declaredMetrics(plans: RequestPlan[]): Map<string, MetricKind> {
  const declared = new Map<string, MetricKind>();
  for (const plan of plans) {
    for (const q of Array.isArray(plan.body?.queries) ? plan.body.queries : []) {
      const metrics: Json[] = Array.isArray(q.metrics) ? q.metrics : [];
      for (const m of metrics) {
        const name = typeof m === "string" ? m : typeof m?.label === "string" ? m.label : null;
        if (name && METRIC_RE.test(name)) declared.set(name, metricKind(name));
      }
      if (q.is_timeseries === true && metrics.length === 0 && Array.isArray(q.columns)) {
        // series charts carry the single metric implicitly
        declared.set(WEIGHT_METRIC, "additive");
      }
    }
  }
  return declared;
}

// ---------------------------------------------------------------------------
// observation extraction
// ---------------------------------------------------------------------------

function extractObservations(
  plan: RequestPlan,
  json: Json,
): { observations: Observation[]; warnings: string[] } {
  const observations: Observation[] = [];
  const warnings: string[] = [];
  const q = plan.body?.queries?.[0] ?? {};
  const requestedMetrics: string[] = (Array.isArray(q.metrics) ? q.metrics : [])
    .map((m: Json) => (typeof m === "string" ? m : m?.label))
    .filter((m: Json) => typeof m === "string");
  const seriesMetric = requestedMetrics[0] ?? WEIGHT_METRIC;
  const isSeries = q.is_timeseries === true || plan.vizType === "echarts_area";

  for (const item of Array.isArray(json?.result) ? json.result : []) {
    for (const row of Array.isArray(item?.data) ? item.data : []) {
      if (row == null || typeof row !== "object") continue;
      const keys = Object.keys(row);
      const periodKey = keys.find((k) => PERIOD_KEYS.has(k) && toDateKey(row[k]) !== "");
      const date = periodKey ? toDateKey(row[periodKey]) : "";
      if (periodKey && !date) warnings.push(`${plan.sliceId}: unparsable period value in column ${periodKey}`);
      const rowWeight = numeric(row[WEIGHT_METRIC]) ?? undefined;

      if (isSeries) {
        for (const key of keys) {
          if (PERIOD_KEYS.has(key)) continue;
          const value = numeric(row[key]);
          if (value == null) {
            if (row[key] != null) warnings.push(`${plan.sliceId}: non-numeric series cell in column "${key}"`);
            continue;
          }
          observations.push({
            date,
            sliceId: plan.sliceId,
            datasourceId: plan.datasourceId,
            vizType: plan.vizType,
            dimension1: key,
            dimension2: "",
            metric: seriesMetric,
            kind: "additive",
            value,
            weight: rowWeight,
          });
        }
        continue;
      }

      const metricKeys = keys.filter((k) => METRIC_RE.test(k));
      const dimensionKeys = keys.filter((k) => !PERIOD_KEYS.has(k) && !metricKeys.includes(k));
      for (const metric of metricKeys) {
        const value = numeric(row[metric]);
        if (value == null) {
          if (row[metric] != null) warnings.push(`${plan.sliceId}: non-numeric value in metric column "${metric}"`);
          continue;
        }
        observations.push({
          date,
          sliceId: plan.sliceId,
          datasourceId: plan.datasourceId,
          vizType: plan.vizType,
          dimension1: dimensionKeys[0] ? String(row[dimensionKeys[0]]) : "",
          dimension2: dimensionKeys[1] ? String(row[dimensionKeys[1]]) : "",
          metric,
          kind: metricKind(metric),
          value,
          weight: rowWeight,
        });
      }
    }
  }

  return { observations, warnings };
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

  // weights per (date, slice, dimensions) so a ratio row can find its denominator
  const weightByRow = new Map<string, number>();
  for (const o of observations) {
    if (o.metric !== WEIGHT_METRIC) continue;
    const key = [o.date, o.sliceId, o.dimension1, o.dimension2].join("|");
    weightByRow.set(key, o.value);
  }

  for (const o of observations) {
    metricKindsMap.set(o.metric, o.kind);
    const key = [o.date, o.sliceId, o.dimension1, o.dimension2].join("|");
    let group = groups.get(key);
    if (!group) {
      group = newGroup(o.date, o.sliceId, o.datasourceId, o.vizType, o.dimension1, o.dimension2);
      groups.set(key, group);
    }
    group.rows++;
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
    const key = [group.date, group.sliceId].join("|");
    let target = collapsed.get(key);
    if (!target) {
      target = newGroup(group.date, group.sliceId, group.datasourceId, group.vizType, "__ALL__", "");
      collapsed.set(key, target);
    }
    target.rows += group.rows;
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
  for (const g of orderedGroups) {
    const row: Record<string, string | number> = {
      date: g.date,
      slice_id: g.sliceId ?? "",
      dataset_id: g.datasourceId ?? "",
      viz_type: g.vizType,
      dimension_1: g.dimension1,
      dimension_2: g.dimension2,
      source_rows: g.rows,
    };
    for (const m of additiveMetrics) row[m] = g.additive.get(m) ?? 0;
    let weighting = "";
    for (const m of ratioMetrics) {
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
// main
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

  const period = resolveTimeRange(args);
  const outDir = resolve(args.outDir);
  await mkdir(outDir, { recursive: true });

  const { plans, reports } = await loadPlans(args, period);
  const declared = declaredMetrics(plans);

  const results: RequestResult[] = [];
  const allObservations: Observation[] = [];
  const warnings: string[] = [];
  const expectedBySlice: Record<string, string[]> = {};
  let freshness: Record<string, unknown> | null = null;

  let client: ReadOnlySuperset | null = null;
  if (args.live) {
    client = new ReadOnlySuperset(args);
    try {
      await client.authenticate();
    } catch (error) {
      console.error(`[ERROR] ${String(error)}`);
      return 2;
    }
    for (const line of client.log) console.log(`[auth] ${line}`);
  } else {
    console.log("[mode] dry-run: no network calls; pass --live to fetch");
  }

  for (const [i, plan] of plans.entries()) {
    const report = reports[i]!;
    const label = `slice ${plan.sliceId} (${basename(plan.file)})`;
    const requestFile = join(outDir, `${String(plan.n).padStart(3, "0")}_slice_${plan.sliceId ?? "unknown"}.request.json`);
    const serializedBody = JSON.stringify(plan.body, null, 2);
    await writeText(requestFile, `${serializedBody}\n`);
    expectedBySlice[String(plan.sliceId)] = expectedColumns(plan);

    console.log(
      `[plan] ${label}: queries=${report.queries} time_range="${period.expression}" ` +
        `date_supply+=${report.datesupplyAdded} temporal=${report.temporalRewrites} ` +
        `row_limit_raised=${report.rowLimitRaised} shopno_rewrites=${report.shopnoRewrites}`,
    );

    const result: RequestResult = {
      n: plan.n,
      file: basename(plan.file),
      sliceId: plan.sliceId,
      url: plan.url,
      status: null,
      mode: args.live ? "error" : "dry-run",
      pollKey: null,
      attempts: 0,
      rowCount: null,
      colnames: [],
      problems: [],
      requestSha256: sha256(serializedBody),
      responseSha256: null,
      responseFile: null,
    };

    if (!args.live || !client) {
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

      const responseFile = join(outDir, `${String(plan.n).padStart(3, "0")}_slice_${plan.sliceId ?? "unknown"}.response.json`);
      await writeText(responseFile, `${JSON.stringify(response.json ?? { raw_text: response.text }, null, 2)}\n`);
      result.responseFile = basename(responseFile);
      result.responseSha256 = sha256(response.text);

      const validation = validateChartResponse(response.json, expectedBySlice[String(plan.sliceId)] ?? [], label);
      result.rowCount = validation.rowCount;
      result.colnames = [...new Set(validation.colnames)];
      result.problems.push(...validation.problems);

      const { observations, warnings: extractWarnings } = extractObservations(plan, response.json ?? {});
      allObservations.push(...observations);
      warnings.push(...extractWarnings);

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
    .map((o) => [o.date, o.sliceId, o.datasourceId, o.vizType, o.dimension1, o.dimension2, o.metric, o.kind, fmtNumber(o.value)]);
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
  const aggregateRows = aggregateResult.rows.map((row) => aggregateHeader.map((h) => row[h] ?? ""));
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

  const manifest = {
    generated_at: nowIso(),
    mode: args.live ? "live" : "dry-run",
    base_url: args.baseUrl,
    shopno: args.shopno,
    dashboard_id: 977,
    period: { from: period.from, to: period.to, time_range: period.expression, weeks: args.weeks, timezone: MSK },
    sources: plans.map((p) => ({ n: p.n, file: p.file, slice_id: p.sliceId, datasource_id: p.datasourceId, viz_type: p.vizType, request_sha256: p.bodySha256 })),
    transforms: reports,
    metric_kinds: aggregateResult.metricKinds,
    additive_metrics: aggregateResult.additiveMetrics,
    ratio_metrics: aggregateResult.ratioMetrics,
    ratio_weight_metric: WEIGHT_METRIC,
    data_freshness: freshness,
    observations: allObservations.length,
    aggregate_rows: aggregateResult.rows.length,
    requests: results,
    outputs: {
      requests_dir: outDir,
      observations_csv: "observations_7745.csv",
      aggregate_csv: "aggregate_7745.csv",
      validation_json: "validation.json",
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

  await writeText(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeText(join(outDir, "validation.json"), `${JSON.stringify(validation, null, 2)}\n`);

  console.log("");
  console.log(`[summary] mode=${manifest.mode} period=${period.expression}`);
  console.log(`[summary] requests=${validation.summary.requests} ok=${validation.summary.ok} failed=${validation.summary.failed}`);
  console.log(`[summary] observations=${validation.summary.observations} aggregate_rows=${validation.summary.aggregate_rows}`);
  console.log(`[summary] additive=[${aggregateResult.additiveMetrics.join(", ")}]`);
  console.log(`[summary] ratio=[${aggregateResult.ratioMetrics.join(", ")}]`);
  console.log(`[summary] output: ${outDir}`);

  if (args.live && validation.summary.failed > 0) return 1;
  return 0;
}

if (import.meta.main) {
  process.exitCode = await main();
}
