/**
 * Сравнение двух нормализованных выгрузок.
 *
 * Ключ сравнения: (shop_no, date, slice_id, dimension_1, dimension_2, metric).
 * Версия преобразования в ключ не входит и учитывается отдельно (см. отчёт).
 * Срезы сравниваются по отдельности; совпадающие дневные итоги разных срезов НЕ суммируются.
 * Строки «итог за период» (пустая дата) сравниваются отдельно от дневных наблюдений.
 */

import { classifyQuality, classifyValue, isAccessDenied, resolveStatus, severityOf } from "./difference-classifier";
import type {
  ComparisonResult,
  NormalizedObservation,
  NormalizedRun,
  ObservationDiff,
  QualityChange,
  SliceComparison,
} from "./types";

export interface CompareOptions {
  /** абсолютный допуск для чисел (по умолчанию 0 — точное сравнение) */
  toleranceAbs?: number;
  /** относительный допуск для чисел (по умолчанию 0) */
  toleranceRel?: number;
  now?: string;
}

/** Ключ без измерений — для распознавания «изменилось измерение, а не появилась новая сущность». */
function looseKey(observation: NormalizedObservation): string {
  const { parts, isTotal } = observation;
  return [parts.shop_no, isTotal ? "TOTAL" : parts.date, parts.slice_id, parts.metric].join("\u0001");
}

function sumBy(
  run: NormalizedRun,
  sliceId: number,
  metric: string,
): { total: number | null; rows: number } {
  let sum = 0;
  let rows = 0;
  for (const observation of run.observations) {
    if (observation.isTotal) continue;
    if (observation.parts.slice_id !== sliceId || observation.parts.metric !== metric) continue;
    if (observation.value === null) continue;
    sum += observation.value;
    rows++;
  }
  return { total: rows ? sum : null, rows };
}

