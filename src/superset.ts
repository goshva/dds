import type { Config } from "./config";

export class PaginationError extends Error {
  constructor(
    message: string,
    public readonly apiCount: number,
    public readonly downloadedCount: number,
    public readonly pagesCount: number
  ) {
    super(message);
    this.name = "PaginationError";
  }
}

export type ListResult = {
  rows: any[];
  api_count: number;
  downloaded_count: number;
  pages_count: number;
  complete: boolean;
};

type RequestOutcome =
  | { kind: "ok"; data: any }
  | { kind: "http_error"; status: number; body: any }
  | { kind: "network_error"; error: unknown };

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class SupersetClient {
  private token = "";
  private csrf = "";
  private lastRequestAt = 0;

  constructor(private cfg: Config) {
    this.token = cfg.accessToken;
  }

  authMode(): string {
    return this.cfg.accessToken ? "provided-jwt" : "username-password";
  }

  private canReauth(): boolean {
    return Boolean(this.cfg.username && this.cfg.password);
  }

  /** Последовательное ограничение частоты запросов (RATE_LIMIT_MS между стартами). */
  private async throttle(): Promise<void> {
    const now = Date.now();
    const wait = this.cfg.rateLimitMs - (now - this.lastRequestAt);
    if (wait > 0) await sleep(wait);
    this.lastRequestAt = Date.now();
  }

  private buildHeaders(init: RequestInit): Headers {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (this.token) headers.set("Authorization", `Bearer ${this.token}`);
    if (this.csrf) headers.set("X-CSRFToken", this.csrf);
    return headers;
  }

  private async rawRequest(path: string, init: RequestInit = {}): Promise<RequestOutcome & { retryAfterMs?: number | null }> {
    await this.throttle();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    try {
      const response = await fetch(new URL(path, this.cfg.baseUrl), {
        ...init,
        headers: this.buildHeaders(init),
        signal: controller.signal,
      });
      const body = await response.text();
      let parsed: any;
      try { parsed = body ? JSON.parse(body) : null; }
      catch { parsed = { raw_text: body.slice(0, 4000) }; }
      if (!response.ok) {
        const raHeader = response.headers.get("Retry-After");
        const ra = raHeader ? Number(raHeader) : NaN;
        return {
          kind: "http_error",
          status: response.status,
          body: parsed,
          retryAfterMs: Number.isFinite(ra) && ra >= 0 ? ra * 1000 : null,
        };
      }
      return { kind: "ok", data: parsed };
    } catch (error) {
      return { kind: "network_error", error };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * GET с повторами: 401 → переавторизация + ровно один повтор исходного запроса;
   * 429/5xx/network → exponential backoff до maxRetries.
   */
  private async requestWithRetry(path: string, init: RequestInit = {}, allowReauth = true): Promise<any> {
    let attempt = 0;
    for (;;) {
      const outcome = await this.rawRequest(path, init);

      if (outcome.kind === "ok") return outcome.data;

      if (outcome.kind === "http_error" && outcome.status === 401 && allowReauth) {
        if (!this.canReauth()) {
          throw new Error(
            "HTTP 401: token expired and automatic refresh is impossible " +
            "(SUPERSET_ACCESS_TOKEN provided without SUPERSET_USERNAME/SUPERSET_PASSWORD)"
          );
        }
        // Повторная авторизация и ПОВТОР ИСХОДНОГО ЗАПРОСА ровно один раз.
        await this.login(true);
        const retry = await this.rawRequest(path, init);
        if (retry.kind === "ok") return retry.data;
        const err = new Error(`HTTP ${retry.kind === "http_error" ? retry.status : 401} after re-auth: ${JSON.stringify(retry.kind === "http_error" ? retry.body : String(retry.error)).slice(0, 500)}`);
        (err as any).status = retry.kind === "http_error" ? retry.status : 401;
        throw err;
      }

      const retriableStatus = outcome.kind === "http_error" && RETRYABLE_STATUS.has(outcome.status);
      const network = outcome.kind === "network_error";
      if ((retriableStatus || network) && attempt < this.cfg.maxRetries) {
        attempt++;
        let delay = this.cfg.retryBaseDelayMs * 2 ** (attempt - 1);
        if (outcome.kind === "http_error" && outcome.status === 429) {
          // Уважаем Retry-After или удлинённый базовый шаг.
          const ra = outcome.retryAfterMs;
          delay = ra ? Math.max(delay, ra) : Math.max(delay, this.cfg.retryBaseDelayMs * 2);
        }
        delay = Math.min(delay, 60_000);
        console.warn(`[RETRY ${attempt}/${this.cfg.maxRetries}] ${path}: ${outcome.kind === "network_error" ? "network error" : `HTTP ${outcome.status}`} — waiting ${delay}ms`);
        await sleep(delay);
        continue;
      }

      if (outcome.kind === "http_error") {
        const err = new Error(`HTTP ${outcome.status}: ${JSON.stringify(outcome.body).slice(0, 1500)}`);
        (err as any).status = outcome.status;
        (err as any).nonRetryable = outcome.status === 403 || outcome.status === 404;
        throw err;
      }
      const err = new Error(`Network error after ${attempt} retries: ${String(outcome.error)}`);
      (err as any).transient = true;
      throw err;
    }
  }

  async login(force = false): Promise<void> {
    if (this.token && !force) return;
    if (!this.canReauth()) {
      if (this.token) return; // используем предоставленный токен
      throw new Error("Set SUPERSET_ACCESS_TOKEN or SUPERSET_USERNAME + SUPERSET_PASSWORD");
    }
    const result = await this.requestWithRetry("/api/v1/security/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: this.cfg.username,
        password: this.cfg.password,
        provider: this.cfg.provider,
        refresh: true,
      }),
    }, false);
    if (!result?.access_token) throw new Error("Login response did not contain access_token");
    this.token = result.access_token;
  }

  async getCsrf(): Promise<void> {
    try {
      const result = await this.requestWithRetry("/api/v1/security/csrf_token/");
      this.csrf = result?.result ?? "";
    } catch (error) {
      // Read-only GET discovery can still proceed with JWT if CSRF endpoint is restricted.
      console.warn(`[WARN] CSRF endpoint unavailable: ${String(error)}`);
    }
  }

  async get(path: string): Promise<any> {
    return this.requestWithRetry(path);
  }

  /**
   * Полная пагинация list-эндпоинта:
   *  1) первый запрос читаем .count как ground truth;
   *  2) качаем страницы до count;
   *  3) защитный предел MAX_PAGES → явная ошибка PaginationError, если count больше предела.
   * Формат q совместим с Superset 6.2.4.
   */
  async listFull(resource: "dashboard" | "chart" | "dataset"): Promise<ListResult> {
    const firstQ = encodeURIComponent(JSON.stringify({ page: 0, page_size: this.cfg.pageSize }));
    const first = await this.get(`/api/v1/${resource}/?q=${firstQ}`);
    const apiCount = Number(first?.count ?? NaN);
    if (!Number.isFinite(apiCount) || apiCount < 0) {
      throw new Error(`list(${resource}): API did not report count`);
    }
    const firstRows = Array.isArray(first?.result) ? first.result : [];
    const collected: any[] = [...firstRows];
    let pages = 1;

    const maxByGuard = Math.ceil(apiCount / this.cfg.pageSize);
    const pageLimit = Math.min(Math.max(this.cfg.maxPages, 1), maxByGuard > this.cfg.maxPages ? this.cfg.maxPages : maxByGuard);

    if (maxByGuard > this.cfg.maxPages) {
      throw new PaginationError(
        `list(${resource}): API count=${apiCount} requires ${maxByGuard} pages, MAX_PAGES=${this.cfg.maxPages}. Increase MAX_PAGES.`,
        apiCount, collected.length, pages
      );
    }

    while (collected.length < apiCount && pages < pageLimit) {
      const q = encodeURIComponent(JSON.stringify({ page: pages, page_size: this.cfg.pageSize }));
      const result = await this.get(`/api/v1/${resource}/?q=${q}`);
      const rows = Array.isArray(result?.result) ? result.result : [];
      if (rows.length === 0) break; // источник закрыл выдачу раньше count
      collected.push(...rows);
      pages++;
    }

    const complete = collected.length >= apiCount;
    if (!complete) {
      throw new PaginationError(
        `list(${resource}): incomplete — downloaded ${collected.length} of API count ${apiCount}`,
        apiCount, collected.length, pages
      );
    }

    return { rows: collected, api_count: apiCount, downloaded_count: collected.length, pages_count: pages, complete: true };
  }

  /** Совместимость: старый интерфейс возвращает только строки. */
  async list(resource: "dashboard" | "chart" | "dataset"): Promise<any[]> {
    return (await this.listFull(resource)).rows;
  }

  /** Detail без завершающего слэша (Superset 6.2.4). */
  async detail(resource: "dashboard" | "chart" | "dataset", id: string | number): Promise<any> {
    return this.get(`/api/v1/${resource}/${encodeURIComponent(String(id))}`);
  }

  async tryGet(path: string): Promise<{ ok: true; data: any } | { ok: false; error: string; status?: number; transient?: boolean }> {
    try {
      return { ok: true, data: await this.get(path) };
    } catch (e: any) {
      return { ok: false, error: String(e), status: e?.status, transient: Boolean(e?.transient) };
    }
  }
}
