/** UI-2: типизированный API-клиент DSS. Без demo-подстановок и без автоповторов. */
export type ApiStatus = "ok" | "not_available" | "error";

export interface ApiMeta { generatedAt: string; source: string; readOnly: true; checksum?: string; reason?: string; note?: string }
export interface ApiOk<T> { status: "ok"; data: T; meta: ApiMeta }
export interface ApiNotAvailable { status: "not_available"; data: null; meta: ApiMeta }
export interface ApiErrorBody { status: "error"; error: { code: string; message: string; eventId: string } }
export type ApiResult<T> = ApiOk<T> | ApiNotAvailable | ApiErrorBody;

export class ApiClientError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
  }
}

export interface ClientOptions { baseUrl?: string; timeoutMs?: number }

export class ApiClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  constructor(options: ClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? "";
    this.timeoutMs = options.timeoutMs ?? 8000;
  }

  async get<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<ApiResult<T>> {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") search.set(key, String(value));
    }
    const query = search.toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}${query ? `?${query}` : ""}`, { signal: controller.signal, headers: { Accept: "application/json" } });
      // R7: сначала HTTP-статус, затем тело
      if (!response.ok) throw new ApiClientError(`HTTP_${response.status}`, `API вернул статус ${response.status}`);
      const text = await response.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new ApiClientError("INVALID_JSON", "Сервер вернул некорректный JSON");
      }
      const validated = validateResult<T>(parsed);
      if (!validated) throw new ApiClientError("INVALID_RESPONSE", "Неожиданный формат ответа");
      return validated;
    } catch (error) {
      if (error instanceof ApiClientError) throw error;
      if ((error as Error).name === "AbortError") throw new ApiClientError("TIMEOUT", "Превышено время ожидания ответа");
      throw new ApiClientError("NETWORK_ERROR", "Не удалось связаться с API");
    } finally {
      clearTimeout(timer);
    }
  }
}

/** R7: проверка структуры ApiOk / ApiNotAvailable / ApiError. */
export function validateResult<T>(value: unknown): ApiResult<T> | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.status === "ok") {
    if (!("data" in record) || typeof record.meta !== "object" || record.meta === null) return null;
    const meta = record.meta as Record<string, unknown>;
    if (meta.readOnly !== true || typeof meta.generatedAt !== "string" || typeof meta.source !== "string") return null;
    return record as unknown as ApiOk<T>;
  }
  if (record.status === "not_available") {
    // R7: обязательные поля meta проверяются так же строго, как для ok
    if (record.data !== null || typeof record.meta !== "object" || record.meta === null) return null;
    const meta = record.meta as Record<string, unknown>;
    if (meta.readOnly !== true || typeof meta.generatedAt !== "string" || typeof meta.source !== "string") return null;
    return record as unknown as ApiNotAvailable;
  }
  if (record.status === "error") {
    const error = record.error as Record<string, unknown> | undefined;
    if (!error || typeof error.code !== "string" || typeof error.message !== "string") return null;
    // R2: eventId обязателен и должен быть непустой строкой
    if (typeof error.eventId !== "string" || error.eventId.trim() === "") return null;
    return record as unknown as ApiErrorBody;
  }
  return null;
}

export const api = new ApiClient();