export function compareRuns(oldRun: NormalizedRun, newRun: NormalizedRun, options: CompareOptions = {}): ComparisonResult {
  const tolerance = { abs: options.toleranceAbs ?? 0, rel: options.toleranceRel ?? 0 };
  const notes: string[] = [];
  const diffs: ObservationDiff[] = [];

  // --- период ------------------------------------------------------------------
  const periodMismatch =
    oldRun.period.from !== newRun.period.from ||
    oldRun.period.to !== newRun.period.to ||
    oldRun.period.time_range !== newRun.period.time_range;
  if (periodMismatch) {
    diffs.push({
      category: "PERIOD_MISMATCH",
      scope: "period",
      severity: severityOf("PERIOD_MISMATCH"),
      slice_id: null,
      date: "",
      metric: "",
      dimension_1: "",
      dimension_2: "",
      old_value: null,
      new_value: null,
      abs_delta: null,
      rel_delta: null,
      detail: `старая: ${oldRun.period.time_range || "—"}; новая: ${newRun.period.time_range || "—"}`,
    });
  }

  // --- состав срезов и доступ ---------------------------------------------------
  const oldSlices = [...oldRun.metric_set_by_slice.keys()].sort((a, b) => a - b);
  const newSlices = [...newRun.metric_set_by_slice.keys()].sort((a, b) => a - b);
  const missingInNew = oldSlices.filter((s) => !newSlices.includes(s));
  const newInOld = newSlices.filter((s) => !oldSlices.includes(s));

  let accessDenied = false;
  for (const sliceId of new Set([...oldRun.http_by_slice.keys(), ...newRun.http_by_slice.keys()])) {
    const oldStatus = oldRun.http_by_slice.get(sliceId) ?? null;
    const newStatus = newRun.http_by_slice.get(sliceId) ?? null;
    if (isAccessDenied(newStatus) || isAccessDenied(oldStatus)) {
      accessDenied = true;
      diffs.push({
        category: "ACCESS_CHANGED",
        scope: "source",
        severity: severityOf("ACCESS_CHANGED"),
        slice_id: sliceId,
        date: "",
        metric: "",
        dimension_1: "",
        dimension_2: "",
        old_value: oldStatus,
        new_value: newStatus,
        abs_delta: null,
        rel_delta: null,
        detail: `HTTP старая=${oldStatus}, новая=${newStatus}`,
      });
    } else if (oldStatus !== null && newStatus !== null && oldStatus !== newStatus) {
      diffs.push({
        category: newStatus === 200 ? "QUALITY_DEGRADED" : "UNKNOWN",
        scope: "source",
        severity: severityOf(newStatus === 200 ? "QUALITY_DEGRADED" : "UNKNOWN"),
        slice_id: sliceId,
        date: "",
        metric: "",
        dimension_1: "",
        dimension_2: "",
        old_value: oldStatus,
        new_value: newStatus,
        abs_delta: null,
        rel_delta: null,
        detail: `HTTP статус среза: ${oldStatus} → ${newStatus}`,
      });
    }
  }

  // --- неполные срезы ----------------------------------------------------------
  const incompleteSlices: number[] = [];
  for (const sliceId of new Set([...oldSlices, ...newSlices])) {
    const oldQuality = oldRun.quality_by_slice.get(sliceId);
    const newQuality = newRun.quality_by_slice.get(sliceId);
    const notFull =
      (oldQuality && (oldQuality.completeness !== "full" || oldQuality.http_status !== 200)) ||
      (newQuality && (newQuality.completeness !== "full" || newQuality.http_status !== 200)) ||
      !oldQuality ||
      !newQuality;
    if (notFull) incompleteSlices.push(sliceId);
  }

  // --- построчная сверка -------------------------------------------------------
  const newByLooseKey = new Map<string, NormalizedObservation[]>();
  for (const observation of newRun.observations) {
    const key = looseKey(observation);
    newByLooseKey.set(key, [...(newByLooseKey.get(key) ?? []), observation]);
  }
  const handledNewKeys = new Set<string>();

  const perSlice = new Map<number, SliceComparison>();
  // предварительный подсчёт строк по срезам: пустые срезы тоже должны быть видны в таблице
  const oldDailyBySlice = new Map<number, number>();
  const newDailyBySlice = new Map<number, number>();
  const oldTotalsBySlice = new Map<number, number>();
  const newTotalsBySlice = new Map<number, number>();
  for (const observation of oldRun.observations) {
    const slice = observation.parts.slice_id;
    if (observation.isTotal) oldTotalsBySlice.set(slice, (oldTotalsBySlice.get(slice) ?? 0) + 1);
    else oldDailyBySlice.set(slice, (oldDailyBySlice.get(slice) ?? 0) + 1);
  }
  for (const observation of newRun.observations) {
    const slice = observation.parts.slice_id;
    if (observation.isTotal) newTotalsBySlice.set(slice, (newTotalsBySlice.get(slice) ?? 0) + 1);
    else newDailyBySlice.set(slice, (newDailyBySlice.get(slice) ?? 0) + 1);
  }

  const sliceStat = (sliceId: number): SliceComparison => {
    let stat = perSlice.get(sliceId);
    if (!stat) {
      stat = {
        slice_id: sliceId,
        old_rows: oldDailyBySlice.get(sliceId) ?? 0,
        new_rows: newDailyBySlice.get(sliceId) ?? 0,
        identical: 0,
        value_changed: 0,
        added: 0,
        missing: 0,
        totals_rows_old: oldTotalsBySlice.get(sliceId) ?? 0,
        totals_rows_new: newTotalsBySlice.get(sliceId) ?? 0,
        total_old: null,
        total_new: null,
        metric_set_changed: false,
      };
      perSlice.set(sliceId, stat);
    }
    return stat;
  };

  let identical = 0;
  let valueChanged = 0;
  let newRows = 0;
  let missingRows = 0;
  let dailyIdentical = 0;
  let totalsIdentical = 0;
  let hiddenDimensionDifferences = 0;

  for (const [key, oldObservation] of oldRun.by_key) {
    const sliceId = oldObservation.parts.slice_id;
    const stat = sliceStat(sliceId);

    const newObservation = newRun.by_key.get(key);
    if (newObservation) {
      handledNewKeys.add(key);
      if (
        newObservation.raw_dimension_1 !== oldObservation.raw_dimension_1 ||
        newObservation.raw_dimension_2 !== oldObservation.raw_dimension_2
      ) {
        hiddenDimensionDifferences++;
      }

      const comparison = classifyValue(
        oldObservation.value_raw,
        newObservation.value_raw,
        oldObservation.value,
        newObservation.value,
        tolerance,
      );
      if (comparison.category === "IDENTICAL") {
        identical++;
        stat.identical++;
        if (oldObservation.isTotal) totalsIdentical++;
        else dailyIdentical++;
      } else {
        valueChanged++;
        stat.value_changed++;
        diffs.push({
          category: comparison.category,
          scope: oldObservation.isTotal ? "total" : "daily",
          severity: severityOf(comparison.category),
          slice_id: sliceId,
          date: oldObservation.parts.date,
          metric: oldObservation.parts.metric,
          dimension_1: oldObservation.parts.dimension_1,
          dimension_2: oldObservation.parts.dimension_2,
          old_value: oldObservation.value,
          new_value: newObservation.value,
          abs_delta: comparison.abs_delta,
          rel_delta: comparison.rel_delta,
          detail: comparison.detail,
        });
      }
      continue;
    }

    // строки нет по точному ключу — возможно, изменилось измерение
    const candidates = (newByLooseKey.get(looseKey(oldObservation)) ?? []).filter((c) => !handledNewKeys.has(c.key));
    if (candidates.length) {
      const candidate = candidates[0]!;
      handledNewKeys.add(candidate.key);
      diffs.push({
        category: "SCHEMA_CHANGED",
        scope: "dimension",
        severity: severityOf("SCHEMA_CHANGED"),
        slice_id: sliceId,
        date: oldObservation.parts.date,
        metric: oldObservation.parts.metric,
        dimension_1: oldObservation.parts.dimension_1,
        dimension_2: oldObservation.parts.dimension_2,
        old_value: oldObservation.value,
        new_value: candidate.value,
        abs_delta: null,
        rel_delta: null,
        detail: `изменилось измерение: («${oldObservation.parts.dimension_1}», «${oldObservation.parts.dimension_2}») → («${candidate.parts.dimension_1}», «${candidate.parts.dimension_2}»)`,
      });
      continue;
    }

    missingRows++;
    stat.missing++;
    diffs.push({
      category: "MISSING_ROW",
      scope: oldObservation.isTotal ? "total" : "daily",
      severity: severityOf("MISSING_ROW"),
      slice_id: sliceId,
      date: oldObservation.parts.date,
      metric: oldObservation.parts.metric,
      dimension_1: oldObservation.parts.dimension_1,
      dimension_2: oldObservation.parts.dimension_2,
      old_value: oldObservation.value,
      new_value: null,
      abs_delta: null,
      rel_delta: null,
      detail: "строка есть в старой выгрузке и отсутствует в новой",
    });
  }

  for (const [key, newObservation] of newRun.by_key) {
    const sliceId = newObservation.parts.slice_id;
    const stat = sliceStat(sliceId);
    if (handledNewKeys.has(key)) continue;

    newRows++;
    stat.added++;
    diffs.push({
      category: "NEW_ROW",
      scope: newObservation.isTotal ? "total" : "daily",
      severity: severityOf("NEW_ROW"),
      slice_id: sliceId,
      date: newObservation.parts.date,
      metric: newObservation.parts.metric,
      dimension_1: newObservation.parts.dimension_1,
      dimension_2: newObservation.parts.dimension_2,
      old_value: null,
      new_value: newObservation.value,
      abs_delta: null,
      rel_delta: null,
      detail: "строка появилась только в новой выгрузке",
    });
  }

  // --- состав метрик по срезам --------------------------------------------------
  let schemaChanged = 0;
  for (const sliceId of [...new Set([...oldSlices, ...newSlices])].sort((a, b) => a - b)) {
    const oldMetrics = [...(oldRun.metric_set_by_slice.get(sliceId) ?? [])].sort();
    const newMetrics = [...(newRun.metric_set_by_slice.get(sliceId) ?? [])].sort();
    if (oldMetrics.join(",") === newMetrics.join(",")) continue;
    schemaChanged++;
    sliceStat(sliceId).metric_set_changed = true;
    const added = newMetrics.filter((m) => !oldMetrics.includes(m));
    const removed = oldMetrics.filter((m) => !newMetrics.includes(m));
    diffs.push({
      category: "SCHEMA_CHANGED",
      scope: "metric_set",
      severity: severityOf("SCHEMA_CHANGED"),
      slice_id: sliceId,
      date: "",
      metric: "",
      dimension_1: "",
      dimension_2: "",
      old_value: oldMetrics.length,
      new_value: newMetrics.length,
      abs_delta: null,
      rel_delta: null,
      detail: `состав метрик изменился: добавлены [${added.join(", ")}], исчезли [${removed.join(", ")}]`,
    });
  }

  // --- качество запросов -------------------------------------------------------
  const qualityChanges: QualityChange[] = [];
  const qualityImprovements: QualityChange[] = [];
  for (const sliceId of [...new Set([...oldRun.quality_by_slice.keys(), ...newRun.quality_by_slice.keys()])].sort((a, b) => a - b)) {
    const oldQuality = oldRun.quality_by_slice.get(sliceId);
    const newQuality = newRun.quality_by_slice.get(sliceId);
    if (!oldQuality || !newQuality) continue;
    for (const change of classifyQuality(oldQuality, newQuality)) {
      if (change.degraded) {
        qualityChanges.push(change);
        diffs.push({
          category: "QUALITY_DEGRADED",
          scope: "run",
          severity: severityOf("QUALITY_DEGRADED"),
          slice_id: sliceId,
          date: "",
          metric: "",
          dimension_1: "",
          dimension_2: "",
          old_value: null,
          new_value: null,
          abs_delta: null,
          rel_delta: null,
          detail: `${change.field}: ${change.old_value} → ${change.new_value}`,
        });
      } else {
        qualityImprovements.push(change);
      }
    }
  }

  // --- агрегаты по срезам -------------------------------------------------------
  const aggregates: ComparisonResult["aggregates"] = [];
  for (const sliceId of oldSlices.filter((s) => newSlices.includes(s))) {
    const metrics = [...new Set([...(oldRun.metric_set_by_slice.get(sliceId) ?? []), ...(newRun.metric_set_by_slice.get(sliceId) ?? [])])].sort();
    for (const metric of metrics) {
      const oldSum = sumBy(oldRun, sliceId, metric);
      const newSum = sumBy(newRun, sliceId, metric);
      if (oldSum.total === null && newSum.total === null) continue;
      const absDelta = oldSum.total === null || newSum.total === null ? null : Math.abs(newSum.total - oldSum.total);
      const relDelta =
        absDelta === null || oldSum.total === null || oldSum.total === 0 ? null : absDelta / Math.abs(oldSum.total);
      const changed =
        absDelta !== null && absDelta > tolerance.abs && (relDelta === null || relDelta > tolerance.rel);
      aggregates.push({
        slice_id: sliceId,
        metric,
        old_total: oldSum.total,
        new_total: newSum.total,
        abs_delta: absDelta,
        rel_delta: relDelta,
        changed,
      });
    }
  }

  // --- итоги по срезам ----------------------------------------------------------
  for (const stat of perSlice.values()) {
    const oldTotal = sumBy(oldRun, stat.slice_id, "qty_orders_delivered");
    const newTotal = sumBy(newRun, stat.slice_id, "qty_orders_delivered");
    stat.total_old = oldTotal.total;
    stat.total_new = newTotal.total;
  }

  notes.push(
    "Сравнение выполнено по нормализованным наблюдениям; время генерации, порядок строк и служебные поля игнорируются.",
  );
  if (tolerance.abs > 0 || tolerance.rel > 0) {
    notes.push(`Применён явный допуск: abs=${tolerance.abs}, rel=${tolerance.rel}. Без допуска сравнение строго точное.`);
  } else {
    notes.push("Допуск не задан: сравнение значений строго точное (abs=0, rel=0).");
  }
  if (hiddenDimensionDifferences > 0) {
    notes.push(
      `Маскирование скрыло ${hiddenDimensionDifferences} различий в исходном тексте измерений: значения совпали после приведения к маскированному виду (старая выгрузка хранится замаскированной).`,
    );
  }

  const status = resolveStatus({
    accessDenied,
    periodMismatch,
    incompleteSlices,
    missingSlices: missingInNew,
    valueChanged,
    newRows,
    missingRows,
    schemaChanged,
    qualityDegraded: qualityChanges.length,
    maskingOnlyDifferences: 0,
  });

  return {
    old_dir: oldRun.dir,
    new_dir: newRun.dir,
    generated_at: options.now ?? new Date().toISOString(),
    tolerance,
    period_mismatch: periodMismatch,
    access_changed: accessDenied,
    scaffold_changed: schemaChanged > 0,
    slices: { old: oldSlices, new: newSlices, missing_in_new: missingInNew, new_in_old: newInOld },
    counts: {
      compared: oldRun.by_key.size,
      identical,
      value_changed: valueChanged,
      new_rows: newRows,
      missing_rows: missingRows,
      daily_identical: dailyIdentical,
      totals_identical: totalsIdentical,
      duplicates_old: oldRun.duplicates.length,
      duplicates_new: newRun.duplicates.length,
    },
    per_slice: [...perSlice.values()].sort((a, b) => a.slice_id - b.slice_id),
    diffs,
    quality_changes: qualityChanges,
    quality_improvements: qualityImprovements,
    masking: {
      masked_rows_old: oldRun.masked_rows,
      masked_rows_new: newRun.masked_rows,
      hidden_dimension_differences: hiddenDimensionDifferences,
    },
    aggregates,
    status,
    notes,
  };
}
