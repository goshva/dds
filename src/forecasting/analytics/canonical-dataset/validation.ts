/**
 * Stage 3.2.3 — проверка инвариантов канонического дневного набора.
 * Проверки не исправляют данные: они либо подтверждают набор, либо сообщают о нарушении.
 */

import { addDays, calendarRange } from "../profiling/metrics-profile";
import type { CanonicalDataset, ValidationIssue, ValidationReport } from "./types";

export interface ValidationOptions {
  /** Ожидаемая первая дата (из зафиксированного периода). */
  expectedFrom?: string;
  /** Ожидаемая последняя дата включительно. */
  expectedToInclusive?: string;
}

export function validateCanonicalDataset(dataset: CanonicalDataset, options: ValidationOptions = {}): ValidationReport {
  const issues: ValidationIssue[] = [];
  const checks: ValidationReport["checks"] = [];
  const push = (code: string, passed: boolean, detail: string) => {
    checks.push({ code, passed, detail });
    if (!passed) issues.push({ severity: "error", code, message: detail });
  };

  const dates = dataset.observations.map((observation) => observation.date);

  push("single_source", dataset.observations.every((observation) => observation.sourceSliceId === dataset.sourceSliceId), `источник: срез ${dataset.sourceSliceId}`);
  push("single_shop", dataset.observations.every((observation) => observation.shopNo === dataset.shopNo), `магазин: ${dataset.shopNo}`);
  push("single_metric", dataset.observations.every((observation) => observation.metric === dataset.metric), `метрика: ${dataset.metric}`);
  push("non_empty_dataset", dataset.observations.length > 0, `записей: ${dataset.observations.length}`);

  const uniqueDates = new Set(dates);
  push("one_record_per_date", uniqueDates.size === dates.length, `дат: ${uniqueDates.size}, записей: ${dates.length}`);
  push(
    "dates_sorted",
    dates.every((date, index) => index === 0 || dates[index - 1]! <= date),
    "даты упорядочены по возрастанию",
  );
  push("no_nulls", dataset.observations.every((observation) => Number.isFinite(observation.value)), "все значения числовые");
  push("no_negative", dataset.observations.every((observation) => observation.value >= 0), "отрицательных значений нет");
  push(
    "provenance_present",
    dataset.observations.every((observation) => observation.sourceSliceId > 0) && Boolean(dataset.provenance.sourceFile),
    `провенанс: ${dataset.provenance.sourceFile}`,
  );

  if (dataset.observations.length > 0) {
    const expectedDates = calendarRange(dataset.period.from, dataset.period.to);
    const missing = expectedDates.filter((date) => !uniqueDates.has(date));
    push("calendar_continuous", missing.length === 0, missing.length ? `пропущены даты: ${missing.join(", ")}` : "календарь непрерывен");
    push(
      "days_match_period",
      dataset.period.days === expectedDates.length,
      `дней в наборе: ${dataset.period.days}, в календаре периода: ${expectedDates.length}`,
    );
  }

  if (options.expectedFrom && options.expectedToInclusive) {
    const lastDate = dates.at(-1) ?? "";
    push(
      "period_matches_expected",
      (dates[0] ?? "") === options.expectedFrom && lastDate === options.expectedToInclusive,
      `фактический период: ${dates[0] ?? "—"} … ${lastDate || "—"}; ожидаемый: ${options.expectedFrom} … ${options.expectedToInclusive}`,
    );
    // исключающая верхняя граница: следующий день после ожидаемой последней даты
    push("exclusive_boundary", addDays(options.expectedToInclusive, 1) > lastDate, "верхняя граница трактуется как исключающая");
  }

  const hasErrors = issues.some((issue) => issue.severity === "error");
  return { ok: !hasErrors, issues, checks };
}
