/** FINAL-3.3.2.1-HARDENING: делегирование кликов страницы (безопасное для вложенных элементов). */

/** Действия, поддерживаемые страницами приложения. */
export type ClickAction = "apply-range" | "reset-range" | "page-prev" | "page-next";

const ACTION_BY_ID: Record<string, ClickAction> = {
  "ds-apply": "apply-range",
  "ds-reset": "reset-range",
  "ds-page-prev": "page-prev",
  "ds-page-next": "page-next",
};

const ACTION_SELECTOR = "#ds-apply, #ds-reset, #ds-page-prev, #ds-page-next";

/** Чистое сопоставление id → действие: используется делегированием и покрывается тестами. */
export function clickActionFor(id: string | null | undefined): ClickAction | null {
  if (!id) return null;
  return ACTION_BY_ID[id] ?? null;
}

/**
 * Делегирование клика: `event.target` может быть вложенным `span`/`svg`, поэтому ищем ближайший
 * элемент действия через `closest` и убеждаемся, что он находится внутри приложения.
 */
export function resolveClickAction(target: EventTarget | null, container: Element | null): ClickAction | null {
  if (!(target instanceof Element)) return null;
  const element = target.closest(ACTION_SELECTOR);
  if (!element) return null;
  if (container && !container.contains(element)) return null;
  return clickActionFor(element.id);
}
