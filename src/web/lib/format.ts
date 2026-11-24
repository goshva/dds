/** Форматтеры и экранирование UI (без бизнес-расчётов). */
export type DssStatus = "OK" | "PENDING" | "PROVISIONAL" | "FALLBACK" | "CONFLICT" | "NOT_AVAILABLE";

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatNumber(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "NOT_AVAILABLE";
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(value);
}

export function formatPercent(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "NOT_AVAILABLE";
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits }).format(value)} %`;
}

export function formatDate(date: string | null | undefined): string {
  if (!date) return "NOT_AVAILABLE";
  const [year, month, day] = date.split("-");
  return `${day}.${month}.${year}`;
}

export function statusLabel(status: DssStatus): string {
  const labels: Record<DssStatus, string> = {
    OK: "OK",
    PENDING: "PENDING",
    PROVISIONAL: "PROVISIONAL",
    FALLBACK: "FALLBACK",
    CONFLICT: "CONFLICT",
    NOT_AVAILABLE: "NOT_AVAILABLE",
  };
  return labels[status];
}

export function statusClass(status: DssStatus): string {
  const classes: Record<DssStatus, string> = {
    OK: "ds-badge--ok",
    PENDING: "ds-badge--pending",
    PROVISIONAL: "ds-badge--provisional",
    FALLBACK: "ds-badge--fallback",
    CONFLICT: "ds-badge--conflict",
    NOT_AVAILABLE: "ds-badge--na",
  };
  return classes[status];
}
/**
 * Контракт HTML-безопасности (UI-1.1).
 *
 * Граница:
 *  - TrustedHtml — разметка, созданная исключительно компонентами DSS;
 *  - динамические данные (API, файлы, пользовательский ввод) обязаны проходить escapeHtml
 *    и НИКОГДА не передаются в слоты TrustedHtml напрямую.
 *
 * Слоты `body`, `right`, `chart`, `legend`, `sidebar`, `topbar`, `content` принимают TrustedHtml.
 */
export type TrustedHtml = string & { readonly __trustedHtml: unique symbol };

export function trusted(markup: string): TrustedHtml {
  return markup as TrustedHtml;
}

const SAFE_HREF_PATTERN = /^(?:#|\.{0,2}\/|[a-zA-Z0-9._~%!$&'()*+,;=:@-]+\/?)/;

/** Разрешает внутренние маршруты и безопасные http(s) URL; запрещает javascript:, data:, vbscript:, file:. */
export function isSafeHref(href: string | null | undefined): boolean {
  if (!href) return false;
  const value = href.trim();
  if (value === "") return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) {
    return /^https?:\/\//i.test(value) && !/[\u0000-\u001f<>"']/.test(value);
  }
  if (value.startsWith("//")) return false;
  return SAFE_HREF_PATTERN.test(value) && !/[\u0000-\u001f<>"']/.test(value);
}

/** Возвращает безопасный href либо "#" с пометкой о недопустимой схеме. */
export function safeHref(href: string | null | undefined): string {
  return isSafeHref(href) ? escapeHtml(String(href).trim()) : "#";
}