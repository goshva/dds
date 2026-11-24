/**
 * Профиль dimension-полей: кардинальность, стабильность состава, специальные значения.
 *
 * Персональные данные не восстанавливаются и не публикуются: плейсхолдеры маскирования
 * только подсчитываются. Коллизии маскирования фиксируются как риск, записи не объединяются.
 */

import type { DailyObservationRow, DimensionProfile, DimensionValueCount } from "./types";

const MASK_PLACEHOLDER = /^\s*</;
const SPECIAL_VALUE = /^(total|итог|все|__all__|all)$/i;

function profileField(rows: readonly DailyObservationRow[], field: "dimension_1" | "dimension_2"): DimensionProfile {
  const counts = new Map<string, number>();
  let empty = 0;
  let placeholders = 0;
  const valuesByDate = new Map<string, Set<string>>();

  for (const row of rows) {
    if (!row.date) continue;
    const raw = (row[field] ?? "").toString();
    if (raw === "") {
      empty++;
    } else {
      counts.set(raw, (counts.get(raw) ?? 0) + 1);
      if (MASK_PLACEHOLDER.test(raw)) placeholders++;
      const bucket = valuesByDate.get(row.date) ?? new Set<string>();
      bucket.add(raw);
      valuesByDate.set(row.date, bucket);
    }
  }

  const sortedValues = [...counts.entries()]
    .map(([value, rows_]) => ({ value, rows: rows_ }))
    .sort((a, b) => b.rows - a.rows || a.value.localeCompare(b.value));

  const perDateCounts = [...valuesByDate.values()].map((set) => set.size);
  const specialValues = sortedValues.filter((entry) => SPECIAL_VALUE.test(entry.value) || MASK_PLACEHOLDER.test(entry.value));

  const unique = counts.size;
  const cardinality: DimensionProfile["cardinality"] = unique <= 10 ? "low" : unique <= 50 ? "medium" : "high";

  const notes: string[] = [];
  if (placeholders > 0) {
    notes.push(
      `обнаружены плейсхолдеры маскирования (${placeholders} строк) — возможна коллизия разных сущностей; записи не объединяются автоматически`,
    );
  }
  if (empty > 0) notes.push(`${empty} строк с пустым значением измерения`);
  if (perDateCounts.length > 1 && Math.min(...perDateCounts) !== Math.max(...perDateCounts)) {
    notes.push(`состав значений меняется по датам: от ${Math.min(...perDateCounts)} до ${Math.max(...perDateCounts)} значений в день`);
  }
  if (cardinality === "high") notes.push("высокая кардинальность — прямое использование как категориального признака рискованно");

  return {
    field,
    total_rows: rows.filter((row) => row.date).length,
    unique_values: unique,
    empty_values: empty,
    top_values: sortedValues.slice(0, 10),
    values_per_date_min: perDateCounts.length ? Math.min(...perDateCounts) : 0,
    values_per_date_max: perDateCounts.length ? Math.max(...perDateCounts) : 0,
    special_values: specialValues.slice(0, 10),
    cardinality,
    masking_placeholder_values: placeholders,
    notes,
  };
}

export function buildDimensionProfiles(rows: readonly DailyObservationRow[]): DimensionProfile[] {
  return [profileField(rows, "dimension_1"), profileField(rows, "dimension_2")];
}

/** Частоты значений измерения для CSV-отчёта (без объединения сущностей). */
export function dimensionValueCounts(rows: readonly DailyObservationRow[], field: "dimension_1" | "dimension_2"): DimensionValueCount[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.date) continue;
    const raw = (row[field] ?? "").toString();
    if (raw === "") continue;
    counts.set(raw, (counts.get(raw) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, rows_]) => ({ value, rows: rows_ }))
    .sort((a, b) => b.rows - a.rows || a.value.localeCompare(b.value));
}
