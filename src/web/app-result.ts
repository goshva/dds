/** FINAL-3.3.2.1-HARDENING: безопасное преобразование результата API в состояние экрана. */
import { emptyState, errorState, type TrustedHtml } from "./components";
import type { ApiResult } from "./api/client";

const MAX_MESSAGE = 200;

/**
 * Преобразует исключение любого типа в безопасный `ApiResult` со статусом error.
 * Не падает на `null`/`undefined`/строке/обычном `Error`; не раскрывает чувствительные данные.
 */
export function toErrorResult(error: unknown): ApiResult<never> {
  const candidate = (typeof error === "object" && error !== null ? error : {}) as { code?: unknown; message?: unknown };
  const code = typeof candidate.code === "string" && candidate.code.length > 0 ? candidate.code : "UNKNOWN";
  const rawMessage =
    typeof candidate.message === "string" && candidate.message.length > 0
      ? candidate.message
      : error instanceof Error && error.message
        ? error.message
        : typeof error === "string" && error.length > 0
          ? error
          : "Неизвестная ошибка";
  return {
    status: "error",
    error: { code, message: rawMessage.slice(0, MAX_MESSAGE), eventId: `client-${crypto.randomUUID()}` },
  };
}

/** Ожидает запрос, превращая любое исключение в error-результат. Успешный ApiResult не изменяется. */
export async function loadResult<T>(promise: Promise<ApiResult<T>>): Promise<ApiResult<T>> {
  try {
    return await promise;
  } catch (error) {
    return toErrorResult(error) as ApiResult<T>;
  }
}

/** Отрисовка результата блока: not_available → empty, error → error, ok → содержимое. */
export function block(result: ApiResult<unknown>, render: () => TrustedHtml): TrustedHtml {
  if (result.status === "not_available") return emptyState({ title: "Данные недоступны", detail: `причина: ${result.meta.reason ?? "UNKNOWN"}` });
  if (result.status === "error") return errorState({ title: "Ошибка источника", detail: result.error.message, code: `${result.error.code} · ${result.error.eventId.slice(0, 8)}` });
  return render();
}
