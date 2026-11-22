/**
 * Этап 1.6 — клиент Superset SQL Lab (read-only) + защита от небезопасного SQL.
 * Переиспользует Config проекта; не изменяет src/superset.ts.
 */
import { loadConfig, type Config } from "../config";

export type SqlResult = {
  status: "success" | "error" | "blocked";
  columns: string[];
  rows: any[][];
  rowCount: number;
  durationMs: number;
  queryId: string | null;
  errors: string[];
  rawStatus: string | null;
};

const FORBIDDEN = [
  "insert", "update", "delete", "drop", "alter", "truncate", "create", "replace",
  "grant", "revoke", "attach", "detach", "copy", "call", "merge", "execute", "exec",
  "vacuum", "reindex", "cluster", "comment", "refresh", "set", "reset", "do", "use",
  "load", "unload", "import", "export", "kill", "shutdown", "lock", "begin", "commit", "rollback",
];

/** Убирает комментарии (в т.ч. авторские PII) — безопасная версия SQL для evidence. */
export function redactSql(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n\r]*/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** Убирает строковые литералы и комментарии для анализа ключевых слов. */
function normalizeForGuard(sql: string): string {
  let out = "";
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  let inLine = false;
  let inBlock = false;
  while (i < sql.length) {
    const c = sql[i];
    const n = sql[i + 1];
    if (inLine) { if (c === "\n") inLine = false; i++; continue; }
    if (inBlock) { if (c === "*" && n === "/") { inBlock = false; i += 2; continue; } i++; continue; }
    if (inSingle) { if (c === "'" && n === "'") { i += 2; continue; } if (c === "'") inSingle = false; i++; continue; }
    if (inDouble) { if (c === '"') inDouble = false; i++; continue; }
    if (c === "-" && n === "-") { inLine = true; i += 2; continue; }
    if (c === "/" && n === "*") { inBlock = true; i += 2; continue; }
    if (c === "'") { inSingle = true; i++; continue; }
    if (c === '"') { inDouble = true; i++; continue; }
    out += c;
    i++;
  }
  return out.replace(/\s+/g, " ").trim();
}

