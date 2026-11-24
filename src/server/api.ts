/** UI-2: единый контракт API DSS (read-only). */
export interface ApiMeta {
  generatedAt: string;
  source: string;
  readOnly: true;
  checksum?: string;
  reason?: string;
  note?: string;
}
export interface ApiOk<T> { status: "ok"; data: T; meta: ApiMeta }
export interface ApiNotAvailable { status: "not_available"; data: null; meta: ApiMeta }
export interface ApiError { status: "error"; error: { code: string; message: string; eventId: string } }
/** Внутренний результат маппинга ошибки до присвоения eventId. */
export interface ApiErrorCore { status: "error"; error: { code: string; message: string } }
export type ApiResponse<T> = ApiOk<T> | ApiNotAvailable | ApiError;

export const SEMANTICS_STATUS = "PROVISIONAL" as const;

export class SourceError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  constructor(code: string, message: string, httpStatus = 503) {
    super(message);
    this.name = "SourceError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export function meta(source: string, extra: Partial<ApiMeta> = {}): ApiMeta {
  return { generatedAt: new Date().toISOString(), source, readOnly: true, ...extra };
}
export function ok<T>(data: T, source: string, extra: Partial<ApiMeta> = {}): ApiOk<T> {
  return { status: "ok", data, meta: meta(source, extra) };
}
export function notAvailable(reason: string, source: string): ApiNotAvailable {
  return { status: "not_available", data: null, meta: meta(source, { reason }) };
}
/** Клиенту — код и общее сообщение; без stack trace, путей и SQL. */
export function toErrorResponse(error: unknown): { body: ApiErrorCore; status: number } {
  if (error instanceof SourceError) {
    return { body: { status: "error", error: { code: error.code, message: error.message } }, status: error.httpStatus };
  }
  return { body: { status: "error", error: { code: "INTERNAL_ERROR", message: "Internal server error" } }, status: 500 };
}
/**
 * R6 (UI-2.2.1): единая точка формирования ошибки API.
 * Сырое сообщение не логируется: в лог идёт только код и идентификатор события.
 */
export function fail(context: { json: (body: unknown, status: number) => Response }, error: unknown): Response {
  const response = toErrorResponse(error);
  const eventId = crypto.randomUUID();
  console.error(`[dss-api] code=${response.body.error.code} event=${eventId}`);
  return context.json({ status: "error", error: { code: response.body.error.code, message: response.body.error.message, eventId } }, response.status);
}