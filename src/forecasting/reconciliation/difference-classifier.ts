/**
 * Классификация расхождений: чистые функции без побочных эффектов.
 *
 * Правила:
 *  - значения сравниваются сначала ТОЧНО (как строки, затем как числа);
 *  - для чисел с плавающей точкой допуск задаётся явно и документируется в отчёте;
 *  - расхождения не «сглаживаются» округлением: если значение изменилось, это VALUE_CHANGED.
 */

import type { DiffCategory, QualityChange, QualitySnapshot, Severity } from "./types";

export const COMPLETENESS_RANK: Record<string, number> = {
  full: 3,
  partial: 2,
  truncated: 1,
  none: 0,
};

export interface ValueComparison {
  category: Extract<DiffCategory, "IDENTICAL" | "VALUE_CHANGED" | "UNKNOWN">;
  detail: string;
  abs_delta: number | null;
  rel_delta: number | null;
}

/** Сравнение одного значения с явным допуском. */
export function classifyValue(
  oldRaw: string,
  newRaw: string,
  oldNum: number | null,
  newNum: number | null,
  tolerance: { abs: number; rel: number },
): ValueComparison {
  // 1) точное совпадение текста
  if (oldRaw === newRaw) {
    return { category: "IDENTICAL", detail: "точное совпадение", abs_delta: 0, rel_delta: 0 };
  }

  if (oldNum === null || newNum === null) {
    return {
      category: "UNKNOWN",
      detail: `значение не число: old=${JSON.stringify(oldRaw)} new=${JSON.stringify(newRaw)}`,
      abs_delta: null,
      rel_delta: null,
    };
  }

  // 2) числовое равенство (разное текстовое представление одного числа)
  if (oldNum === newNum) {
    return { category: "IDENTICAL", detail: "числовое равенство при разном тексте", abs_delta: 0, rel_delta: 0 };
  }

  const absDelta = Math.abs(newNum - oldNum);
  const relDelta = oldNum === 0 ? null : absDelta / Math.abs(oldNum);

  // 3) допуск применяется только если он задан явно
  if (absDelta <= tolerance.abs || (relDelta !== null && relDelta <= tolerance.rel)) {
    return {
      category: "IDENTICAL",
      detail: `в пределах допуска (abs<=${tolerance.abs}, rel<=${tolerance.rel})`,
      abs_delta: absDelta,
      rel_delta: relDelta,
    };
  }

  return {
    category: "VALUE_CHANGED",
    detail: `значение изменилось: ${oldNum} → ${newNum}`,
    abs_delta: absDelta,
    rel_delta: relDelta,
  };
}

/** Сравнение снимков качества одного среза. Ухудшение качества — отдельная категория. */
export function classifyQuality(oldQ: QualitySnapshot, newQ: QualitySnapshot): QualityChange[] {
  const changes: QualityChange[] = [];
  const push = (field: string, oldValue: unknown, newValue: unknown, degraded: boolean) => {
    const oldText = Array.isArray(oldValue) ? oldValue.join(", ") : String(oldValue);
    const newText = Array.isArray(newValue) ? newValue.join(", ") : String(newValue);
    if (oldText === newText) return;
    changes.push({ slice_id: oldQ.slice_id, field, old_value: oldText, new_value: newText, degraded });
  };

  push(
    "completeness",
    oldQ.completeness,
    newQ.completeness,
    (COMPLETENESS_RANK[newQ.completeness] ?? -1) < (COMPLETENESS_RANK[oldQ.completeness] ?? -1),
  );
  push("http_status", oldQ.http_status, newQ.http_status, oldQ.http_status === 200 && newQ.http_status !== 200);
  push("row_count", oldQ.row_count, newQ.row_count, (newQ.row_count ?? 0) < (oldQ.row_count ?? 0));
  push("missing_metrics", oldQ.missing_metrics, newQ.missing_metrics, newQ.missing_metrics.length > oldQ.missing_metrics.length);
  push(
    "missing_dimensions",
    oldQ.missing_dimensions,
    newQ.missing_dimensions,
    newQ.missing_dimensions.length > oldQ.missing_dimensions.length,
  );
  push(
    "truncated_queries",
    oldQ.truncated_queries.length,
    newQ.truncated_queries.length,
    newQ.truncated_queries.length > oldQ.truncated_queries.length,
  );
  push("duplicate_rows", oldQ.duplicate_rows, newQ.duplicate_rows, (newQ.duplicate_rows ?? 0) > (oldQ.duplicate_rows ?? 0));
  push("query_count_mismatch", oldQ.query_count_mismatch, newQ.query_count_mismatch, newQ.query_count_mismatch === true);
  return changes;
}

