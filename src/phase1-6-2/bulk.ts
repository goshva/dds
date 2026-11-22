/**
 * Этап 1.6.2 — bulk-клиент Superset для массового чтения метаданных.
 *
 * Почему отдельный клиент: существующий SqlLabClient (src/phase1-6/client.ts) throttled
 * последовательно (1 запрос/сек) и рассчитан на SQL Lab. Для инвентаризации нужно
 * ~1000 GET-запросов метаданных; последовательный обход занял бы ~20 минут.
 * Здесь — те же штатные GET-эндпоинты, но с ограниченной конкурентностью (4) и
 * повторами. Никаких POST, кроме login. RBAC не обходится.
 */
import { loadConfig } from "../config";

export type BulkResponse = {
  status: number;
  ok: boolean;
  body: any;
  text: string;
  ms: number;
  error?: string;
};

export class BulkClient {
  private baseUrl: string;
  private username: string;
  private password: string;
  private token: string | null = null;
  private loginAttempts = 0;
  public requests = 0;
  public retries = 0;
  public errors: string[] = [];

  constructor() {
    const cfg = loadConfig();
    this.baseUrl = cfg.baseUrl.replace(/\/+$/, "");
    this.username = cfg.username;
    this.password = cfg.password;
  }

  async login(): Promise<void> {
    this.loginAttempts++;
    const r = await this.raw("/api/v1/security/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: this.username, password: this.password, provider: "db", refresh: true }),
    });
    const token = r.body?.access_token;
    if (!r.ok || !token) {
      throw new Error(`login failed: HTTP ${r.status} ${r.text.slice(0, 200)}`);
    }
    this.token = token;
  }

  private async raw(path: string, init: RequestInit = {}, timeoutMs = 30000): Promise<BulkResponse> {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Accept: "application/json",
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
          ...(init.headers as Record<string, string> | undefined),
        },
        signal: controller.signal,
      });
      const text = await res.text();
      let body: any = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }
      return { status: res.status, ok: res.ok, body, text: text.slice(0, 2000), ms: Date.now() - started };
    } catch (e: any) {
      return { status: 0, ok: false, body: null, text: "", ms: Date.now() - started, error: String(e?.message ?? e) };
    } finally {
      clearTimeout(timer);
    }
  }

  async get(path: string, timeoutMs = 30000): Promise<BulkResponse> {
    this.requests++;
    let r = await this.raw(path, {}, timeoutMs);
    if (r.status === 401) {
      this.retries++;
      await this.login();
      r = await this.raw(path, {}, timeoutMs);
    }
    // 429/5xx — до 3 повторов с уважением Retry-After
    for (let attempt = 0; attempt < 3 && (r.status === 429 || r.status >= 500); attempt++) {
      this.retries++;
      const wait = r.status === 429 ? 2000 * (attempt + 1) : 500 * (attempt + 1);
      await new Promise((res) => setTimeout(res, wait));
      r = await this.raw(path, {}, timeoutMs);
    }
    if (!r.ok) this.errors.push(`${path} -> HTTP ${r.status}${r.error ? ` ${r.error}` : ""}`);
    return r;
  }

  /** Параллельный обход с ограниченной конкурентностью. */
  async pool<T, R>(items: T[], worker: (item: T, index: number) => Promise<R>, concurrency = 4): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let next = 0;
    const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await worker(items[i], i);
      }
    });
    await Promise.all(runners);
    return results;
  }
}

export function q(rison: string): string {
  return encodeURIComponent(rison);
}
