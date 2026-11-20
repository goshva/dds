import type { Config } from "./config";

export class PaginationError extends Error {
  constructor(
    message: string,
    public readonly apiCount: number,
    public readonly downloadedCount: number,
    public readonly pagesCount: number,
    public readonly uniqueIdsCount: number = 0,
    public readonly duplicateRows: number = 0,
  ) {
    super(message);
    this.name = "PaginationError";
  }
}

export type ListResult = {
  rows: any[];
  api_count: number;
  downloaded_count: number;
  unique_ids_count: number;
  duplicate_rows: number;
  pages_count: number;
  complete: boolean;
};

export type NetworkErrorCategory =
  | "dns"
  | "tcp_refused"
  | "tcp_reset"
  | "timeout"
  | "tls"
  | "proxy"
  | "network_error";

type RequestOutcome =
  | { kind: "ok"; data: any }
  | { kind: "http_error"; status: number; body: any; retryAfterMs: number | null }
  | {
      kind: "network_error";
      error: unknown;
      category: NetworkErrorCategory;
      code: string | null;
      cause: string;
    };

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/** Проверенный Rison-формат list-запроса Superset 6.2.4: (page:N,page_size:N). */
export function buildPaginationQuery(page: number, pageSize: number): string {
  return encodeURIComponent(`(page:${page},page_size:${pageSize})`);
}

/** Retry-After: число секунд ИЛИ HTTP-date. Возвращает миллисекунды. */
export function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }

  const timestamp = Date.parse(trimmed);
  if (Number.isFinite(timestamp)) {
    return Math.max(0, timestamp - Date.now());
  }

  return null;
}