/** Доступ запрещён в одной из сторон — отдельная категория, сбор нельзя считать успешным. */
export function isAccessDenied(status: number | null): boolean {
  return status === 401 || status === 403;
}

export function severityOf(category: DiffCategory): Severity {
  switch (category) {
    case "VALUE_CHANGED":
    case "MISSING_ROW":
    case "QUALITY_DEGRADED":
    case "ACCESS_CHANGED":
    case "PERIOD_MISMATCH":
      return "error";
    case "NEW_ROW":
    case "SCHEMA_CHANGED":
    case "UNKNOWN":
      return "warning";
    default:
      return "info";
  }
}

export interface StatusInput {
  accessDenied: boolean;
  periodMismatch: boolean;
  incompleteSlices: number[];
  missingSlices: number[];
  valueChanged: number;
  newRows: number;
  missingRows: number;
  schemaChanged: number;
  qualityDegraded: number;
  maskingOnlyDifferences: number;
}

/**
 * Итоговый статус сверки.
 * Порядок: BLOCKED → INCOMPLETE (включая несовпадение периода, сравнение при нём недействительно)
 * → DATA_CHANGED → MATCH_WITH_MINOR_DIFFERENCES → IDENTICAL.
 */
export function resolveStatus(input: StatusInput): "IDENTICAL" | "MATCH_WITH_MINOR_DIFFERENCES" | "DATA_CHANGED" | "INCOMPLETE" | "BLOCKED" {
  if (input.accessDenied) return "BLOCKED";
  if (input.incompleteSlices.length > 0 || input.missingSlices.length > 0 || input.periodMismatch) return "INCOMPLETE";
  if (input.valueChanged > 0) return "DATA_CHANGED";
  if (input.newRows > 0 || input.missingRows > 0 || input.schemaChanged > 0 || input.qualityDegraded > 0 || input.maskingOnlyDifferences > 0) {
    return "MATCH_WITH_MINOR_DIFFERENCES";
  }
  return "IDENTICAL";
}

/** Пояснение для отчёта: почему такие расхождения ожидаемы или требуют решения. */
export function explain(category: DiffCategory): string {
  switch (category) {
    case "VALUE_CHANGED":
      return "Значение за прошедший день пересчитано источником (дозагрузка заказов, правки данных) либо изменился состав выборки. Требуется решение: какая версия считается истинной.";
    case "NEW_ROW":
      return "В новой выгрузке появилась комбинация измерений, которой не было в старой (новый сервис/тип, начало сбора по измерению).";
    case "MISSING_ROW":
      return "В новой выгрузке комбинация измерений отсутствует: либо в периоде не было таких заказов, либо источник перестал их отдавать.";
    case "SCHEMA_CHANGED":
      return "Изменился состав метрик или измерений источника — сопоставление строк без этого невозможно.";
    case "QUALITY_DEGRADED":
      return "Качество запроса ухудшилось (полнота, пропущенные метрики, дубли, обрезка).";
    case "ACCESS_CHANGED":
      return "Изменился доступ к датасету (401/403) — сверка данных невозможна, требуется выдача прав.";
    case "PERIOD_MISMATCH":
      return "Периоды выгрузок не совпадают, сравнение строк некорректно.";
    default:
      return "Причина не установлена, нужен дополнительный анализ.";
  }
}
