/**
 * Stage 3.3.1.5 — сверка расширенной истории с предыдущей версией canonical dataset.
 *
 * Прежние данные не перезаписываются молча: любое расхождение получает категорию
 * и попадает в отчёт, а при VALUE_CHANGED / MISSING / SOURCE_CHANGED статус
 * не позволяет объявить расширение успешным без решения человека.
 */

import type {
  ExpandedHistory,
  HistoryReconciliationResult,
  HistoryReconciliationRow,
  ReconciliationCategory,
} from "./types";

const EMPTY_COUNTS = (): Record<ReconciliationCategory, number> => ({
  IDENTICAL: 0,
  VALUE_CHANGED: 0,
  NEW: 0,
  MISSING: 0,
  DUPLICATE: 0,
  SCHEMA_CHANGED: 0,
  SOURCE_CHANGED: 0,
  INCOMPLETE: 0,
});

export interface PreviousObservation {
  date: string;
  value: number;
}

export function reconcileHistory(
  previous: readonly PreviousObservation[],
  expanded: ExpandedHistory,
  options: { previousSourceSliceId?: number | null } = {},
): HistoryReconciliationResult {
  const counts = EMPTY_COUNTS();
  const rows: HistoryReconciliationRow[] = [];
  const notes: string[] = [];
  const byDate = new Map(expanded.observations.map((observation) => [observation.date, observation]));

  for (const old of previous) {
    const current = byDate.get(old.date);
    if (!current) {
      counts.MISSING++;
      rows.push({
        date: old.date,
        previousValue: old.value,
        newValue: null,
        category: "MISSING",
        deviation: null,
        note: "дата отсутствует в расширенной выгрузке",
      });
      continue;
    }
    const deviation = current.value - old.value;
    if (deviation === 0) {
      counts.IDENTICAL++;
      rows.push({ date: old.date, previousValue: old.value, newValue: current.value, category: "IDENTICAL", deviation: 0, note: "значение совпало" });
    } else {
      counts.VALUE_CHANGED++;
      rows.push({
        date: old.date,
        previousValue: old.value,
        newValue: current.value,
        category: "VALUE_CHANGED",
        deviation,
        note: `значение изменилось на ${deviation}; требуется решение: исправление источника или ошибка запроса`,
      });
    }
  }

  const previousDates = new Set(previous.map((observation) => observation.date));
  let newDates = 0;
  for (const observation of expanded.observations) {
    if (previousDates.has(observation.date)) continue;
    newDates++;
    counts.NEW++;
  }
  if (newDates > 0) notes.push(`новых дат по сравнению с предыдущей версией: ${newDates}`);

  for (const duplicate of expanded.duplicates) {
    counts.DUPLICATE++;
    rows.push({
      date: duplicate.date,
      previousValue: null,
      newValue: null,
      category: "DUPLICATE",
      deviation: null,
      note: `дубликат даты в интервалах: ${duplicate.intervals.join(", ")}`,
    });
  }

  if (options.previousSourceSliceId != null && options.previousSourceSliceId !== expanded.sliceId) {
    counts.SOURCE_CHANGED++;
    rows.push({
      date: "",
      previousValue: null,
      newValue: null,
      category: "SOURCE_CHANGED",
      deviation: null,
      note: `источник изменился: было slice ${options.previousSourceSliceId}, стало ${expanded.sliceId}`,
    });
  }

  for (const interval of expanded.intervals) {
    if (interval.httpStatus !== 200 || interval.completeness !== "full") {
      counts.INCOMPLETE++;
      rows.push({
        date: "",
        previousValue: null,
        newValue: null,
        category: "INCOMPLETE",
        deviation: null,
        note: `интервал ${interval.label}: HTTP ${interval.httpStatus ?? "—"}, полнота ${interval.completeness}`,
      });
    }
  }

  const blocking = counts.DUPLICATE + counts.SOURCE_CHANGED + counts.SCHEMA_CHANGED;
  const status: HistoryReconciliationResult["status"] =
    blocking > 0
      ? "BLOCKED"
      : counts.INCOMPLETE > 0
        ? "INCOMPLETE"
        : counts.VALUE_CHANGED + counts.MISSING > 0
          ? "CHANGES_DETECTED"
          : counts.NEW > 0
            ? "MATCH_WITH_EXTENSIONS"
            : "IDENTICAL";

  if (counts.VALUE_CHANGED > 0) notes.push(`изменившихся прежних значений: ${counts.VALUE_CHANGED} — прежние данные не перезаписываются автоматически`);
  if (counts.MISSING > 0) notes.push(`пропавших прежних дат: ${counts.MISSING} — расширение неполно`);
  if (blocking === 0 && counts.VALUE_CHANGED + counts.MISSING === 0) notes.push("все прежние значения воспроизведены без изменений");

  return {
    status,
    comparedDates: previous.length,
    counts,
    rows: rows.sort((a, b) => a.date.localeCompare(b.date) || a.category.localeCompare(b.category)),
    newDates,
    notes,
  };
}