/** Классификация сетевой ошибки для api_transport_diagnostics.json. */
export function classifyNetworkError(error: unknown): {
  category: NetworkErrorCategory;
  code: string | null;
  cause: string;
} {
  const e = error as any;
  const nested = e?.cause as any;
  const code = e?.code != null ? String(e.code) : nested?.code != null ? String(nested.code) : null;
  const name = String(e?.name ?? nested?.name ?? "");
  const message = String(e?.message ?? nested?.message ?? error);
  const text = `${code ?? ""} ${name} ${message}`;

  let category: NetworkErrorCategory = "network_error";
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo|DNS/i.test(text)) {
    category = "dns";
  } else if (/ECONNREFUSED/i.test(text)) {
    category = "tcp_refused";
  } else if (/ECONNRESET|EPIPE|socket hang up/i.test(text)) {
    category = "tcp_reset";
  } else if (/CERT_|certificate|handshake|TLS|SSL/i.test(text)) {
    category = "tls";
  } else if (/proxy|ECONNPROXY|tunnel/i.test(text)) {
    category = "proxy";
  } else if (/ETIMEDOUT|ESOCKETTIMEDOUT|AbortError|timed? ?out|timeout|aborted/i.test(text)) {
    category = "timeout";
  }

  return { category, code, cause: message };
}

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

  private async rawRequest(path: string, init: RequestInit = {}): Promise<RequestOutcome> {
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
      try {
        parsed = body ? JSON.parse(body) : null;
      } catch {
        parsed = { raw_text: body.slice(0, 4000) };
      }
      if (!response.ok) {
        return {
          kind: "http_error",
          status: response.status,
          body: parsed,
          retryAfterMs: parseRetryAfter(response.headers.get("Retry-After")),
        };
      }
      return { kind: "ok", data: parsed };
    } catch (error) {
      const classified = classifyNetworkError(error);
      return { kind: "network_error", error, ...classified };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * GET с повторами:
   *  - 401 → переавторизация и повтор исходного запроса через тот же retry-loop (без повторной re-auth);
   *  - 429/5xx/network → exponential backoff до maxRetries;
   *  - после исчерпания повторов 429/5xx помечаются transient=true;
   *  - сетевая ошибка сохраняет cause/code/error_type.
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
        // Переавторизация ровно один раз; исходный запрос повторяется через общий retry-loop.
        await this.login(true);
        allowReauth = false;
        continue;
      }

      const retriableStatus = outcome.kind === "http_error" && RETRYABLE_STATUS.has(outcome.status);
      const network = outcome.kind === "network_error";
      if ((retriableStatus || network) && attempt < this.cfg.maxRetries) {
        attempt++;
        let delay = this.cfg.retryBaseDelayMs * 2 ** (attempt - 1);
        if (outcome.kind === "http_error" && outcome.status === 429) {
          // Уважаем Retry-After (секунды или HTTP-date) или удлинённый базовый шаг.
          const ra = outcome.retryAfterMs;
          delay = ra !== null ? Math.max(delay, ra) : Math.max(delay, this.cfg.retryBaseDelayMs * 2);
        }
        delay = Math.min(delay, 60_000);
        console.warn(
          `[RETRY ${attempt}/${this.cfg.maxRetries}] ${path}: ` +
          (outcome.kind === "network_error"
            ? `network error (${outcome.category}${outcome.code ? `/${outcome.code}` : ""})`
            : `HTTP ${outcome.status}`) +
          ` — waiting ${delay}ms`
        );
        await sleep(delay);
        continue;
      }

      if (outcome.kind === "http_error") {
        const err = new Error(`HTTP ${outcome.status}: ${JSON.stringify(outcome.body).slice(0, 1500)}`);
        (err as any).status = outcome.status;
        (err as any).transient = RETRYABLE_STATUS.has(outcome.status);
        (err as any).nonRetryable =
          outcome.status === 401 || outcome.status === 403 || outcome.status === 404;
        (err as any).retry_after_ms = outcome.retryAfterMs;
        throw err;
      }

      const err = new Error(`Network error after ${attempt} retries: ${outcome.cause}`);
      (err as any).transient = true;
      (err as any).cause = outcome.error;
      (err as any).code = outcome.code;
      (err as any).error_type = outcome.category;
      (err as any).network_category = outcome.category;
      throw err;
    }
  }

  async login(force = false): Promise<void> {
    if (this.token && !force) return;
    if (!this.canReauth()) {
      if (this.token) return; // используем предоставленный токен
      throw new Error("Set SUPERSET_ACCESS_TOKEN or SUPERSET_USERNAME + SUPERSET_PASSWORD");
    }
    const result = await this.requestWithRetry(
      "/api/v1/security/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: this.cfg.username,
          password: this.cfg.password,
          provider: this.cfg.provider,
          refresh: true,
        }),
      },
      false,
    );
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
   *  1) первый запрос читает .count как ground truth;
   *  2) качаем страницы до count;
   *  3) проверяем структуру каждой страницы и уникальность ID;
   *  4) при дублях/неполноте — PaginationError.
   * Формат q: Rison (page:N,page_size:N), совместим с Superset 6.2.4.
   */
  async listFull(resource: "dashboard" | "chart" | "dataset"): Promise<ListResult> {
    const first = await this.get(`/api/v1/${resource}/?q=${buildPaginationQuery(0, this.cfg.pageSize)}`);
    const apiCount = Number(first?.count ?? NaN);
    if (!Number.isFinite(apiCount) || apiCount < 0) {
      throw new Error(`list(${resource}): API did not report count`);
    }
    if (!Array.isArray(first?.result)) {
      throw new PaginationError(
        `list(${resource}): first page has no result array`,
        apiCount, 0, 1,
      );
    }

    const collected: any[] = [...first.result];
    let pages = 1;

    const maxByGuard = Math.ceil(apiCount / this.cfg.pageSize);
    if (maxByGuard > this.cfg.maxPages) {
      throw new PaginationError(
        `list(${resource}): API count=${apiCount} requires ${maxByGuard} pages, MAX_PAGES=${this.cfg.maxPages}. Increase MAX_PAGES.`,
        apiCount, collected.length, pages,
      );
    }

    while (collected.length < apiCount && pages < Math.max(1, maxByGuard)) {
      const result = await this.get(`/api/v1/${resource}/?q=${buildPaginationQuery(pages, this.cfg.pageSize)}`);
      if (!Array.isArray(result?.result)) {
        throw new PaginationError(
          `list(${resource}): page ${pages} has no result array`,
          apiCount, collected.length, pages,
        );
      }
      const rows = result.result;
      if (rows.length === 0) break; // источник закрыл выдачу раньше count
      collected.push(...rows);
      pages++;
    }

    const ids = collected.map((row) => String(row?.id ?? row?.uuid ?? row?.slug ?? ""));
    const missingIds = ids.filter((id) => !id).length;
    const uniqueIds = new Set(ids.filter(Boolean));
    const duplicateRows = ids.length - uniqueIds.size;
    const complete =
      collected.length === apiCount &&
      uniqueIds.size === apiCount &&
      duplicateRows === 0 &&
      missingIds === 0;

    if (!complete) {
      const reasons: string[] = [];
      if (collected.length !== apiCount) reasons.push(`rows ${collected.length} != count ${apiCount}`);
      if (uniqueIds.size !== apiCount) reasons.push(`unique ids ${uniqueIds.size} != count ${apiCount}`);
      if (duplicateRows > 0) reasons.push(`duplicate rows ${duplicateRows}`);
      if (missingIds > 0) reasons.push(`rows without id ${missingIds}`);
      throw new PaginationError(
        `list(${resource}): incomplete — ${reasons.join("; ")}`,
        apiCount, collected.length, pages, uniqueIds.size, duplicateRows,
      );
    }

    return {
      rows: collected,
      api_count: apiCount,
      downloaded_count: collected.length,
      unique_ids_count: uniqueIds.size,
      duplicate_rows: duplicateRows,
      pages_count: pages,
      complete: true,
    };
  }

  /** Совместимость: старый интерфейс возвращает только строки. */
  async list(resource: "dashboard" | "chart" | "dataset"): Promise<any[]> {
    return (await this.listFull(resource)).rows;
  }

  /** Detail без завершающего слэша (Superset 6.2.4). */
  async detail(resource: "dashboard" | "chart" | "dataset", id: string | number): Promise<any> {
    return this.get(`/api/v1/${resource}/${encodeURIComponent(String(id))}`);
  }

  async tryGet(path: string): Promise<
    | { ok: true; data: any }
    | {
        ok: false;
        error: string;
        status?: number;
        transient?: boolean;
        code?: string;
        error_type?: string;
        cause?: string;
        non_retryable?: boolean;
        retry_after_ms?: number | null;
      }
  > {
    try {
      return { ok: true, data: await this.get(path) };
    } catch (e: any) {
      return {
        ok: false,
        error: String(e?.message ?? e),
        status: e?.status,
        transient: Boolean(e?.transient),
        code: e?.code,
        error_type: e?.error_type,
        cause: e?.cause ? String(e.cause) : undefined,
        non_retryable: Boolean(e?.nonRetryable),
        retry_after_ms: e?.retry_after_ms ?? null,
      };
    }
  }
}