/** Разрешает только одиночный read-only запрос: SELECT/WITH/EXPLAIN/SHOW/DESCRIBE. */
export function assertReadOnly(sql: string): { ok: true; normalized: string } | { ok: false; reason: string } {
  const normalized = normalizeForGuard(sql);
  if (!normalized) return { ok: false, reason: "пустой SQL" };
  const statements = normalized.split(";").map((s) => s.trim()).filter(Boolean);
  if (statements.length > 1) return { ok: false, reason: "несколько инструкций запрещено" };
  const stmt = statements[0];
  const first = stmt.match(/^([a-zA-Z]+)/)?.[1]?.toLowerCase() ?? "";
  if (!["select", "with", "explain", "show", "describe", "desc"].includes(first)) {
    return { ok: false, reason: `запрещённый тип инструкции: ${first || "?"}` };
  }
  const lower = stmt.toLowerCase();
  for (const kw of FORBIDDEN) {
    if (new RegExp(`(^|[^a-z_])${kw}([^a-z_]|$)`).test(lower)) {
      // "set" может встретиться в имени колонки date_set_cell — проверяем только как отдельное слово-инструкцию
      if (kw === "set" && /^with\b/.test(lower) === false && !/\bset\b\s+[a-z_]+\s*=/.test(lower)) continue;
      return { ok: false, reason: `запрещённое ключевое слово: ${kw}` };
    }
  }
  return { ok: true, normalized: stmt };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export class SqlLabClient {
  private token = "";
  private csrf = "";
  private lastAt = 0;
  private log: any[] = [];

  constructor(private cfg: Config) {
    this.token = cfg.accessToken;
  }

  getLog() {
    return this.log;
  }

  private async throttle() {
    const wait = this.cfg.rateLimitMs - (Date.now() - this.lastAt);
    if (wait > 0) await sleep(wait);
    this.lastAt = Date.now();
  }

  private headers(extra: Record<string, string> = {}): Headers {
    const h = new Headers(extra);
    h.set("Accept", "application/json");
    if (this.token) h.set("Authorization", `Bearer ${this.token}`);
    if (this.csrf) h.set("X-CSRFToken", this.csrf);
    return h;
  }

  private async raw(path: string, init: RequestInit = {}, timeoutMs?: number): Promise<{ ok: boolean; status: number; body: any; text: string }> {
    await this.throttle();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs ?? this.cfg.timeoutMs);
    try {
      const res = await fetch(new URL(path, this.cfg.baseUrl), { ...init, headers: this.headers((init.headers as Record<string, string>) ?? {}), signal: controller.signal });
      const text = await res.text();
      let body: any = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = null; }
      return { ok: res.ok, status: res.status, body, text: text.slice(0, 2000) };
    } finally {
      clearTimeout(timer);
    }
  }

  async login(): Promise<void> {
    if (this.token) return;
    if (!this.cfg.username || !this.cfg.password) throw new Error("нет учётных данных");
    const r = await this.raw("/api/v1/security/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: this.cfg.username, password: this.cfg.password, provider: this.cfg.provider, refresh: true }),
    });
    if (!r.ok || !r.body?.access_token) throw new Error(`login failed: HTTP ${r.status}`);
    this.token = r.body.access_token;
  }

  async getCsrf(): Promise<{ ok: boolean; status: number }> {
    const r = await this.raw("/api/v1/security/csrf_token/");
    if (r.ok && r.body?.result) {
      this.csrf = r.body.result;
      return { ok: true, status: r.status };
    }
    return { ok: false, status: r.status };
  }

  async get(path: string): Promise<{ ok: boolean; status: number; body: any; text: string }> {
    return this.raw(path);
  }

  /** Авторизованный POST (только для read-only диагностики/execute). */
  async post(path: string, body: unknown, timeoutMs?: number): Promise<{ ok: boolean; status: number; body: any; text: string }> {
    return this.raw(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, timeoutMs);
  }

  async databases(): Promise<any[]> {
    const r = await this.raw("/api/v1/database/?q=" + encodeURIComponent("(page:0,page_size:100)"));
    if (!r.ok) throw new Error(`databases HTTP ${r.status}: ${r.text}`);
    return Array.isArray(r.body?.result) ? r.body.result : [];
  }

  async datasetDetail(id: number | string): Promise<any | null> {
    const r = await this.raw(`/api/v1/dataset/${encodeURIComponent(String(id))}`);
    if (!r.ok) return null;
    return r.body ?? null;
  }

  /**
   * Выполнение read-only запроса. Возвращает результат или ошибку.
   * Никогда не бросает на SQL-ошибке: статус фиксируется в результате.
   */
  async execute(opts: { databaseId: number; sql: string; schema?: string | null; limit?: number; timeoutMs?: number; label?: string }): Promise<SqlResult> {
    const guard = assertReadOnly(opts.sql);
    const started = Date.now();
    const entry: any = {
      label: opts.label ?? null,
      database_id: opts.databaseId,
      schema: opts.schema ?? null,
      sql: opts.sql,
      sql_redacted: redactSql(opts.sql),
      started_at: new Date().toISOString(),
      guard: guard.ok ? "OK" : `BLOCKED: ${guard.reason}`,
    };
    if (!guard.ok) {
      const res: SqlResult = { status: "blocked", columns: [], rows: [], rowCount: 0, durationMs: 0, queryId: null, errors: [guard.reason], rawStatus: null };
      entry.finished_at = new Date().toISOString();
      entry.status = "blocked";
      entry.errors = [guard.reason];
      this.log.push(entry);
      return res;
    }

    const clientId = crypto.randomUUID();
    const payload: Record<string, unknown> = {
      database_id: opts.databaseId,
      sql: opts.sql,
      json: true,
      runAsync: false,
      schema: opts.schema ?? null,
      sql_editor_id: null,
      tab: "phase1-6",
      expand_data: true,
      select_as_cta: false,
      ctas_method: "TABLE",
      tmp_table_name: "",
      client_id: clientId,
      queryLimit: opts.limit ?? 1000,
    };

    try {
      const r = await this.raw("/api/v1/sqllab/execute/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }, opts.timeoutMs ?? 120_000);

      entry.http_status = r.status;
      entry.http_body = r.text.slice(0, 1200);
      const body = r.body;
      entry.raw_status = body?.status ?? null;
      entry.query_id = body?.query?.id ?? body?.key ?? null;

      // async-режим
      if (body && (body.status === "running" || body.status === "pending") && (body.key || body.query?.id)) {
        const key = body.key ?? body.query?.id;
        const polled = await this.pollResult(key, opts.timeoutMs ?? 120_000);
        Object.assign(entry, polled.entry);
        entry.finished_at = new Date().toISOString();
        entry.status = polled.result.status;
        entry.rows = polled.result.rowCount;
        entry.errors = polled.result.errors;
        this.log.push(entry);
        return polled.result;
      }

      const errors: string[] = [];
      if (Array.isArray(body?.errors)) for (const e of body.errors) errors.push(String(e?.message ?? e));
      const columns: string[] = Array.isArray(body?.columns) ? body.columns.map((c: any) => String(c?.name ?? c?.column_name ?? c)) : [];
      const rows: any[][] = Array.isArray(body?.data) ? body.data.map((row: any) => (Array.isArray(row) ? row : Object.values(row))) : [];
      const okStatus = body?.status === "success" || (errors.length === 0 && (Array.isArray(body?.data) || columns.length > 0));
      const result: SqlResult = {
        status: okStatus ? "success" : "error",
        columns,
        rows,
        rowCount: Number(body?.query?.rows ?? rows.length) || rows.length,
        durationMs: Date.now() - started,
        queryId: body?.query?.id != null ? String(body.query.id) : null,
        errors,
        rawStatus: body?.status ?? null,
      };
      entry.finished_at = new Date().toISOString();
      entry.status = result.status;
      entry.columns = columns;
      entry.row_count = result.rowCount;
      entry.errors = errors;
      this.log.push(entry);
      return result;
    } catch (e: any) {
      const result: SqlResult = { status: "error", columns: [], rows: [], rowCount: 0, durationMs: Date.now() - started, queryId: null, errors: [String(e?.message ?? e)], rawStatus: null };
      entry.finished_at = new Date().toISOString();
      entry.status = "error";
      entry.errors = result.errors;
      this.log.push(entry);
      return result;
    }
  }

  private async pollResult(key: string, timeoutMs: number): Promise<{ result: SqlResult; entry: any }> {
    const started = Date.now();
    let last: any = null;
    while (Date.now() - started < timeoutMs) {
      await sleep(1500);
      const r = await this.raw(`/api/v1/sqllab/results/?key=${encodeURIComponent(key)}&rows=1000`);
      last = r.body;
      if (!r.ok) break;
      if (last?.status && last.status !== "running" && last.status !== "pending") break;
      if (Array.isArray(last?.data) && last.data.length) break;
    }
    const errors: string[] = [];
    if (Array.isArray(last?.errors)) for (const e of last.errors) errors.push(String(e?.message ?? e));
    const columns: string[] = Array.isArray(last?.columns) ? last.columns.map((c: any) => String(c?.name ?? c)) : [];
    const rows: any[][] = Array.isArray(last?.data) ? last.data.map((row: any) => (Array.isArray(row) ? row : Object.values(row))) : [];
    const ok = errors.length === 0 && (last?.status === "success" || rows.length > 0 || columns.length > 0);
    return {
      result: { status: ok ? "success" : "error", columns, rows, rowCount: rows.length, durationMs: Date.now() - started, queryId: key, errors, rawStatus: last?.status ?? null },
      entry: { async_key: key, columns, row_count: rows.length, errors },
    };
  }
}

export function makeClient(): SqlLabClient {
  return new SqlLabClient(loadConfig());
}
